"""Read-only Immich backup monitoring; no control or recovery operations."""
from datetime import datetime, timezone
import json


def age_seconds(value, now):
    try:
        age = (now - datetime.fromisoformat(value.replace('Z', '+00:00'))).total_seconds()
        return age if age >= -60 else None
    except (TypeError, ValueError, AttributeError):
        return None


def evaluate(raw, now=None):
    now = now or datetime.now(timezone.utc)
    result = {'_generated_at': now.isoformat(), 'status': 'healthy', 'alerts': [], 'details': raw}
    def alert(level, text):
        result['alerts'].append({'level': level, 'text': text})
    if not isinstance(raw, dict):
        result['details'] = {}
        alert('warning', 'Backup monitoring unavailable: cannot read r-server status.')
    else:
        units = raw.get('units', {})
        for name, label in [('immich-backup.service', 'Nightly backup'),
                            ('immich-backup-verify.service', 'Backup verification')]:
            state = units.get(name, {})
            if state.get('ActiveState') == 'failed' or state.get('Result') not in ('success', ''):
                alert('error', label + ' failed. Inspect its systemd journal on r-server.')
            elif not state.get('ActiveState'):
                alert('warning', label + ' service status unavailable.')
        for name, label in [('immich-backup.timer', 'Nightly backup timer'),
                            ('immich-backup-verify.timer', 'Weekly verification timer')]:
            state = units.get(name, {})
            if state.get('ActiveState') != 'active' or state.get('UnitFileState') != 'enabled':
                alert('error', label + ' is not active and enabled.')
        if not raw.get('drive_ok'):
            alert('error', 'Seagate backup HDD is missing or the wrong filesystem is mounted.')
        else:
            if not raw.get('repository_ok'):
                alert('error', 'Encrypted backup repository cannot be read.')
            age = age_seconds(raw.get('latest_snapshot', {}).get('time'), now)
            if age is None or age > 30 * 3600:
                alert('error', 'No valid successful backup within the last 30 hours.')
            verification = raw.get('verification') or {}
            age = age_seconds(verification.get('verified_at'), now)
            if age is None or age > 9 * 86400 or not verification.get('full_repository_data_check'):
                alert('warning', 'Full backup verification is missing or older than nine days.')
            disk = raw.get('disk', {})
            total, used, free = disk.get('total', 0), disk.get('used', 0), disk.get('free', 0)
            if total <= 0:
                alert('warning', 'Backup HDD capacity reading is unavailable.')
            elif free < 10 * 1024**3 or used / total >= .95:
                alert('error', 'Backup HDD is critically low on free space.')
            elif used / total >= .85:
                alert('warning', 'Backup HDD is at least 85% full; review capacity and pruning.')
    if result['alerts']:
        result['status'] = 'error' if any(a['level'] == 'error' for a in result['alerts']) else 'warning'
    return result


def collect(remote):
    output, ok = remote('sudo -n /usr/local/sbin/immich-backup-status')
    try:
        raw = json.loads(output) if ok else None
    except (TypeError, ValueError):
        raw = None
    return evaluate(raw)

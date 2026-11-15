"""Read-only Pi dashboard adapters. Never publish prompts, outputs or chat IDs."""
import json
import sqlite3
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/home/Aarz/hermes-replacement')
SESSION_DIRS = {
    'pi-cli': Path('/home/Aarz/.pi/agent/sessions'),
    'pi-voice': Path('/home/Aarz/pi-live-voice/sessions'),
    'pi-whatsapp': Path('/home/Aarz/.pi/whatsapp-agent/sessions'),
}


def stamp(value):
    if not value:
        return 0
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def service_active(unit):
    try:
        return subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit],
                              timeout=3).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def runtime_health(root=None):
    root = Path(root or ROOT)
    result = {'status': 'Not running', 'discord_connected': False, 'heartbeat_age_s': None}
    try:
        heartbeat = json.loads((root / 'state/heartbeat.json').read_text())
        health = json.loads((root / 'state/health.json').read_text())
        age = time.time() - stamp(heartbeat['at'])
        result.update(heartbeat_age_s=round(age),
                      discord_connected=bool(health.get('discord_connected')))
        if service_active('aarz-agent.service'):
            result['status'] = ('Running' if 0 <= age < 90 and result['discord_connected']
                                else 'Degraded')
    except (OSError, ValueError, KeyError):
        result['status'] = 'Unavailable'
    return result


def blank(unit='sessions'):
    return dict(status='dormant', last_active=None, last_active_ms=0,
                sessions_today=0, sessions_24h=0, last_title=None,
                last_source=None, recent=[], metric_unit=unit)


def summarize(entries, unit='sessions'):
    out = blank(unit)
    midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    now = time.time()
    out['sessions_today'] = sum(e['started'] >= midnight for e in entries)
    out['sessions_24h'] = sum(e['started'] >= now - 86400 for e in entries)
    recent = sorted(entries, key=lambda e: e['ts'], reverse=True)[:5]
    out['recent'] = [{k: v for k, v in e.items() if k != 'started'} for e in recent]
    if recent:
        last = recent[0]
        out.update(last_active_ms=last['ts'], last_title=last['title'],
                   last_source=last['source'],
                   last_active=datetime.fromtimestamp(last['ts'] / 1000, timezone.utc).isoformat())
        age = now - last['ts'] / 1000
        out['status'] = 'active' if age < 21600 else 'idle' if age < 172800 else 'dormant'
    return out


def runtime_activity(root=None):
    """Chat turns and scheduled executions, not fictitious Hermes profiles."""
    root = Path(root or ROOT)
    agents = {'aarz': blank('turns'), 'pi-scheduler': blank('runs')}
    try:
        jobs = {j['id']: j['name'] for j in json.loads((root / 'jobs.json').read_text())['jobs']}
        with sqlite3.connect(f'file:{root / "state/runtime.db"}?mode=ro', uri=True, timeout=2) as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("""SELECT job_id,kind,state,scheduled,started,finished
                FROM runs WHERE kind IN ('chat','cron')""").fetchall()
        for kind, agent_id, unit in [('chat', 'aarz', 'turns'), ('cron', 'pi-scheduler', 'runs')]:
            entries = []
            for r in rows:
                if r['kind'] != kind or r['started'] is None:
                    continue
                title = 'Discord conversation' if kind == 'chat' else jobs.get(r['job_id'], 'Scheduled job')
                entries.append(dict(started=r['started'], ts=int((r['finished'] or r['started']) * 1000),
                                    title=f"{title} · {r['state']}", source='pi-discord' if kind == 'chat' else 'pi-cron',
                                    state=r['state'], msgs=0))
            agents[agent_id] = summarize(entries, unit)
            agents[agent_id]['running'] = sum(r['kind'] == kind and r['state'] == 'running' for r in rows)
            agents[agent_id]['queued'] = sum(r['kind'] == kind and r['state'] == 'queued' for r in rows)
    except (OSError, ValueError, KeyError, sqlite3.Error) as exc:
        for agent in agents.values():
            agent['error'] = 'Pi runtime data unavailable'
        print(f'Pi runtime activity: {exc}')
    return agents


_session_cache = {}


def session_activity(directory):
    """Count actual JSONL sessions; expose names only, never raw message text."""
    entries = []
    for path in Path(directory).rglob('*.jsonl'):
        try:
            stat = path.stat()
            key = (str(path), stat.st_mtime_ns, stat.st_size)
            entry = _session_cache.get(key)
            if entry is None:
                started = last = 0
                title = 'Pi session'
                messages = 0
                with path.open() as stream:
                    for line in stream:
                        try:
                            item = json.loads(line)
                            ts = stamp(item.get('timestamp'))
                            if item.get('type') == 'session':
                                started = ts
                            elif item.get('type') == 'session_info' and item.get('name'):
                                title = str(item['name']).splitlines()[0][:80]
                            elif item.get('type') == 'message' and item.get('message', {}).get('role') in ('user', 'assistant'):
                                messages += 1
                                last = max(last, ts)
                        except (ValueError, TypeError, AttributeError):
                            continue  # includes a partially written final JSONL line
                entry = dict(started=started, ts=int(last * 1000), title=title, source='pi-session', msgs=messages)
                # Retain only the latest version of each file.
                for old in [k for k in _session_cache if k[0] == str(path)]:
                    del _session_cache[old]
                _session_cache[key] = entry
            if entry['started'] and entry['ts']:
                entries.append(entry)
        except OSError:
            continue
    return summarize(entries)


def jobs(root=None):
    """Canonical job store only. Never merge stale legacy fragments."""
    return json.loads((Path(root or ROOT) / 'jobs.json').read_text())['jobs']

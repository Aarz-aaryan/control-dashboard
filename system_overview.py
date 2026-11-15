"""Read-only service inventory. No environment, credentials or session IDs published."""
import json
import subprocess
from pathlib import Path
import pi_data

UNITS = [
    ('aarz-agent.service', 'Discord & Scheduler', 'Authenticated Discord bridge and scheduled jobs'),
    ('pi-live-voice.service', 'Voice Gateway', 'Browser voice and Echo transport'),
    ('whatsapp-pi.service', 'WhatsApp · Pi', 'Independent personal assistant'),
    ('whatsapp-stt.service', 'GPU Speech Recognition', 'Shared Whisper worker · voice + WhatsApp'),
    ('whatsapp-tts.service', 'GPU Voice Generation', 'Shared Kokoro worker · voice + WhatsApp'),
    ('modelrelay.service', 'Model Relay', 'Model provider routing'),
]

def snapshot():
    services = []
    for unit, name, role in UNITS:
        try:
            result = subprocess.run(['systemctl', '--user', 'show', unit,
                '--property=ActiveState,SubState'], capture_output=True, text=True, timeout=3)
            fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
            state = fields.get('ActiveState', 'unknown')
            substate = fields.get('SubState', 'unknown')
        except (OSError, subprocess.TimeoutExpired):
            state = substate = 'unknown'
        services.append(dict(unit=unit, name=name, role=role, state=state, substate=substate))
    echo = {'state': 'unavailable', 'enabled': False}
    try:
        # This helper only reads local status. Explicitly allowlist public fields.
        result = subprocess.run(['python3', '/home/Aarz/pi-live-voice/echo_status.py'],
                                capture_output=True, text=True, timeout=5, check=True)
        status = json.loads(result.stdout)
        source = status.get('echo', {})
        echo = {key: source.get(key) for key in ('state', 'enabled')}
        echo['busy'] = bool(source.get('session', {}).get('busy'))
        echo['browser_mode'] = status.get('browser_pi_mode', 'unknown')
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    try:
        jobs = pi_data.jobs()
        schedules = {'total': len(jobs), 'enabled': sum(bool(j.get('enabled', True)) for j in jobs)}
    except (OSError, ValueError, KeyError):
        schedules = None
    return {'services': services, 'runtime': pi_data.runtime_health(), 'echo': echo, 'schedules': schedules}

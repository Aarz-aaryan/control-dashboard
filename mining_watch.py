#!/usr/bin/env python3
"""Independent, read-only five-minute mining checks and Discord transitions.

Credentials/config/state live outside the dashboard's served directory.
No LLM calls, miner controls, or automatic remediation.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import tempfile
from urllib.request import Request, urlopen

import gpu_api
import mining_api

CONFIG = Path.home() / '.config/miner-watch/config.json'
STATE = Path.home() / '.local/state/miner-watch/state.json'
LABELS = {'btc': 'Bitcoin · F2Pool', 'aleo': 'Aleo · F2Pool', 'prl': 'Pearl · F2Pool',
          'mx1': 'MX1 · SSH/GPU telemetry', 'mx2': 'MX2 · SSH/GPU telemetry'}


def pool_reading(data):
    workers = data['workers']
    detail = f"{workers['online']}/{workers['all']} workers online · {data['hashrate']:.2f} {data['unit']} (15 min)"
    if workers['online'] == 0 or data['hashrate'] == 0:
        return {'level': 'down', 'detail': detail}
    if workers['offline']:
        return {'level': 'degraded', 'detail': detail}
    return {'level': 'healthy', 'detail': detail}


def check(key):
    try:
        if key in mining_api.ACCOUNTS:
            return pool_reading(mining_api.load(key, 'summary'))
        data = gpu_api.load(key)
        if any(g['temperature_c'] is None for g in data['gpus']):
            return {'level': 'unknown', 'detail': 'SSH reachable, but a GPU temperature sensor is unavailable. This is not proof mining stopped.'}
        detail = ', '.join(f"GPU {g['index']}: {g['temperature_c']}°C" for g in data['gpus'])
        return {'level': 'healthy', 'detail': 'SSH reachable · ' + detail}
    except Exception:
        detail = ('F2Pool could not be read; mining status cannot be confirmed.' if key in mining_api.ACCOUNTS
                  else 'SSH/GPU check failed (host, network, or SSH authorization). This is not proof mining stopped.')
        return {'level': 'unknown', 'detail': detail}


def transition(previous, reading):
    """Debounce *each* non-healthy state; recovery needs one successful sample."""
    current = dict(previous)
    level = reading['level']
    current['count'] = previous.get('count', 0) + 1 if previous.get('candidate') == level else 1
    current.update(candidate=level, reading=reading, checked_at=datetime.now(timezone.utc).isoformat())
    before = previous.get('notified', 'healthy')
    if level == before or (level != 'healthy' and current['count'] < 2):
        return current, None
    current['notified'] = level
    if level == 'healthy':
        title = '✅ Monitoring restored' if before == 'unknown' else '✅ Mining recovered'
    else:
        title = {'down': '🚨 Mining stopped / zero hashrate', 'degraded': '⚠️ Mining partly offline',
                 'unknown': '⚠️ Monitoring unavailable'}[level]
    return current, title + '\n' + reading['detail']


def save(state):
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=STATE.parent, prefix='.state-')
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(state, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, STATE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def send(config, content):
    from dotenv import dotenv_values
    # Match the bot's credential precedence without importing its scheduler/runtime.
    env = dict(os.environ)
    for path in (Path.home() / '.hermes/.env', Path.home() / 'pi-agent-runtime/.env'):
        env.update({k: v for k, v in dotenv_values(path).items() if v is not None})
    channel = str(config['channel_id'])
    if not channel.isdigit():
        raise ValueError('Invalid Discord channel')
    body = json.dumps({'content': content, 'allowed_mentions': {'parse': []}}).encode()
    request = Request('https://discord.com/api/v10/channels/' + channel + '/messages', data=body,
                      headers={'Authorization': 'Bot ' + env['DISCORD_BOT_TOKEN'],
                               'Content-Type': 'application/json', 'User-Agent': 'MinerWatch/1.0'})
    with urlopen(request, timeout=15) as response:
        return json.load(response)['id']


def run(dry_run=False):
    with ThreadPoolExecutor(max_workers=len(LABELS)) as pool:
        readings = dict(zip(LABELS, pool.map(check, LABELS)))
    if dry_run:
        print(json.dumps(readings, indent=2))
        return
    config = json.loads(CONFIG.read_text())
    state = json.loads(STATE.read_text()) if STATE.exists() else {'checks': {}, 'pending': []}
    for key, reading in readings.items():
        current, message = transition(state['checks'].get(key, {}), reading)
        state['checks'][key] = current
        if message:
            state['pending'].append(f"**{LABELS[key]}**\n{message}\nChecked: {current['checked_at']}\nTwo consecutive failures required; checks every 5 minutes. No automatic miner changes.")
        print(key, reading['level'], reading['detail'], flush=True)
    # Persist pending transitions BEFORE delivery, so send failures retry next run.
    save(state)
    while state['pending']:
        send(config, state['pending'][0])
        state['pending'].pop(0)
        save(state)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--test-message', action='store_true')
    args = parser.parse_args()
    STATE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (STATE.parent / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.test_message:
            send(json.loads(CONFIG.read_text()), '✅ **Mining alerts enabled in #cyp**\nBitcoin, Aleo and Pearl F2Pool checks + MX1/MX2 SSH/GPU reachability checks every **5 minutes**.\nAlerts after **two consecutive failed checks**, one recovery message when healthy again. Monitoring/SSH authorization failures are distinct from mining outages. No repeated alerts for an unchanged issue and no automatic miner changes.\nThis is a setup/test notification, not an outage.')
        else:
            run(args.dry_run)


if __name__ == '__main__':
    main()

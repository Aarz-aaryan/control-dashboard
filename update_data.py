#!/usr/bin/env python3
"""Collect Pi activity, canonical jobs, retained mission data and host health.

Legacy kanban data is intentionally retained; Hermes session/cron stores are
not a source of truth. All output is atomically published every 30 seconds.
"""
import glob
import json
import os
import sqlite3
import subprocess
import time
from datetime import datetime, timezone

import pi_data

OUTPUT_DIR = '/home/Aarz/agent-dashboard'
AGY_LOG_DIR = os.path.expanduser('~/.gemini/antigravity-cli/log')


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def run_local_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        return res.stdout.strip(), res.returncode == 0
    except Exception as exc:
        return f'Error: {exc}', False


def run_ssh_cmd(cmd):
    try:
        res = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
                              '-o', 'ConnectTimeout=5', 'r-server@100.84.224.18', cmd],
                             capture_output=True, text=True, timeout=10)
        return res.stdout.strip(), res.returncode == 0
    except Exception as exc:
        return f'Error: {exc}', False


def get_health_stats():
    local = {'checks': {}}
    checks = []
    for key, cmd in [('uptime', 'uptime'), ('cpu', 'cat /proc/loadavg'),
                     ('memory', 'free -h | grep Mem'), ('disk', 'df -h / | tail -1')]:
        output, ok = run_local_cmd(cmd)
        local[key] = output if ok else 'Unavailable'
        local['checks'][key] = ok
        checks.append(ok)
    docker, ok = run_local_cmd("docker ps --format '{{.Names}}: {{.Status}}'")
    local['docker'] = (docker or 'No running containers') if ok else 'Docker not available'
    local['checks']['docker'] = ok
    local['pi_runtime'] = pi_data.runtime_health()
    local['pi'] = local['pi_runtime']['status']
    local['status'] = 'healthy' if all(checks) and local['pi'] == 'Running' else 'error'
    remote = {}
    for key, cmd in [('uptime', 'uptime'), ('docker', "sudo docker ps --format '{{.Names}}: {{.Status}}'"),
                     ('memory', 'free -h'), ('disk', 'df -h /')]:
        output, ok = run_ssh_cmd(cmd)
        remote[key] = {'output': output, 'ok': ok}
    remote['status'] = 'healthy' if all(v['ok'] for v in remote.values()) else 'error'
    return {'_generated_at': now_iso(), 'local': local, 'r_server': remote}


def _agy_activity():
    entries = []
    for path in glob.glob(os.path.join(AGY_LOG_DIR, 'cli-*.log')):
        try:
            ts = os.path.getmtime(path)
            entries.append(dict(started=ts, ts=int(ts * 1000), title=os.path.basename(path),
                                source='antigravity-cli', msgs=0))
        except OSError:
            continue
    return pi_data.summarize(entries, 'runs')


def get_agent_activity():
    agents = pi_data.runtime_activity()
    for name, directory in pi_data.SESSION_DIRS.items():
        agents[name] = pi_data.session_activity(directory)
    agents['agy'] = _agy_activity()
    from system_overview import snapshot
    return {'_generated_at': now_iso(), '_source': 'pi', 'agents': agents,
            'system': snapshot()}


def parse_job(job):
    schedule = job.get('schedule')
    if isinstance(schedule, dict):
        schedule = schedule.get('display') or schedule.get('expr') or ''
    return {
        'job_id': job.get('id') or job.get('job_id') or '',
        'name': job.get('name') or 'Unnamed Job',
        'schedule': schedule or job.get('schedule_display') or '',
        'last_run': job.get('last_run_at') or '',
        'next_run': job.get('next_run_at') or '',
        'status': 'ACTIVE' if job.get('enabled', True) else 'PAUSED',
        'last_status': job.get('last_status', ''),
        'last_error': job.get('last_error', ''),
        'prompt': job.get('prompt', ''),
        'script': job.get('script', ''),
        'paused_reason': job.get('paused_reason', ''),
        'engine': 'script' if job.get('no_agent') else 'pi',
    }


def get_cron_jobs():
    return [parse_job(job) for job in pi_data.jobs()]


def get_kanban_tasks():
    # Existing mission data is not runtime state; keep it until separately migrated.
    for path in ['/home/Aarz/.hermes/profiles/aarz/kanban.db', '/home/Aarz/.hermes/kanban.db']:
        if not os.path.exists(path):
            continue
        try:
            with sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=2) as db:
                rows = db.execute('SELECT id, title, body, assignee, status, priority FROM tasks').fetchall()
            if rows:
                return [dict(id=r[0], title=r[1], body=r[2] or '', assignee=r[3] or 'unassigned',
                             status=r[4], priority=r[5] or 0) for r in rows]
        except sqlite3.Error as exc:
            print(f'Kanban: {exc}')
    return []


def get_r_server_info():
    def remote(cmd):
        output, ok = run_ssh_cmd(cmd)
        return {'output': output, 'ok': ok}
    return {
        '_generated_at': now_iso(),
        'docker_ps': remote("sudo docker ps -a --format '{{.Names}}\\t{{.Status}}\\t{{.Ports}}'"),
        'docker_images': remote("sudo docker images --format '{{.Repository}}\\t{{.Tag}}\\t{{.Size}}'"),
        'system': {key: remote(cmd) for key, cmd in [('uptime', 'uptime'), ('free_h', 'free -h'), ('df_h', 'df -h /')]},
    }


def write_json(name, payload):
    path = os.path.join(OUTPUT_DIR, name)
    tmp = f'{path}.tmp.{os.getpid()}'
    with open(tmp, 'w') as stream:
        json.dump(payload, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def main():
    print('Pi dashboard collector started.', flush=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    while True:
        # A failed source must not prevent other panels from refreshing.
        for name, collect in [
            ('agents.json', get_agent_activity), ('health.json', get_health_stats),
            ('missions.json', lambda: {'_generated_at': now_iso(), '_source': 'pi',
                                     'cron': get_cron_jobs(), 'kanban': get_kanban_tasks()}),
            ('r_server_info.json', get_r_server_info),
        ]:
            try:
                write_json(name, collect())
            except Exception as exc:
                print(f'Error collecting {name}: {exc}', flush=True)
        time.sleep(30)


if __name__ == '__main__':
    main()

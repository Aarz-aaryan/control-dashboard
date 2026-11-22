"""Read-only NVIDIA temperatures from the two fixed Pearl miners over SSH.

Uses existing Tailscale SSH authorization; never stores or forwards passwords.
"""
import csv
import io
import subprocess

SOURCES = {f'/api/crypto/gpu/{host}': host for host in ('mx1', 'mx2')}
COMMAND = 'nvidia-smi --query-gpu=index,name,temperature.gpu --format=csv,noheader,nounits'


def parse(output):
    gpus = []
    seen = set()
    for row in csv.reader(io.StringIO(output)):
        if len(row) != 3:
            raise ValueError('Unexpected GPU telemetry')
        index, name, temperature = (value.strip() for value in row)
        if not index.isdigit() or int(index) in seen or not name or len(name) > 160:
            raise ValueError('Invalid GPU identity')
        value = None if temperature in ('N/A', '[N/A]', '[Not Supported]') else int(temperature)
        if value is not None and not 0 <= value <= 150:
            raise ValueError('Invalid GPU temperature')
        seen.add(int(index))
        gpus.append({'index': int(index), 'name': name, 'temperature_c': value})
    if not gpus or len(gpus) > 16:
        raise ValueError('Missing or oversized GPU telemetry')
    return gpus


def load(host):
    if host not in SOURCES.values():
        raise ValueError('Unsupported miner')
    result = subprocess.run(
        ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
         '-o', 'ConnectTimeout=6', '-o', 'ConnectionAttempts=1',
         '-o', 'ServerAliveInterval=4', '-o', 'ServerAliveCountMax=1',
         f'{host}@{host}', COMMAND],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=12, check=True,
    )
    return {'host': host, 'gpus': parse(result.stdout)}

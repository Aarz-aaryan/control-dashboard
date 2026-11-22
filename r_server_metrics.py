"""Structured, unprivileged and read-only Linux telemetry over existing SSH."""
import json
import shlex

REMOTE_SCRIPT = r'''
import datetime,json,os,pathlib,shutil,subprocess
m={}
for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
    k,v=line.split(':',1);m[k]=int(v.split()[0])*1024
out={'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
     'uptime_seconds':float(pathlib.Path('/proc/uptime').read_text().split()[0]),
     'load_average':list(os.getloadavg()),'cpu_count':os.cpu_count(),
     'memory':{'total':m['MemTotal'],'available':m['MemAvailable'],
               'cache':m.get('Cached',0),'swap_total':m.get('SwapTotal',0),
               'swap_free':m.get('SwapFree',0)},'disks':[]}
for path,label,uuid in [('/', 'System SSD', '1b0f034a-196a-47d8-8e5c-811f594b4e3b'),
    ('/mnt/disk2','Immich backup HDD','0a0f26cf-8eaa-4fa1-ad3b-f3c6be8caa99'),
    ('/mnt/backup','Historical backups HDD','6A0D-ED06')]:
    d={'path':path,'label':label,'mounted':False}
    try:
        r=subprocess.run(['findmnt','-rn','-M',path,'-o','UUID'],capture_output=True,text=True,timeout=2,check=True)
        d['mounted']=r.stdout.strip()==uuid
        if d['mounted']:
            u=shutil.disk_usage(path);d.update(total=u.total,used=u.used,free=u.free)
    except (OSError,subprocess.SubprocessError):pass
    out['disks'].append(d)
print(json.dumps(out))
'''


def collect(remote):
    output, ok = remote('python3 -c ' + shlex.quote(REMOTE_SCRIPT))
    if ok:
        try:
            data = json.loads(output)
            if isinstance(data, dict):
                return {'ok': True, 'data': data}
        except ValueError:
            pass
    return {'ok': False, 'data': None}

import json, os
from pathlib import Path
path = Path("missions_details.json")
data = json.loads(path.read_text())
tmp = path.with_suffix(f".tmp.{os.getpid()}")
with tmp.open("w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
    f.flush()
    os.fsync(f.fileno())
os.replace(tmp, path)

"""Read-only, fixed-upstream crypto/telemetry API with bounded caching."""
import json
import threading
import time
from urllib.request import Request, urlopen
import mining_api

_lock = threading.Lock()
_cache = {}
SOURCES = {
    '/api/crypto/pi': ('http://100.110.11.122:5000/api', 20),
    **{path: (None, 120) for path in mining_api.SOURCES},
}
_source_locks = {path: threading.Lock() for path in SOURCES}

def serve(handler, path):
    # Coalesce concurrent viewers instead of multiplying requests to F2Pool.
    with _source_locks[path]:
        return _serve(handler, path)

def _serve(handler, path):
    url, ttl = SOURCES[path]
    with _lock:
        cached = _cache.get(path)
    if cached and time.time() - cached['fetched_at'] < ttl:
        result = dict(cached, stale=False)
    else:
        try:
            if path in mining_api.SOURCES:
                data = mining_api.load(*mining_api.SOURCES[path])
            else:
                with urlopen(Request(url, headers={'User-Agent': 'PiMonitor/1.0'}), timeout=8) as response:
                    data = json.load(response)
            result = {'data': data, 'fetched_at': time.time(), 'stale': False}
            with _lock:
                _cache[path] = result
        except Exception:
            if not cached:
                handler._json(502, b'{"error":"Source unavailable; retrying automatically"}')
                return
            result = dict(cached, stale=True)
    handler._json(200, json.dumps(result).encode())

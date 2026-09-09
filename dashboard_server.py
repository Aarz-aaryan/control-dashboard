#!/usr/bin/env python3
"""
dashboard_server.py — static file server + same-origin API proxy for the
Control Dashboard. Replaces `python3 -m http.server`.

Why this exists:
  * The old setup exposed the mission write-API on 0.0.0.0:8001 with open CORS,
    which made `gh repo create/delete` reachable (and CSRF-able) from anything on
    the network. Now the browser only ever talks to THIS server, same-origin, and
    missions_http_server.py binds 127.0.0.1 only.

Serves:
  GET  /<anything>            -> static files from --directory (default ~/dashboard-www)
  GET  /api/token             -> the shared write token (only reachable on the bound IP)
  GET  /api/missions/state    -> proxied to 127.0.0.1:8001 (read-only, no token)
  POST /api/missions/<action> -> proxied to 127.0.0.1:8001, requires X-Dashboard-Token

Usage:
  dashboard_server.py [--bind 100.100.35.6] [--port 8000] [--directory DIR]
                      [--backend 127.0.0.1:8001] [--token-file PATH]
"""
import argparse
import http.client
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_DIR = os.path.expanduser("~/dashboard-www")
# Kept OUTSIDE the served directory tree on purpose.
DEFAULT_TOKEN_FILE = os.path.expanduser("~/.dashboard_token")
BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8001
WRITE_TOKEN = ""  # populated in main()

API_PREFIX = "/api/missions/"


class Handler(SimpleHTTPRequestHandler):
    # SimpleHTTPRequestHandler honors `directory=` passed via functools.partial.

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[dashboard] {self.address_string()} - {fmt % args}\n")

    # ── API routing ────────────────────────────────────────────────────────────

    def do_OPTIONS(self):
        # Same-origin only; a bare 204 is enough.
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_head(self):
        # Block any dotfile / dotdir from static serving (.git, .gitignore, …).
        from urllib.parse import unquote, urlsplit
        parts = urlsplit(self.path).path.split("/")
        if any(seg.startswith(".") and seg not in (".", "..") for seg in map(unquote, parts)):
            self.send_error(404, "Not found")
            return None
        return super().send_head()

    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/agent-dashboard/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/api/token":
            body = WRITE_TOKEN.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith(API_PREFIX) or self.path == "/api/missions/state":
            return self._proxy("GET")
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith(API_PREFIX):
            self.send_error(404, "Not found")
            return
        # Gate every write on the shared token.
        if self.headers.get("X-Dashboard-Token", "") != WRITE_TOKEN:
            self._json(403, b'{"ok": false, "error": "missing or bad X-Dashboard-Token"}')
            return
        return self._proxy("POST")

    # ── proxy helper ───────────────────────────────────────────────────────────

    def _proxy(self, method: str):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        try:
            conn = http.client.HTTPConnection(BACKEND_HOST, BACKEND_PORT, timeout=15)
            headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
            if body:
                headers["Content-Length"] = str(len(body))
            conn.request(method, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            self.send_response(resp.status)
            self.send_header("Content-Type", resp.getheader("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            conn.close()
        except (ConnectionRefusedError, OSError, http.client.HTTPException) as e:
            self._json(502, f'{{"ok": false, "error": "backend unreachable: {e}"}}'.encode())

    def _json(self, code: int, body: bytes):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def load_or_create_token(path: str) -> str:
    if os.path.exists(path):
        tok = open(path).read().strip()
        if tok:
            return tok
    import secrets
    tok = secrets.token_urlsafe(32)
    old_umask = os.umask(0o077)
    try:
        with open(path, "w") as f:
            f.write(tok + "\n")
    finally:
        os.umask(old_umask)
    return tok


def main() -> int:
    global WRITE_TOKEN, BACKEND_HOST, BACKEND_PORT
    p = argparse.ArgumentParser(description="Control Dashboard static + API server")
    p.add_argument("--bind", default="100.100.35.6")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--directory", default=DEFAULT_DIR)
    p.add_argument("--backend", default=f"{BACKEND_HOST}:{BACKEND_PORT}")
    p.add_argument("--token-file", default=DEFAULT_TOKEN_FILE)
    args = p.parse_args()

    BACKEND_HOST, port_s = args.backend.split(":")
    BACKEND_PORT = int(port_s)
    WRITE_TOKEN = load_or_create_token(args.token_file)

    from functools import partial
    handler = partial(Handler, directory=args.directory)
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    print(f"[dashboard] serving {args.directory} on {args.bind}:{args.port}, "
          f"proxying {API_PREFIX}* -> {BACKEND_HOST}:{BACKEND_PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())

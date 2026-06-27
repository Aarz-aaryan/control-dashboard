#!/usr/bin/env python3
"""
missions_http_server.py — tiny HTTP endpoint for the dashboard UI to call.

Listens on 0.0.0.0:8001 (CORS open for localhost:8000 and 100.100.35.6:8000).
POST /api/missions/{action} with JSON body {"repo": "<name>"} (or {"repo":"...","status":"..."}).

Actions: toggle | delete | restore | set-status | classify-project | unclassify-project | promote | demote
GET  /api/missions/state          -> returns missions_state.json as JSON
GET  /health                      -> 200 OK "ok"

Delegates to missions_writer.py so all writes go through the same code path.
"""
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WRITER = ROOT / "missions_writer.py"
STATE_FILE = ROOT / "missions_state.json"
PORT = 8001

ALLOWED_ACTIONS = {
    "toggle", "delete", "restore", "set-status",
    "classify-project", "unclassify-project", "promote", "demote",
    "set-priority", "reorder-missions",
}

# CORS allowlist — open for the dashboard origin and any localhost variant
ALLOWED_ORIGINS = {
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://100.100.35.6:8000",
    "http://100.84.224.18:8000",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Quieter logs — write to stderr only
        sys.stderr.write(f"[missions_http] {self.address_string()} - {format % args}\n")
        sys.stderr.flush()

    def _set_cors(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, code: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._set_cors()
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, code: int, text: str):
        body = text.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self._set_cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._send_text(200, "ok")
        if self.path == "/api/missions/state":
            try:
                # Force-load via the writer so any v1 → v2 migration happens before serve.
                # This ensures the UI always sees a v2-shaped state with priority/order fields.
                import importlib
                wr = importlib.import_module("missions_writer")
                importlib.reload(wr)  # in case state was edited mid-run
                state = wr.load_state()
                # Persist the migrated state back so disk reflects what's served.
                # Cheap and idempotent — only writes if version changed or fields missing.
                on_disk = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else None
                needs_save = (
                    on_disk is None
                    or on_disk.get("_version") != state.get("_version")
                    or any(
                        (not isinstance(v, dict))
                        or ("priority" not in v)
                        or ("order" not in v)
                        for v in state.get("missions", {}).values()
                    )
                )
                if needs_save:
                    wr.save_state(state, modified_by="migration")
                return self._send_json(200, state)
            except Exception as e:
                return self._send_json(500, {"ok": False, "error": str(e)})
        if self.path.startswith("/api/missions/"):
            action = self.path[len("/api/missions/"):]
            if action in ALLOWED_ACTIONS:
                # GET on an action endpoint -> 405
                return self._send_json(405, {"ok": False, "error": "Use POST"})
        return self._send_json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if not self.path.startswith("/api/missions/"):
            return self._send_json(404, {"ok": False, "error": "Not found"})
        action = self.path[len("/api/missions/"):]
        if action not in ALLOWED_ACTIONS:
            return self._send_json(400, {"ok": False, "error": f"Unknown action: {action}"})

        # Read body
        length = int(self.headers.get("Content-Length") or 0)
        try:
            raw = self.rfile.read(length).decode() if length else "{}"
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError as e:
            return self._send_json(400, {"ok": False, "error": f"Invalid JSON: {e}"})

        # ─── Dispatch by action ──────────────────────────────────────
        # Some actions don't take a "repo" field — handle them first.
        if action == "reorder-missions":
            order = body.get("order")
            if not isinstance(order, list) or not order or not all(isinstance(x, str) for x in order):
                return self._send_json(400, {"ok": False, "error": "reorder-missions requires JSON body {\"order\": [\"repo1\", \"repo2\", ...]}"})
            cmd = [sys.executable, str(WRITER), action] + order
            return self._run_writer(cmd)

        # All other actions need a repo
        repo = body.get("repo")
        if not repo or not isinstance(repo, str):
            return self._send_json(400, {"ok": False, "error": "Missing or invalid 'repo' in body"})

        # Build CLI command
        cmd = [sys.executable, str(WRITER), action, repo]
        if action == "set-status":
            status = body.get("status")
            if not status:
                return self._send_json(400, {"ok": False, "error": "Missing 'status' for set-status"})
            cmd.append(status)
        elif action == "set-priority":
            priority = body.get("priority")
            if priority is None or not isinstance(priority, int):
                return self._send_json(400, {"ok": False, "error": "Missing or invalid 'priority' (int 1-99) for set-priority"})
            cmd.append(str(priority))
        elif action == "promote":
            priority = body.get("priority")
            if priority is not None:
                if not isinstance(priority, int):
                    return self._send_json(400, {"ok": False, "error": "'priority' must be int (1-99)"})
                cmd.extend(["--priority", str(priority)])

        return self._run_writer(cmd)

    def _run_writer(self, cmd):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, cwd=str(ROOT))
        except subprocess.TimeoutExpired:
            return self._send_json(504, {"ok": False, "error": "Writer timed out"})
        except Exception as e:
            return self._send_json(500, {"ok": False, "error": f"Writer failed: {e}"})

        if result.returncode != 0:
            try:
                payload = json.loads(result.stdout) if result.stdout else {"ok": False, "error": result.stderr or "writer failed"}
            except json.JSONDecodeError:
                payload = {"ok": False, "error": result.stdout or result.stderr or "writer failed"}
            return self._send_json(400, payload)

        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            payload = {"ok": False, "error": "Writer produced invalid JSON"}
        code = 200 if payload.get("ok") else 400
        return self._send_json(code, payload)


def main() -> int:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[missions_http] listening on 0.0.0.0:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[missions_http] shutting down", flush=True)
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
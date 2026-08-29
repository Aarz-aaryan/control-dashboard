#!/usr/bin/env python3
"""
missions_http_server.py — tiny HTTP endpoint for the dashboard UI to call.

Listens on 0.0.0.0:8001 (CORS open for localhost:8000 and 100.100.35.6:8000).
POST /api/missions/{action} with JSON body {"repo": "<name>"} (or {"repo":"...","status":"..."}).

State actions (delegated to missions_writer.py):
  toggle | delete | restore | set-status | classify-project | unclassify-project | promote | demote
  set-priority | reorder-missions | create | remove

Repo actions (this server performs gh CLI calls, then updates state):
  POST /api/missions/create-repo   {"title", "description", "kind", "priority", "private"}
                                  → creates GitHub repo via `gh repo create`, then classifies in state.
  POST /api/missions/delete-repo   {"repo"}
                                  → deletes GitHub repo via `gh repo delete`, then removes from state.

GET  /api/missions/state          -> returns missions_state.json as JSON
GET  /health                      -> 200 OK "ok"
"""
import json
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WRITER = ROOT / "missions_writer.py"
STATE_FILE = ROOT / "missions_state.json"
REPOS_FILE = ROOT / "repos.json"
PORT = 8001

# State-only actions delegated to missions_writer.py
STATE_ACTIONS = {
    "toggle", "delete", "restore", "set-status",
    "classify-project", "unclassify-project", "promote", "demote",
    "set-priority", "reorder-missions", "create", "remove",
}

# Repo-level actions handled by this server (gh CLI + state update)
REPO_ACTIONS = {"create-repo", "delete-repo"}

ALLOWED_ACTIONS = STATE_ACTIONS | REPO_ACTIONS

# CORS allowlist — open for the dashboard origin and any localhost variant
ALLOWED_ORIGINS = {
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://100.100.35.6:8000",
    "http://100.84.224.18:8000",
}


# ─── Repo-action helpers (gh CLI) ───────────────────────────────────────────────

def _slugify_repo_name(title: str) -> str:
    """Convert a user-provided title into a valid GitHub repo name.
    Rules: lowercase, alphanumerics + hyphen, no leading/trailing hyphens,
    max 100 chars. Replace spaces and underscores with hyphens.
    """
    s = title.strip().lower()
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"[^a-z0-9.\-]", "", s)
    s = re.sub(r"-+", "-", s)
    s = s.strip("-.")
    if not s:
        return ""
    return s[:100]


def _gh_create_repo(name: str, description: str, private: bool = False) -> tuple[bool, str]:
    """Run `gh repo create` and return (ok, error_or_url). Uses the Aarz-aaryan account.
    Returns (True, repo_url) on success, (False, error_string) on failure.
    """
    cmd = [
        "gh", "repo", "create", f"Aarz-aaryan/{name}",
        "--description", description or "",
        "--confirm",
    ]
    if private:
        cmd.append("--private")
    else:
        cmd.append("--public")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if res.returncode == 0:
            # gh returns the URL on success
            url = (res.stdout or "").strip()
            # Some versions print the URL; if not, construct it
            if not url.startswith("http"):
                url = f"https://github.com/Aarz-aaryan/{name}"
            return True, url
        err = (res.stderr or res.stdout or "").strip()
        # Detect "already exists" → treat as success path (idempotent re-create)
        if "already exists" in err.lower():
            return True, f"https://github.com/Aarz-aaryan/{name}"
        return False, err or f"gh exited {res.returncode}"
    except subprocess.TimeoutExpired:
        return False, "gh repo create timed out"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def _gh_delete_repo(name: str) -> tuple[bool, str]:
    """Run `gh repo delete`. Requires --confirm because deletion is permanent.
    Returns (True, "") on success, (False, error_string) on failure.
    """
    cmd = ["gh", "repo", "delete", f"Aarz-aaryan/{name}", "--yes"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if res.returncode == 0:
            return True, ""
        err = (res.stderr or res.stdout or "").strip()
        # Detect "not found" — already deleted
        if "not found" in err.lower() or "404" in err:
            return True, ""  # idempotent — already gone
        return False, err or f"gh exited {res.returncode}"
    except subprocess.TimeoutExpired:
        return False, "gh repo delete timed out"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def _refresh_repos_json() -> int:
    """Re-fetch repos.json from GitHub so the new (or removed) repo shows up immediately.
    Runs update_repos.py --once. Returns the count of repos written (0 if failed).
    """
    try:
        # update_repos.py is a daemon loop; we just want one fetch. Easiest: re-run
        # the same gh command inline.
        from update_repos import fetch_all_repos
        repos = fetch_all_repos()
        if repos is None:
            return 0
        payload = {"_fetched_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(), "repos": repos}
        with open(REPOS_FILE, "w") as f:
            json.dump(payload, f, indent=2)
        return len(repos)
    except Exception as e:
        sys.stderr.write(f"[refresh_repos] failed: {e}\n")
        return 0


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

        # ─── Repo actions (gh CLI + state) ───────────────────────────────────
        if action == "create-repo":
            return self._handle_create_repo(body)
        if action == "delete-repo":
            return self._handle_delete_repo(body)

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

    # ─── Repo action handlers ─────────────────────────────────────────────────────

    def _handle_create_repo(self, body: dict):
        """Create a new GitHub repo + classify in missions_state.json.

        Body: {"title": "<user-facing name>", "description": "<...>",
               "kind": "mission"|"project", "priority": 1-99, "private": bool}
        """
        title = body.get("title") or body.get("repo")
        description = body.get("description") or ""
        kind = body.get("kind") or "mission"
        priority = body.get("priority", 99)
        private = bool(body.get("private", False))

        if not title or not isinstance(title, str):
            return self._send_json(400, {"ok": False, "error": "Missing or invalid 'title' (str)"})
        if kind not in ("mission", "project"):
            return self._send_json(400, {"ok": False, "error": f"Invalid kind '{kind}'. Must be 'mission' or 'project'"})
        if not isinstance(priority, int) or priority < 1 or priority > 99:
            return self._send_json(400, {"ok": False, "error": "priority must be int 1-99"})

        repo_name = _slugify_repo_name(title)
        if not repo_name:
            return self._send_json(400, {"ok": False, "error": f"Title '{title}' produces an invalid repo name. Use letters, numbers, and hyphens."})

        ok, url_or_err = _gh_create_repo(repo_name, description, private=private)
        if not ok:
            return self._send_json(500, {"ok": False, "error": f"gh repo create failed: {url_or_err}"})

        # Update state via writer
        writer_cmd = [sys.executable, str(WRITER), "create", repo_name,
                      "--kind", kind, "--priority", str(priority),
                      "--description", description]
        writer_res = subprocess.run(writer_cmd, capture_output=True, text=True, timeout=10, cwd=str(ROOT))
        try:
            writer_payload = json.loads(writer_res.stdout) if writer_res.stdout else {"ok": False, "error": writer_res.stderr}
        except json.JSONDecodeError:
            writer_payload = {"ok": False, "error": "Writer produced invalid JSON"}

        # Refresh repos.json so the new repo shows up in the UI immediately
        repo_count = _refresh_repos_json()

        if not writer_payload.get("ok"):
            return self._send_json(500, {
                "ok": False,
                "error": f"GitHub repo created at {url_or_err}, but state update failed: {writer_payload.get('error')}",
                "repo": repo_name,
                "url": url_or_err,
                "repos_count": repo_count,
            })

        return self._send_json(200, {
            "ok": True,
            "repo": repo_name,
            "url": url_or_err,
            "kind": kind,
            "priority": priority,
            "private": private,
            "description": description,
            "repos_count": repo_count,
        })

    def _handle_delete_repo(self, body: dict):
        """Delete a GitHub repo + remove from missions_state.json.
        Body: {"repo": "<name>"}
        """
        repo = body.get("repo")
        if not repo or not isinstance(repo, str):
            return self._send_json(400, {"ok": False, "error": "Missing or invalid 'repo' (str)"})

        ok, err = _gh_delete_repo(repo)
        if not ok:
            return self._send_json(500, {"ok": False, "error": f"gh repo delete failed: {err}"})

        # Update state via writer
        writer_cmd = [sys.executable, str(WRITER), "remove", repo]
        writer_res = subprocess.run(writer_cmd, capture_output=True, text=True, timeout=10, cwd=str(ROOT))
        try:
            writer_payload = json.loads(writer_res.stdout) if writer_res.stdout else {"ok": False, "error": writer_res.stderr}
        except json.JSONDecodeError:
            writer_payload = {"ok": False, "error": "Writer produced invalid JSON"}

        repo_count = _refresh_repos_json()

        return self._send_json(200, {
            "ok": True,
            "repo": repo,
            "github_deleted": True,
            "state_updated": writer_payload.get("ok", False),
            "repos_count": repo_count,
        })


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
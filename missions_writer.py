#!/usr/bin/env python3
"""
missions_writer.py — CLI for editing missions_state.json.

Usage:
  python3 missions_writer.py toggle <repo>              # active <-> inactive
  python3 missions_writer.py delete <repo>              # mark status=deleted (only if mission exists)
  python3 missions_writer.py restore <repo>             # deleted -> inactive
  python3 missions_writer.py set-status <repo> <status> # explicit set
  python3 missions_writer.py classify-project <repo>    # add to projects list
  python3 missions_writer.py unclassify-project <repo>  # remove from projects list
  python3 missions_writer.py promote <repo>             # project -> mission (active)
  python3 missions_writer.py demote <repo>              # mission -> project

Status values: active | inactive | deleted
Output: JSON to stdout: {"ok": true|false, "repo": "...", "from": "...", "to": "...", "error": "..."}
Side effect: appends one JSON line to missions_activity.jsonl
"""
import sys
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "missions_state.json"
ACTIVITY_LOG = ROOT / "missions_activity.jsonl"

VALID_STATUSES = {"active", "inactive", "deleted"}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {
            "_version": 1,
            "_last_modified": now_iso(),
            "_modified_by": "system",
            "missions": {},
            "projects": [],
        }
    with STATE_FILE.open() as f:
        return json.load(f)


def save_state(state: dict, modified_by: str = "user") -> None:
    state["_last_modified"] = now_iso()
    state["_modified_by"] = modified_by
    # Use a unique tmp path per process to avoid races when multiple writers run concurrently.
    import os
    tmp = STATE_FILE.with_suffix(f".tmp.{os.getpid()}.{os.getpid() % 1000}")
    with tmp.open("w") as f:
        json.dump(state, f, indent=2, sort_keys=False)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    # Use os.replace for atomic rename (POSIX-guaranteed atomic).
    os.replace(tmp, STATE_FILE)


def log_activity(actor: str, action: str, repo: str, frm: str | None, to: str | None) -> None:
    entry = {
        "ts": now_iso(),
        "actor": actor,
        "action": action,
        "repo": repo,
        "from": frm,
        "to": to,
    }
    with ACTIVITY_LOG.open("a") as f:
        f.write(json.dumps(entry) + "\n")


def emit(ok: bool, repo: str, frm: str | None = None, to: str | None = None, error: str | None = None) -> dict:
    out = {"ok": ok, "repo": repo, "from": frm, "to": to}
    if error:
        out["error"] = error
    print(json.dumps(out))
    return out


def cmd_toggle(repo: str) -> dict:
    state = load_state()
    missions = state.setdefault("missions", {})
    projects = state.setdefault("projects", [])
    cur = missions.get(repo, {}).get("status")
    if cur is None:
        # Do NOT auto-create missions via toggle. Repo must already be classified.
        if repo not in projects:
            return emit(False, repo, None, None, error=f"'{repo}' is not a known mission or project — use promote first")
        return emit(False, repo, None, None, error=f"'{repo}' is a project, not a mission — use promote to convert it")
    if cur == "active":
        nxt = "inactive"
    elif cur == "inactive":
        nxt = "active"
    elif cur == "deleted":
        return emit(False, repo, cur, None, error="Cannot toggle deleted mission; use restore first")
    else:
        return emit(False, repo, cur, None, error=f"Unknown status: {cur}")
    missions[repo] = {"status": nxt, "updated_at": now_iso()}
    save_state(state, modified_by="user")
    log_activity("user", "toggle", repo, cur, nxt)
    return emit(True, repo, cur, nxt)


def cmd_delete(repo: str) -> dict:
    state = load_state()
    missions = state.setdefault("missions", {})
    cur = missions.get(repo, {}).get("status")
    if cur is None:
        return emit(False, repo, None, None, error=f"No mission entry for '{repo}' — only missions can be deleted, not projects")
    missions[repo] = {"status": "deleted", "updated_at": now_iso()}
    save_state(state, modified_by="user")
    log_activity("user", "delete", repo, cur, "deleted")
    return emit(True, repo, cur, "deleted")


def cmd_restore(repo: str) -> dict:
    state = load_state()
    missions = state.setdefault("missions", {})
    cur = missions.get(repo, {}).get("status")
    if cur is None:
        return emit(False, repo, cur, None, error="No entry to restore")
    missions[repo] = {"status": "inactive", "updated_at": now_iso()}
    save_state(state, modified_by="user")
    log_activity("user", "restore", repo, cur, "inactive")
    return emit(True, repo, cur, "inactive")


def cmd_set_status(repo: str, status: str) -> dict:
    if status not in VALID_STATUSES:
        return emit(False, repo, None, None, error=f"Invalid status '{status}'. Must be one of {sorted(VALID_STATUSES)}")
    state = load_state()
    missions = state.setdefault("missions", {})
    cur = missions.get(repo, {}).get("status")
    missions[repo] = {"status": status, "updated_at": now_iso()}
    save_state(state, modified_by="user")
    log_activity("user", "set-status", repo, cur, status)
    return emit(True, repo, cur, status)


def cmd_classify(repo: str) -> dict:
    """Add a repo as a project (idempotent)."""
    state = load_state()
    projects = state.setdefault("projects", [])
    if repo in projects:
        return emit(True, repo, None, None)  # already classified
    projects.append(repo)
    projects.sort()
    save_state(state, modified_by="user")
    log_activity("user", "classify-project", repo, None, None)
    return emit(True, repo, None, None)


def cmd_unclassify(repo: str) -> dict:
    """Remove repo from projects list (does not affect missions)."""
    state = load_state()
    projects = state.setdefault("projects", [])
    if repo not in projects:
        return emit(True, repo, None, None)
    projects.remove(repo)
    save_state(state, modified_by="user")
    log_activity("user", "unclassify-project", repo, None, None)
    return emit(True, repo, None, None)


def cmd_promote(repo: str) -> dict:
    """Move a repo from projects to missions as active."""
    state = load_state()
    projects = state.setdefault("projects", [])
    missions = state.setdefault("missions", {})
    if repo in projects:
        projects.remove(repo)
    cur = missions.get(repo, {}).get("status")
    if cur in {"inactive", "deleted"}:
        # Don't auto-promote from deleted/inactive — require explicit restore first
        return emit(False, repo, cur, None, error=f"Mission is '{cur}' — restore it first, then promote")
    missions[repo] = {"status": "active", "updated_at": now_iso()}
    save_state(state, modified_by="user")
    log_activity("user", "promote", repo, cur, "active")
    return emit(True, repo, cur, "active")


def cmd_demote(repo: str) -> dict:
    """Move a mission to projects (removes from missions)."""
    state = load_state()
    projects = state.setdefault("projects", [])
    missions = state.setdefault("missions", {})
    cur = missions.pop(repo, None)
    if repo not in projects:
        projects.append(repo)
        projects.sort()
    save_state(state, modified_by="user")
    log_activity("user", "demote", repo, cur.get("status") if cur else None, None)
    return emit(True, repo, cur.get("status") if cur else None, None)


def usage() -> None:
    print(__doc__, file=sys.stderr)
    sys.exit(2)


def main() -> int:
    if len(sys.argv) < 2:
        usage()
    cmd = sys.argv[1]
    if cmd in {"-h", "--help", "help"}:
        usage()
    args = sys.argv[2:]
    try:
        if cmd == "toggle":
            if len(args) != 1: usage()
            res = cmd_toggle(args[0])
        elif cmd == "delete":
            if len(args) != 1: usage()
            res = cmd_delete(args[0])
        elif cmd == "restore":
            if len(args) != 1: usage()
            res = cmd_restore(args[0])
        elif cmd == "set-status":
            if len(args) != 2: usage()
            res = cmd_set_status(args[0], args[1])
        elif cmd == "classify-project":
            if len(args) != 1: usage()
            res = cmd_classify(args[0])
        elif cmd == "unclassify-project":
            if len(args) != 1: usage()
            res = cmd_unclassify(args[0])
        elif cmd == "promote":
            if len(args) != 1: usage()
            res = cmd_promote(args[0])
        elif cmd == "demote":
            if len(args) != 1: usage()
            res = cmd_demote(args[0])
        else:
            print(json.dumps({"ok": False, "error": f"Unknown command: {cmd}"}))
            return 2
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        return 1
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
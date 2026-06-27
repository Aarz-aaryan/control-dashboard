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
  python3 missions_writer.py promote [repo] [--priority N]  # project -> mission (active). If repo omitted, uses stdin JSON {repo, priority}.
  python3 missions_writer.py demote <repo>              # mission -> project
  python3 missions_writer.py set-priority <repo> <N>    # set priority (lower = more important)
  python3 missions_writer.py reorder-missions <a> <b> <c>...  # explicit display order (active+inactive)

Status values: active | inactive | deleted
Output: JSON to stdout: {"ok": true|false, "repo": "...", "from": "...", "to": "...", "error": "..."}
Side effect: appends one JSON line to missions_activity.jsonl

Schema (v2):
  missions_state.json: {
    "_version": 2,
    "missions": {
      "<repo>": {
        "status": "active"|"inactive"|"deleted",
        "priority": <int 1-99>,      # lower = more important (1 = top)
        "order": <int>,               # display position within priority tier
        "updated_at": "<ISO8601>"
      }
    },
    "projects": ["<repo>", ...]  # sorted alphabetically
  }

Legacy v1 state files are auto-migrated: missing priority defaults to 99, order assigned by alphabetical.
"""

DEFAULT_PRIORITY = 99  # lowest — new promotes start here
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
    # Microsecond precision so rapid-fire actions get unique timestamps in
    # the activity log (otherwise same-second toggles look indistinguishable).
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def load_state() -> dict:
    """Load state, recovering gracefully from corrupt/missing/empty files.

    Auto-migrates v1 → v2: any mission missing `priority` or `order` gets defaults
    (priority=99, order=insertion-alphabetical). Safe to call repeatedly.
    """
    if not STATE_FILE.exists():
        return {
            "_version": 2,
            "_last_modified": now_iso(),
            "_modified_by": "system",
            "missions": {},
            "projects": [],
        }
    try:
        with STATE_FILE.open() as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"ERROR: missions_state.json is corrupt JSON: {e}\n")
        sys.exit(2)
    if not isinstance(data, dict):
        sys.stderr.write(f"ERROR: missions_state.json is not a dict (got {type(data).__name__})\n")
        sys.exit(2)
    if "missions" not in data or not isinstance(data["missions"], dict):
        data["missions"] = {}
    if "projects" not in data or not isinstance(data["projects"], list):
        data["projects"] = []
    data["_version"] = 2

    # Migrate missions: ensure priority + order on every entry
    missions = data["missions"]
    migrated = False
    # Sort by name so order is deterministic across runs of v1→v2 migration
    sorted_names = sorted(missions.keys())
    for idx, name in enumerate(sorted_names):
        entry = missions[name]
        if not isinstance(entry, dict):
            # Fix malformed entry
            missions[name] = {"status": "deleted", "priority": DEFAULT_PRIORITY, "order": idx, "updated_at": now_iso()}
            migrated = True
            continue
        if "priority" not in entry or not isinstance(entry["priority"], int):
            entry["priority"] = DEFAULT_PRIORITY
            migrated = True
        elif entry["priority"] < 1 or entry["priority"] > 99:
            entry["priority"] = max(1, min(99, entry["priority"]))
            migrated = True
        if "order" not in entry or not isinstance(entry["order"], int):
            entry["order"] = idx
            migrated = True
    if migrated:
        # Persist migration on next save; don't write here (caller will save)
        pass

    return data


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
    # Preserve priority + order across status transitions — only status + updated_at change.
    cur_entry = missions.get(repo, {})
    missions[repo] = {**cur_entry, "status": nxt, "updated_at": now_iso()}
    save_state(state, modified_by="user")
    log_activity("user", "toggle", repo, cur, nxt)
    return emit(True, repo, cur, nxt)


def cmd_delete(repo: str) -> dict:
    state = load_state()
    missions = state.setdefault("missions", {})
    cur = missions.get(repo, {}).get("status")
    if cur is None:
        return emit(False, repo, None, None, error=f"No mission entry for '{repo}' — only missions can be deleted, not projects")
    # Preserve priority + order across status transitions
    cur_entry = missions.get(repo, {})
    missions[repo] = {**cur_entry, "status": "deleted", "updated_at": now_iso()}
    save_state(state, modified_by="user")
    log_activity("user", "delete", repo, cur, "deleted")
    return emit(True, repo, cur, "deleted")


def cmd_restore(repo: str) -> dict:
    state = load_state()
    missions = state.setdefault("missions", {})
    cur = missions.get(repo, {}).get("status")
    if cur is None:
        return emit(False, repo, cur, None, error="No entry to restore")
    # Preserve priority + order across status transitions
    cur_entry = missions.get(repo, {})
    missions[repo] = {**cur_entry, "status": "inactive", "updated_at": now_iso()}
    save_state(state, modified_by="user")
    log_activity("user", "restore", repo, cur, "inactive")
    return emit(True, repo, cur, "inactive")


def cmd_set_status(repo: str, status: str) -> dict:
    if status not in VALID_STATUSES:
        return emit(False, repo, None, None, error=f"Invalid status '{status}'. Must be one of {sorted(VALID_STATUSES)}")
    state = load_state()
    missions = state.setdefault("missions", {})
    cur = missions.get(repo, {}).get("status")
    # Preserve priority + order across status transitions
    cur_entry = missions.get(repo, {})
    missions[repo] = {**cur_entry, "status": status, "updated_at": now_iso()}
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


def cmd_promote(repo: str, priority: int = DEFAULT_PRIORITY) -> dict:
    """Move a repo from projects to missions as active. Rejects unknown repos.

    `priority` defaults to DEFAULT_PRIORITY (lowest) — callers should explicitly
    set this for new missions they care about.
    """
    if not isinstance(priority, int) or priority < 1 or priority > 99:
        return emit(False, repo, None, None, error=f"Invalid priority {priority!r}; must be int 1-99")
    state = load_state()
    projects = state.setdefault("projects", [])
    missions = state.setdefault("missions", {})
    cur = missions.get(repo, {}).get("status")
    if cur in {"inactive", "deleted"}:
        # Don't auto-promote from deleted/inactive — require explicit restore first
        return emit(False, repo, cur, None, error=f"Mission is '{cur}' — restore it first, then promote")
    if cur is None and repo not in projects:
        return emit(False, repo, None, None, error=f"'{repo}' is not a known project — classify-project first or check the repo name")
    if repo in projects:
        projects.remove(repo)
    # order = max existing + 1 so it appears at the end of its priority tier
    existing_orders = [e.get("order", 0) for e in missions.values() if isinstance(e, dict)]
    new_order = (max(existing_orders) + 1) if existing_orders else 0
    missions[repo] = {"status": "active", "priority": priority, "order": new_order, "updated_at": now_iso()}
    save_state(state, modified_by="user")
    log_activity("user", "promote", repo, cur, "active")
    return emit(True, repo, cur, "active")


def cmd_set_priority(repo: str, priority: int) -> dict:
    """Set priority for an existing mission. Lower number = more important (1 = top)."""
    if not isinstance(priority, int) or priority < 1 or priority > 99:
        return emit(False, repo, None, None, error=f"Invalid priority {priority!r}; must be int 1-99")
    state = load_state()
    missions = state.setdefault("missions", {})
    if repo not in missions:
        return emit(False, repo, None, None, error=f"'{repo}' is not a mission — promote it first")
    entry = missions[repo]
    cur_priority = entry.get("priority", DEFAULT_PRIORITY)
    entry["priority"] = priority
    entry["updated_at"] = now_iso()
    save_state(state, modified_by="user")
    log_activity("user", "set-priority", repo, str(cur_priority), str(priority))
    return emit(True, repo, str(cur_priority), str(priority))


def cmd_reorder_missions(repo_order: list) -> dict:
    """Set the explicit display order of all (or subset of) missions.

    `repo_order` is a list of repo names in the desired display order. Any mission
    not in the list gets an order beyond the listed ones. Reordering does NOT
    change priority — use set-priority for that. Reordering only affects display.
    """
    if not repo_order or not all(isinstance(r, str) for r in repo_order):
        return emit(False, "", None, None, error="repo_order must be a non-empty list of repo names")
    state = load_state()
    missions = state.setdefault("missions", {})
    unknown = [r for r in repo_order if r not in missions]
    if unknown:
        return emit(False, ", ".join(unknown), None, None, error=f"Unknown missions: {unknown}")
    # Assign explicit orders; everything else goes after with stable fallback
    explicit_orders = {r: i for i, r in enumerate(repo_order)}
    n = len(repo_order)
    for r, entry in missions.items():
        if r in explicit_orders:
            entry["order"] = explicit_orders[r]
        else:
            # Not in the explicit list — push it to the end, but preserve relative alpha order
            pass  # handled below
    # For missions not in the explicit list, assign orders after the explicit ones
    others = [r for r in missions.keys() if r not in explicit_orders]
    others.sort()  # stable fallback
    for i, r in enumerate(others):
        missions[r]["order"] = n + i
    # Touch updated_at only for changed entries
    now = now_iso()
    for r, entry in missions.items():
        entry["updated_at"] = now
    save_state(state, modified_by="user")
    log_activity("user", "reorder-missions", "", None, ",".join(repo_order))
    return emit(True, "", None, ",".join(repo_order))


def cmd_demote(repo: str) -> dict:
    """Move a mission to projects. Keeps the entry with status='inactive' so
    it can be re-promoted later without losing priority/order. ADDS the repo
    back to state.projects (idempotent) so the renderer correctly shows it
    in the Projects section — the renderer reads the project list from
    state.projects[], not from missions[].status==='inactive'.
    """
    state = load_state()
    projects = state.setdefault("projects", [])
    missions = state.setdefault("missions", {})
    if repo not in missions:
        return emit(False, repo, None, None, error=f"'{repo}' is not a known mission — cannot demote")
    cur_entry = missions[repo]
    cur_status = cur_entry.get("status") if isinstance(cur_entry, dict) else None
    if cur_status not in ("active", "inactive"):
        return emit(False, repo, cur_status, None, error=f"Mission is '{cur_status}' — cannot demote")
    # Keep the entry but flip to inactive — preserves priority/order for future promote
    missions[repo] = {
        **cur_entry,
        "status": "inactive",
        "updated_at": now_iso(),
    }
    # Add the repo back to state.projects so the renderer classifies it as a project.
    # Without this, the repo would only show up in the INACTIVE MISSIONS section
    # (because missions[repo].status === 'inactive'), which doesn't match the
    # user's mental model of "demoted = back to projects list".
    if repo not in projects:
        projects.append(repo)
        projects.sort()
    save_state(state, modified_by="user")
    log_activity("user", "demote", repo, cur_status, "inactive")
    return emit(True, repo, cur_status, "inactive")


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
            # Accept: promote <repo>   OR   promote <repo> --priority N
            if len(args) < 1 or len(args) > 3: usage()
            repo = args[0]
            priority = DEFAULT_PRIORITY
            if len(args) == 3:
                if args[1] != "--priority": usage()
                try:
                    priority = int(args[2])
                except ValueError:
                    emit(False, repo, None, None, error=f"Priority must be int, got {args[2]!r}")
                    return 1
            elif len(args) == 2:
                # Could be: promote <repo> --priority (missing value) → invalid
                usage()
            res = cmd_promote(repo, priority)
        elif cmd == "demote":
            if len(args) != 1: usage()
            res = cmd_demote(args[0])
        elif cmd == "set-priority":
            if len(args) != 2: usage()
            try:
                priority = int(args[1])
            except ValueError:
                emit(False, args[0], None, None, error=f"Priority must be int, got {args[1]!r}")
                return 1
            res = cmd_set_priority(args[0], priority)
        elif cmd == "reorder-missions":
            if len(args) < 1: usage()
            res = cmd_reorder_missions(list(args))
        else:
            print(json.dumps({"ok": False, "error": f"Unknown command: {cmd}"}))
            return 2
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        return 1
    return 0 if res.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
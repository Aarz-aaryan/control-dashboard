#!/usr/bin/env python3
"""
missions_daemon.py — every 6h, prune missions_state.json.

CRON SPEC (for system crontab if Hermes cron unavailable):
  0 */6 * * * cd /home/Aarz/agent-dashboard && /usr/bin/python3 missions_daemon.py --once >> /tmp/missions_daemon.log 2>&1

Actions on each tick:
  1. Hard-remove any mission with status='deleted' for more than 24 hours
  2. Mark any active mission not seen in repos.json for >7 days as 'inactive'
  3. Log all changes to /tmp/missions_daemon.log
  4. Append to missions_activity.jsonl with actor='system'

Usage:
  python3 missions_daemon.py --once      # run once and exit (default if --once)
  python3 missions_daemon.py --loop      # run forever, sleep 6h between ticks
  python3 missions_daemon.py --interval N # run forever, sleep N seconds between ticks (testing)
"""
import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "missions_state.json"
ACTIVITY_LOG = ROOT / "missions_activity.jsonl"
REPOS_FILE = ROOT / "repos.json"  # written by update_repos.py
LOG_FILE = Path("/tmp/missions_daemon.log")

DELETED_HARD_REMOVE_AFTER_HOURS = 24
STALE_MISSION_DAYS = 7

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("missions_daemon")


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def now_ts() -> float:
    return time.time()


def parse_iso(ts: str) -> float:
    try:
        # Python 3.11+ fromisoformat handles 'Z'
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {"_version": 1, "_last_modified": now_iso(), "_modified_by": "system", "missions": {}, "projects": []}
    with STATE_FILE.open() as f:
        return json.load(f)


def save_state(state: dict) -> None:
    state["_last_modified"] = now_iso()
    state["_modified_by"] = "system"
    # Unique tmp per PID to avoid races when multiple writers/daemons run concurrently.
    import os
    tmp = STATE_FILE.with_suffix(f".tmp.{os.getpid()}.{os.getpid() % 1000}")
    with tmp.open("w") as f:
        json.dump(state, f, indent=2, sort_keys=False)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, STATE_FILE)


def log_activity(action: str, repo: str, frm: str | None, to: str | None) -> None:
    entry = {
        "ts": now_iso(),
        "actor": "system",
        "action": action,
        "repo": repo,
        "from": frm,
        "to": to,
    }
    with ACTIVITY_LOG.open("a") as f:
        f.write(json.dumps(entry) + "\n")


def load_known_repos() -> set[str]:
    """Get set of repo names known to exist (from update_repos.py output)."""
    if not REPOS_FILE.exists():
        return set()
    try:
        with REPOS_FILE.open() as f:
            data = json.load(f)
        if isinstance(data, dict) and "repos" in data:
            return {r["name"] for r in data["repos"] if "name" in r}
        if isinstance(data, list):
            return {r["name"] for r in data if isinstance(r, dict) and "name" in r}
    except Exception as e:
        log.warning(f"Failed to read repos.json: {e}")
    return set()


def tick() -> int:
    """One cleanup pass. Returns count of changes made."""
    state = load_state()
    missions = state.setdefault("missions", {})
    repos = load_known_repos()
    changes = 0
    cutoff_ts = now_ts() - DELETED_HARD_REMOVE_AFTER_HOURS * 3600
    stale_cutoff_ts = now_ts() - STALE_MISSION_DAYS * 24 * 3600

    # 1. Hard-remove long-deleted missions
    for repo in list(missions.keys()):
        entry = missions[repo]
        if entry.get("status") == "deleted":
            updated_ts = parse_iso(entry.get("updated_at", ""))
            if updated_ts and updated_ts < cutoff_ts:
                log.info(f"Hard-removing {repo} (deleted > {DELETED_HARD_REMOVE_AFTER_HOURS}h ago)")
                log_activity("hard-remove", repo, "deleted", None)
                del missions[repo]
                changes += 1

    # 2. Mark active missions as inactive if repo no longer exists OR not seen recently
    if repos:
        for repo, entry in list(missions.items()):
            if entry.get("status") != "active":
                continue
            updated_ts = parse_iso(entry.get("updated_at", ""))
            # If updated_at is recent (< stale window), skip
            if updated_ts and updated_ts > stale_cutoff_ts:
                continue
            # If repo doesn't appear in repos.json at all, mark inactive
            if repo not in repos:
                log.info(f"Marking {repo} inactive (not in repos.json)")
                missions[repo] = {"status": "inactive", "updated_at": now_iso()}
                log_activity("auto-inactive", repo, "active", "inactive")
                changes += 1

    if changes:
        save_state(state)
        log.info(f"Saved state with {changes} changes")
    else:
        log.info("No changes needed")
    return changes


def main() -> int:
    p = argparse.ArgumentParser(description="Mission state sync daemon (runs every 6h by default).")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", default=True, help="Run once and exit (default)")
    mode.add_argument("--loop", action="store_true", help="Run forever, 6h sleep between ticks")
    p.add_argument("--interval", type=int, default=6 * 3600, help="Seconds between ticks (default: 21600 = 6h)")
    args = p.parse_args()

    log.info(f"missions_daemon starting (once={not args.loop}, interval={args.interval}s)")
    try:
        if args.loop:
            while True:
                try:
                    tick()
                except Exception as e:
                    log.exception(f"Tick failed: {e}")
                time.sleep(args.interval)
        else:
            changes = tick()
            log.info(f"Done. {changes} changes.")
    except KeyboardInterrupt:
        log.info("Interrupted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
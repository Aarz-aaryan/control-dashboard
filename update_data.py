#!/usr/bin/env python3
"""
Dashboard background data collector.

Writes four JSON files into /home/Aarz/agent-dashboard every 30s:
  health.json        — local + r-server system health
  missions.json      — cron jobs + kanban tasks
  r_server_info.json — r-server docker/system detail for the r-server tab
  agents.json        — per-agent activity from the real session store
                       (~/.hermes/profiles/<p>/state.db; agy from its CLI logs)

r-server access is over SSH **key auth** (no password). The key at
~/.ssh/id_ed25519 is already authorized on r-server.
"""
import os
import glob
import json
import sqlite3
import subprocess
import time
from datetime import datetime, timezone

OUTPUT_DIR = "/home/Aarz/agent-dashboard"

# Agent roster — only the ones that actually run. Each Hermes agent has its own
# ~/.hermes/profiles/<p>/state.db (the real session store); agy is a separate CLI
# whose runs are one log file each. coder/builder/tester profiles exist but have
# had no activity since Aug 2026 — dropped (like jarvis). Keep in sync with the
# AGENTS array in js/dashboard.js.
HERMES_AGENTS = ["aarz", "scout"]
AGY_LOG_DIR = os.path.expanduser("~/.gemini/antigravity-cli/log")
HERMES_PROFILES_DIR = os.path.expanduser("~/.hermes/profiles")

ACTIVE_H = 6      # activity within this many hours  -> "active"
IDLE_H = 48       # activity within this many hours  -> "idle" (ran on schedule)
                 # older than IDLE_H                -> "dormant"


def iso(ts: float | None) -> str | None:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_local_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
        return res.stdout.strip(), res.returncode == 0
    except Exception as e:
        return f"Error: {e}", False


def run_ssh_cmd(cmd):
    # Escape single quotes for nesting inside the outer single-quoted arg.
    escaped_cmd = cmd.replace("'", "'\\''")
    ssh_prefix = (
        "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "
        "-o ConnectTimeout=5 r-server@100.84.224.18"
    )
    full_cmd = f"{ssh_prefix} '{escaped_cmd}'"
    try:
        res = subprocess.run(full_cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=10)
        return res.stdout.strip(), res.returncode == 0
    except Exception as e:
        return f"Error: {e}", False


def get_health_stats():
    uptime_local, ok1 = run_local_cmd("uptime")
    loadavg_local, ok2 = run_local_cmd("cat /proc/loadavg")
    mem_local, ok3 = run_local_cmd("free -h | grep Mem")
    disk_local, ok4 = run_local_cmd("df -h / | tail -1")

    docker_local, ok5 = run_local_cmd("docker ps --format '{{.Names}}: {{.Status}}'")
    if not ok5 or not docker_local:
        docker_local = "Docker not available"

    hermes_proc_output, ok_hermes = run_local_cmd("pgrep -f hermes")
    hermes_running = "Running" if (ok_hermes and hermes_proc_output) else "Not running"

    uptime_r, ok_r1 = run_ssh_cmd("uptime")
    docker_r, ok_r2 = run_ssh_cmd("sudo docker ps --format '{{.Names}}: {{.Status}}'")
    mem_r, ok_r3 = run_ssh_cmd("free -h")
    disk_r, ok_r4 = run_ssh_cmd("df -h /")

    return {
        "_generated_at": now_iso(),
        "local": {
            "uptime": uptime_local if ok1 else "Unavailable",
            "cpu": loadavg_local if ok2 else "Unavailable",
            "memory": mem_local if ok3 else "Unavailable",
            "disk": disk_local if ok4 else "Unavailable",
            "docker": docker_local,
            "hermes": hermes_running,
            "status": "healthy" if (ok1 and ok2 and ok3 and ok4) else "error"
        },
        "r_server": {
            "uptime": {"output": uptime_r, "ok": ok_r1},
            "docker": {"output": docker_r, "ok": ok_r2},
            "memory": {"output": mem_r, "ok": ok_r3},
            "disk": {"output": disk_r, "ok": ok_r4},
            "status": "healthy" if (ok_r1 and ok_r2 and ok_r3 and ok_r4) else "error"
        }
    }


# ── Agent activity ─────────────────────────────────────────────────────────────
# The real session store is per-profile: ~/.hermes/profiles/<p>/state.db, table
# `sessions` (id, source, started_at, ended_at, last_activity_at, title,
# message_count, ...). We read it directly rather than counting the
# request_dump_*.json diagnostic files that used to be miscounted as "sessions".

def _blank_agent() -> dict:
    return {
        "status": "dormant",
        "last_active": None,
        "last_active_ms": 0,
        "sessions_today": 0,
        "sessions_24h": 0,
        "last_title": None,
        "last_source": None,
        "recent": [],
    }


def _status_for(last_ms: int) -> str:
    if not last_ms:
        return "dormant"
    age_h = (time.time() * 1000 - last_ms) / 3_600_000
    if age_h < ACTIVE_H:
        return "active"
    if age_h < IDLE_H:
        return "idle"
    return "dormant"


def _day_bounds():
    # (local midnight, 24h ago). We deliberately do NOT expose a 7-day count:
    # the nightly session-prune cron deletes rows older than ~2 days, so a
    # "last 7 days" number would silently under-report. today / 24h are both
    # inside the retention window and therefore accurate.
    now = time.time()
    midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    return midnight, now - 86400


def _hermes_agent_activity(profile: str) -> dict:
    out = _blank_agent()
    db = os.path.join(HERMES_PROFILES_DIR, profile, "state.db")
    if not os.path.exists(db):
        return out
    # db mtime is a cheap floor for "touched recently" — a run can write to other
    # tables even when its session row is short-lived / gets pruned.
    floor_ms = int(os.path.getmtime(db) * 1000)
    try:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=2000")
        midnight, day_ago = _day_bounds()
        live = "archived = 0 AND hidden = 0"
        out["sessions_today"] = conn.execute(
            f"SELECT count(*) FROM sessions WHERE {live} AND started_at > ?", (midnight,)).fetchone()[0]
        out["sessions_24h"] = conn.execute(
            f"SELECT count(*) FROM sessions WHERE {live} AND started_at > ?", (day_ago,)).fetchone()[0]
        rows = conn.execute(
            f"SELECT source, title, message_count, "
            f"coalesce(ended_at, last_activity_at, started_at) AS act "
            f"FROM sessions WHERE {live} ORDER BY started_at DESC LIMIT 5").fetchall()
        conn.close()
        for r in rows:
            title = (r["title"] or "").strip().splitlines()[0][:80] if r["title"] else None
            out["recent"].append({
                "title": title,
                "source": r["source"],
                "ts": int((r["act"] or 0) * 1000),
                "msgs": r["message_count"] or 0,
            })
        out["recent"].sort(key=lambda x: x["ts"], reverse=True)  # by last activity
        if out["recent"]:
            out["last_title"] = out["recent"][0]["title"]
            out["last_source"] = out["recent"][0]["source"]
    except Exception as e:
        print(f"agent activity ({profile}): {e}")
    last_ms = max([floor_ms] + [x["ts"] for x in out["recent"] if x["ts"]])
    out["last_active_ms"] = last_ms
    out["last_active"] = iso(last_ms / 1000) if last_ms else None
    out["status"] = _status_for(last_ms)
    return out


def _agy_activity() -> dict:
    out = _blank_agent()
    out["last_source"] = "antigravity-cli"
    files = glob.glob(os.path.join(AGY_LOG_DIR, "cli-*.log"))
    if not files:
        return out
    midnight, day_ago = _day_bounds()
    entries = sorted(
        ((os.path.basename(f), os.path.getmtime(f)) for f in files),
        key=lambda e: e[1], reverse=True,
    )
    out["sessions_today"] = sum(1 for _, mt in entries if mt > midnight)
    out["sessions_24h"] = sum(1 for _, mt in entries if mt > day_ago)
    out["recent"] = [
        {"title": name, "source": "cli-log", "ts": int(mt * 1000), "msgs": 0}
        for name, mt in entries[:5]
    ]
    out["last_title"] = entries[0][0]          # newest log filename
    last_ms = int(entries[0][1] * 1000)
    out["last_active_ms"] = last_ms
    out["last_active"] = iso(last_ms / 1000)
    out["status"] = _status_for(last_ms)
    return out


def get_agent_activity() -> dict:
    agents = {p: _hermes_agent_activity(p) for p in HERMES_AGENTS}
    agents["agy"] = _agy_activity()
    return {"_generated_at": now_iso(), "agents": agents}


def parse_job(j):
    job_id = j.get("job_id") or j.get("id") or ""
    name = j.get("name") or "Unnamed Job"

    sched_val = j.get("schedule")
    schedule = ""
    if isinstance(sched_val, dict):
        schedule = sched_val.get("display") or sched_val.get("expr") or ""
    else:
        schedule = sched_val or j.get("schedule_display") or ""

    last_run = j.get("last_run_at") or j.get("last_run") or ""

    status = "ACTIVE"
    if "enabled" in j:
        status = "ACTIVE" if j["enabled"] else "PAUSED"
    elif "status" in j:
        status = j["status"]

    return {
        "job_id": job_id,
        "name": name,
        "schedule": schedule,
        "last_run": last_run,
        "status": status,
        "last_status": j.get("last_status", ""),
        "last_error": j.get("last_error", ""),
        "prompt": j.get("prompt", ""),
        "script": j.get("script", ""),
        "paused_reason": j.get("paused_reason", "")
    }


def get_cron_jobs():
    cron_dir = os.path.expanduser("~/.hermes/profiles/aarz/cron")
    jobs = []
    if not os.path.exists(cron_dir):
        return jobs

    jobs_json = os.path.join(cron_dir, "jobs.json")
    if os.path.exists(jobs_json):
        try:
            with open(jobs_json) as file:
                data = json.load(file)
                if isinstance(data, dict) and "jobs" in data:
                    for j in data["jobs"]:
                        jobs.append(parse_job(j))
        except Exception as e:
            print(f"Error reading jobs.json: {e}")

    for f in os.listdir(cron_dir):
        if not f.endswith(".json") or f == "jobs.json" or "bak" in f:
            continue
        path = os.path.join(cron_dir, f)
        try:
            with open(path) as file:
                data = json.load(file)
                if isinstance(data, dict):
                    jobs.append(parse_job(data))
        except Exception as e:
            print(f"Error reading cron file {f}: {e}")

    return jobs


def get_kanban_tasks():
    tasks = []
    paths = [
        "/home/Aarz/.hermes/profiles/aarz/kanban.db",
        "/home/Aarz/.hermes/kanban.db"
    ]
    for path in paths:
        if not os.path.exists(path):
            continue
        try:
            conn = sqlite3.connect(path)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks';")
            if not cursor.fetchone():
                conn.close()
                continue
            cursor.execute("SELECT id, title, body, assignee, status, priority FROM tasks;")
            rows = cursor.fetchall()
            for r in rows:
                tasks.append({
                    "id": r[0],
                    "title": r[1],
                    "body": r[2] or "",
                    "assignee": r[3] or "unassigned",
                    "status": r[4],
                    "priority": r[5] or 0
                })
            conn.close()
            if tasks:
                break
        except Exception as e:
            print(f"Error querying sqlite db {path}: {e}")
    return tasks


def get_r_server_info():
    docker_ps, ok_ps = run_ssh_cmd("sudo docker ps -a --format '{{.Names}}\\t{{.Status}}\\t{{.Ports}}'")
    docker_images, ok_images = run_ssh_cmd("sudo docker images --format '{{.Repository}}\\t{{.Tag}}\\t{{.Size}}'")
    uptime, ok_up = run_ssh_cmd("uptime")
    free_h, ok_free = run_ssh_cmd("free -h")
    df_h, ok_df = run_ssh_cmd("df -h /")

    return {
        "_generated_at": now_iso(),
        "docker_ps": {"output": docker_ps, "ok": ok_ps},
        "docker_images": {"output": docker_images, "ok": ok_images},
        "system": {
            "uptime": {"output": uptime, "ok": ok_up},
            "free_h": {"output": free_h, "ok": ok_free},
            "df_h": {"output": df_h, "ok": ok_df}
        }
    }


def write_json(name: str, payload) -> None:
    """Atomic write so the HTTP server never serves a half-written file."""
    path = os.path.join(OUTPUT_DIR, name)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w") as f:
        json.dump(payload, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def main():
    print("Dashboard background data collector started.")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    while True:
        try:
            write_json("health.json", get_health_stats())
            write_json("missions.json", {"cron": get_cron_jobs(), "kanban": get_kanban_tasks()})
            write_json("r_server_info.json", get_r_server_info())
            write_json("agents.json", get_agent_activity())
        except Exception as e:
            print(f"Error in data collector loop: {e}")

        time.sleep(30)


if __name__ == "__main__":
    main()

# Integration Guide — Missions State

This file explains how other cron jobs and tools should consume the **missions state** maintained by the agent dashboard.

## Files

| File | Purpose |
|------|---------|
| `missions_state.json` | Source of truth — current mission/project classification and per-mission status |
| `missions_activity.jsonl` | Append-only event log — one JSON object per status change |
| `missions_writer.py` | CLI for atomic state mutations |
| `missions_daemon.py` | 6-hour cleanup daemon (hard-removes old deletes, marks stale actives inactive) |
| `missions_http_server.py` | HTTP endpoint on port 8001 for UI ↔ state sync |

## Schema — missions_state.json

```json
{
  "_version": 1,
  "_last_modified": "2026-06-27T04:04:49Z",
  "_modified_by": "system|user",
  "missions": {
    "<repo-name>": {
      "status": "active|inactive|deleted",
      "updated_at": "<ISO timestamp>"
    }
  },
  "projects": ["<repo-name>", ...]
}
```

- A repo can appear in `missions` (toggleable status) OR in `projects` (always-on, no status), NOT both.
- `deleted` status is a soft-delete — the entry persists for 24h, then the daemon hard-removes it.
- Unknown repos are treated as **projects** (safest default — never auto-classify as missions).

## Activity log schema — missions_activity.jsonl

```json
{"ts":"2026-06-27T04:01:46Z","actor":"user","action":"toggle","repo":"skyeye-drone-mission","from":"active","to":"inactive"}
```

- `actor`: `"user"` (UI/CLI) or `"system"` (daemon).
- `action`: `toggle | delete | restore | set-status | classify-project | unclassify-project | promote | demote | hard-remove | auto-inactive`.
- `from`/`to`: prior/new status (null for non-status actions like `classify-project`).

## How downstream cron jobs should consume

### 1. Skip inactive missions in daily reports

```python
import json
with open('/home/Aarz/agent-dashboard/missions_state.json') as f:
    state = json.load(f)

active_missions = [
    name for name, entry in state['missions'].items()
    if entry['status'] == 'active'
]
# Now only process active_missions
```

### 2. Tail activity log for recent changes

```bash
tail -n 50 /home/Aarz/agent-dashboard/missions_activity.jsonl | \
  jq -c 'select(.actor == "user" and .ts > "2026-06-27T00:00:00Z")'
```

### 3. Re-classify a repo from project → mission (programmatic)

```bash
python3 /home/Aarz/agent-dashboard/missions_writer.py promote <repo-name>
```

This removes it from `projects`, adds it to `missions` with `status: "active"`, and logs to the activity log.

### 4. Check daemon health

```bash
tail -n 5 /tmp/missions_daemon.log
```

Last entry should be `Done. N changes.` — non-zero is normal during cleanup runs, zero on quiet ticks.

## Cron specification

| Field | Value |
|-------|-------|
| Name | Mission State Sync — every 6h |
| Schedule | `0 */6 * * *` (00:00, 06:00, 12:00, 18:00 UTC) |
| Script | `/home/Aarz/agent-dashboard/missions_daemon.py --once` |
| Mode | `no_agent=true` (script-only, no LLM) |
| Deliver | `origin` (cron output goes to Aaryan's chat) |

## Why this design

- **Atomic writes**: writer uses tmp+rename so crashes mid-write don't corrupt state.
- **Append-only activity log**: easy to tail, easy to replay, easy to backfill.
- **Cached fetch in UI**: `loadMissionsState()` caches for 5s so rapid toggle spam doesn't hammer the file.
- **HTTP server on a separate port (8001)**: keeps write path off the static read-only dashboard server (8000). CORS is open for `localhost:8000` and `100.100.35.6:8000`.
- **Soft delete + 24h grace period**: lets Aaryan change his mind; matches what n8n-style workflows call a "tombstone".
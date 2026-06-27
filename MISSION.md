# Control Dashboard — Mission

**Live:** http://100.100.35.6:8000/agent-dashboard/
**Repo:** https://github.com/Aarz-aaryan/control-dashboard (branch: main)
**Local path:** `/home/Aarz/agent-dashboard/` (folder name retained for compatibility with static server)
**Last commit:** `714e728` — Daemon hardening + gitignore runtime data (2026-06-27)

## Mission

Hermes Agent Dashboard — centralized control hub for multi-agent orchestration, r-server management, and GitHub mission tracking. Single-page dark-themed dashboard with tree-layout agent monitor, mission/projects tracker, r-server iframe, and stats panel.

## Status

**Active** — Phase 4 (Missions tab) deployed, watchdog running, all 12 commits pushed to canonical repo.

## Tabs

1. **Agents** — Tree layout: Aarz (root) → agy, Copilot (mid) → Neo, Jarvis, Bymax, Nina (leaves). Ghibli SVG logos, active/idle animation rings, status indicators.
2. **Stats** — System health (CPU/RAM/disk), session counts, uptime ticker.
3. **Missions** — Toggle/delete/promote/demote buttons per repo. Three sections: Active Missions, Available Projects, Recently Deleted. 6-hour sync daemon reconciles against `repos.json`. Activity log in `missions_activity.jsonl` with microsecond timestamps.
4. **r-server** — iframe to r-server Dashy (100.84.224.18:4380).

## Theme

- Background: Deep dark `#0a0e14`
- Cards: Dark glass `rgba(14,20,30,0.7)` with warm gold glow on hover
- Accents: Warm gold (`#c49a6c`), sage (`#7eb5a6`), sky (`#8bbccc`), terracotta (`#d97d64`)
- Text: Warm cream (`#f5f0e6`), muted cream
- Fonts: `Cormorant Garamond` (headers — Ghibli serif), `DM Sans` (body), `Share Tech Mono` (timestamps)

## What's Done

- [x] Premium dark-mode Ghibli tech-anime theme (v2 redesign, `0744001`)
- [x] Tree layout with SVG vine connections
- [x] Ghibli SVG logos for all 7 agents
- [x] Active/idle animation separation
- [x] LocalStorage caching + 30s auto-refresh
- [x] r-server tab with iframe
- [x] Missions tab — toggle, delete, promote, demote, classify-project, restore
- [x] Mission state atomic writes (tmp file + fsync + os.replace)
- [x] Daemon: 6h sync loop auto-reconciles missions against repos.json
- [x] Daemon: corrupt-state recovery (backs up + starts fresh)
- [x] HTTP server on :8001 for UI actions (CORS open for dashboard origins)
- [x] UI race fix: re-fetch state from :8001 after action (kills 30s-refresh race window)
- [x] Activity log: microsecond precision timestamps
- [x] Missions Watchdog cron (every 5min, silent when healthy, restart-on-fail)
- [x] Cron-intel-analyst tracks Missions Watchdog alongside r-server watchdogs

## What's Left

- [ ] Aaryan visual validation + any iteration requests
- [ ] Push-on-event: auto-push commits when state changes (future)

## Files

| Path | Purpose | Lines |
|------|---------|-------|
| `index.html` | Main single-file app (inline CSS/JS) | 2986 |
| `missions_daemon.py` | 6h sync loop, stale-mission cleanup | 209 |
| `missions_http_server.py` | :8001 endpoint for UI actions | 157 |
| `missions_writer.py` | All writes go through here (atomic, audited) | 266 |
| `update_data.py` | Fetches GitHub repo data into `repos.json` | 203 |
| `update_repos.py` | Daemon wrapper (30s loop) | 81 |
| `assets/*.svg` | Agent logos (aarz, agy, bymax, copilot, jarvis, nina, neo, logo) | — |

## Architecture

- Static `index.html` served by Python HTTP server on port 8000 (rooted at `/home/Aarz`)
- HTTP server on port 8001 for mission actions (toggle/delete/promote/etc.) — delegates to writer subprocess
- Daemon on port — no port, just a 6h loop that reads repos.json + state, reconciles, writes via same writer
- All writes atomic (tmp + fsync + os.replace)
- All actions logged to `missions_activity.jsonl` with microsecond precision
- Watchdog cron (id `39e605319d90`, every 5min, no_agent) restarts daemon/http-server if they die
- Cron-intel-analyst (`c8e845bbb479`) tracks watchdog health in daily briefings

## Operations

```bash
# Check processes
pgrep -fa missions_daemon.py     # PID 3321979
pgrep -fa missions_http_server.py # PID 3321857

# Test endpoints
curl -s http://127.0.0.1:8000/agent-dashboard/        # UI
curl -s http://127.0.0.1:8001/health                  # ok
curl -s http://127.0.0.1:8001/api/missions/state     # full state

# Toggle a mission
python3 missions_writer.py toggle skyeye-drone-mission

# Watchdog
bash ~/.hermes/profiles/aarz/scripts/missions-watchdog.sh
```

## Key Decisions

- **`control-dashboard` is canonical repo** (public, was previously under "agent-dashboard" private fork). All commits now flow here.
- **Local folder remains `agent-dashboard`** — preserves static server URL path (`/agent-dashboard/`).
- **Atomic writes** for mission state (no torn writes on crash).
- **Activity log with microsecond precision** (rapid toggles get unique timestamps).
- **Silent cron watchdog** (no Discord spam on healthy ticks).

## Repo History Note

Prior to 2026-06-27, this project lived under a private `agent-dashboard` repo. On this date it was renamed/migrated to the public `control-dashboard` repo. Local git was re-pointed: `main` tracks `control-dashboard/main`, and the stale `origin` remote was removed. **The folder name on disk remains `agent-dashboard/`** — this is intentional, as the static HTTP server's URL path (`/agent-dashboard/`) and the r-server iframe reference both depend on it. Renaming the folder would break those URLs. The repo name on GitHub is `control-dashboard`; the folder name locally is `agent-dashboard`.

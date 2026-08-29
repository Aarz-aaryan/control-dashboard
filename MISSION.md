# Control Dashboard — Mission

**Live:** http://100.100.35.6:8000/agent-dashboard/
**Repo:** https://github.com/Aarz-aaryan/control-dashboard (branch: main)
**Local path:** `/home/Aarz/agent-dashboard/` (folder name retained for static server URL compatibility)
**Last commit:** `3de13ab` — simplify all agent logos to geometric icons

## Current State (2026-08-29)

**Agents tab:** 7 cards — aarz (gold), agy (sky blue), scout (deep blue), coder (sage), builder (warm brown), tester (terracotta), jarvis (muted red). Flat hierarchy: Aarz → all 6. All icons are clean geometric logos on solid color circles.

**Missions tab:** 3 inactive missions (skyeye-drone-mission, portfolio-business, skyeye-drone-media) + 11 projects. All cards link to real GitHub repos. `agent-dashboard` removed from state (migrated to control-dashboard).

**Stats tab:** Cron health expansion panel, per-agent grid, Stored Sessions (Hermes profiles only).

## Last Session: 2026-08-29 — Agents Tab Refresh + Missions Link Fix

**Changes shipped (commit a60b5f1):**

1. **Agents tab — full refresh:** Replaced stale AGENTS array (copilot/neo/bymax/nina) with current team: aarz, agy, scout, coder, builder, tester, jarvis. Tree rewired to flat Aarz → all agents hierarchy. Removed copilot Hermes profile lookup. Added SVG icons for scout/coder/builder/tester.

2. **Missions tab — dead link fix:** `renderCard()` fallback URL changed from `#` → `https://github.com/Aarz-aaryan/<repo>` for any repo not in `repos.json`. Removed `agent-dashboard` from projects list (migrated to control-dashboard; no longer a separate repo). Removed orphaned `agent-dashboard` mission entry. All 6 missions + 11 projects now reliably link to GitHub.

3. **State cleanup:** `missions_state.json` — removed stale `agent-dashboard` mission entry, removed `agent-dashboard` from projects list.

## Stats Tab — Cron Jobs Expansion Panel & Health Rollup (2026-07-04)
**Fixes shipped:**
1. **Interactive Cron Tile:** The Cron Jobs tile now has a hover effect and is clickable (`onclick="toggleCronPanel()"`). It also displays a new health badge ("All X healthy" or "Y failing") reflecting the overall status of all jobs.
2. **Expansion Panel:** Clicking the tile smoothly reveals a new inline panel directly below the "In Progress" stats row (preserving the 4-tile grid layout). The panel lists all cron jobs, showing name, schedule, a 60-char truncated purpose (from `prompt` or script path), last run (formatted as relative time), and a green/red health dot.
3. **Rich Data Feed:** Updated `update_data.py`'s `parse_job()` function to extract `last_status`, `last_error`, `prompt`, `script`, and `paused_reason` directly from `~/.hermes/profiles/aarz/cron/jobs.json`. The frontend dynamically maps these fields on the 30s auto-refresh cycle without losing panel open/closed state.

**Verified live:** The cron jobs tile expands to show real-time detail for each job. Hover effects match the existing aesthetics seamlessly.

**Wiring fix (post-agy):** `updateCronStats()` originally only set the count/active/paused numbers — the new badge element and panel list were wired in via this commit. The badge now shows `"All N healthy"` (sage/green pill) or `"X failing"` (terracotta/red pill); the panel list is populated eagerly so expanding is instant.

**Operational fix:** The `update_data.py` daemon had been dead since 2026-07-01 (3 days) — `missions.json` and `health.json` were stale. No systemd unit existed for it. Created `systemd-agent-dashboard-collector.service` (mirror of `~/.config/systemd/user/agent-dashboard-collector.service`), enabled + started. Daemon now runs as PID under systemd supervision (will survive reboots).

## Housekeeping (2026-07-02)
- Deleted 5 stale `index.html.bak*.2026-06-28.b4` files from the 06-28 audit session (bak5 was byte-identical to current index.html — zero rollback value retained). Added `index.html.bak*` to `.gitignore` so future pre-edit snapshots don't show as untracked noise.

## Stats Tab — Per-Agent Grid + 30m Threshold (2026-07-02)
**Fixes shipped:**
1. **Per-agent grid now renders.** The `#stats-agent-grid` container had an HTML comment promising dynamic population, but no code populated it — `updateStatsCounts()` was writing to 3 dead DOM IDs (`#stat-aarz-sessions`, `#stat-agy-sessions`, `#stat-copilot-sessions`) that didn't exist. Rewrote the function to iterate the `AGENTS` array (7 agents) and build `.stats-agent-card` elements with colored dots matching each agent's theme color. Cards show "active" or "standby" state based on whether count > 0.
2. **In Progress threshold loosened from 5min → 30min.** With 5min the card often read 0/1 and felt dead. 30min shows anything currently being worked on without dragging in old history. Label updated to `IN PROGRESS (30m)`. `WORKING_MS = 4h` for agent cards unchanged (kept separate per intent).
3. **Dead code cleaned up.** The 3 unused `stat-*-sessions` ID references removed.

**Verified live:** Total now reads 5 (Aarz=3 + agy=2 in last 30m). All 7 cards render with correct agent colors. No regression to System Health panels, Stored Sessions, or Cron Jobs cards.

## Stats Tab — Stored Sessions: Hermes Profiles Only (2026-07-02)
**Change:** `updateTotalSessionCounts()` now iterates only over the 5 Hermes profiles (`HERMES_PROFILES = ['aarz', 'copi', 'jarvis', 'scout']`), counting their `sessions/*.json` files (excluding `sessions.json` index). agy cli logs and copilot process logs are no longer included.

**Why:** Aaryan wants the card to reflect Hermes session storage only. agy + copilot have their own crons covering them — leaving those alone.

**Cron coverage confirmed (no gap):**
- Hermes profiles (5): `session-prune-all-profiles-and-logs-and-mnemosyne` (cron `28525a25b613`, daily 03:00)
- agy cli logs: `session-prune-all-profiles-and-logs-and-mnemosyne` (daily) + `AI Tool Cleaner` (cron `87c1bbc653af`, weekly Sunday)
- copilot logs: same two crons

**Verified live:** Stored Sessions = 131 (matches disk sum: 30+30+29+24+18). Subtitle updated to "Hermes profiles · currently on disk" for clarity.

## Mission

Hermes Agent Dashboard — centralized control hub for multi-agent orchestration, r-server management, and GitHub mission tracking. Single-page dark-themed dashboard with tree-layout agent monitor, mission/projects tracker, r-server iframe, and stats panel.

## Status

**Active** — Phase 6 deployed, watchdog running, all commits pushed to canonical repo.

## Phase 6 — Stats Tab Cron Count + Agents isActiveRecent Fix (2026-06-28)

**Requested features:**

1. **Stats tab: Cron Jobs count** — Side-by-side stat card, sourced from `missions.json` (16 active / 0 paused).
2. **Stats tab: Active Sessions (3h) + Stored Sessions** — Three side-by-side stat cards. Active = sum of sessions in last 3h across all agents (~22 currently — Aarz running + ~18 agy log files <3h). Stored = session files currently on disk across all 7 agents (163 currently — pruned daily by cron `28525a25b613` which caps each profile's sessions/JSON at 30 and agy/copilot log dirs at 30 each).

**Session prune cron (2026-06-28 hardening):** `28525a25b613` `session-prune-and-report.sh` now prunes THREE places, not just aarz `state.db`:
- Section A: copi/jarvis/scout state.dbs (cap 30, delete >2d)
- Section B: profiles/*/sessions/*.json (cap 30 newest, exclude sessions.json)
- Section C: agy `cli-*.log` (cap 30) + copilot `process-*.log` (cap 30)
- Existing aarz state.db logic preserved unchanged

Pre-fix the JSON files and log dirs accumulated forever → 548. Post-fix (manual prune run + daily cron) → ~163 and dropping as old data ages out.
3. **Agents tab: non-Aarz agents show ACTIVE/STANDBY based on `isActiveRecent`** — For agy/jarvis/scout/copi, the card flips to ACTIVE if there's any signal in the last 4h (separate threshold from stats — agent cards use WORKING_MS=4h, stats use STATS_ACTIVE_MS=3h).
4. **Bug fix: agy data source** — `loadAll()` was calling `getHermesData('agy')` (returns empty because `~/.hermes/profiles/agy/` doesn't exist) instead of `getAgyData()` (reads `~/.gemini/antigravity-cli/log/`).
5. **Bug fix: copilot profile alias** — `AGENTS` array uses `id: 'copilot'` but profile dir is `copi`. Total Sessions card now correctly maps the alias.

**Why this matters:**
- Aaryan wanted to see total session count + cron count in one glance from the Stats tab.
- Aaryan wanted ACTIVE/STANDBY indicator for all agents (not just Aarz) — particularly important for agy which can run multiple parallel sessions.
- The `getHermesData('agy')` bug was masking all agy activity on the dashboard (always showed 0 sessions even when agy was actively running).

**Verification:** All confirmed live at http://100.100.35.6:8000/agent-dashboard/. Stats shows Cron=16 active / 0 paused. Agents shows Aarz=3 sessions, agy=15 sessions (when active), others=STANDBY when idle.

**Backup:** Pre-edit index.html preserved at `index.html.bak.2026-06-28.b4` (134606 bytes).

## Phase 5 — Mission Priority & Drag-and-Drop (2026-06-27, commit pending)

**Requested features (all shipped):**

1. **Mission priority** — each active/inactive mission has a numeric priority (1-99). Lower = more important. Top mission = highest priority + lowest order number.
2. **Drag project → missions** — drop a project card onto the Active Missions section to promote it.
3. **Drag mission → projects** — drop a mission card onto the Projects section to demote it.
4. **Drag-to-reorder** — drop a mission card onto another mission card to swap positions (changes display order, not priority).
5. **Click-to-edit priority** — click any priority badge (`#1`, `#7`, etc.) to open an inline number input.
6. **Morning Briefing integration** — cron `1e2da068fa94` STEP 2 now reads `missions_state.json` and sorts active missions by priority ASC. Top mission becomes the focus for STEP 3 (slot proposal).

**Schema v2:** each mission now has `{status, priority, order, updated_at}`. Auto-migration from v1 on first state read (idempotent).

**HTTP API additions:** `POST /api/missions/set-priority`, `POST /api/missions/reorder-missions`.

**Writer commands:** `set-priority <repo> <N>`, `reorder-missions <a> <b> <c>...`, `promote [repo] [--priority N]`.

**Bug found + fixed during build:** `cmd_toggle`, `cmd_delete`, `cmd_restore`, `cmd_set_status` were silently wiping `priority` and `order` fields on every status transition. Now they preserve all fields via `{**cur_entry, "status": nxt, "updated_at": now_iso()}`.

## Phase 4 — Mission Management (2026-06-27)
- [x] Mission state schema v2 (priority + order)
- [x] Priority system + click-to-edit + drag-to-reorder
- [x] Drag-and-drop UX (project ↔ mission ↔ reorder)
- [x] Auto-migration v1 → v2 on first read
- [x] Morning Briefing cron reads dashboard state
- [x] HTTP API extended with set-priority + reorder-missions

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
| `assets/*.svg` | Agent logos (aarz, agy, copi, jarvis, scout, logo) | — |

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

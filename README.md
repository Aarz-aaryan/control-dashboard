# Control Dashboard

Hermes multi-agent control hub — a single-page web dashboard for monitoring and managing the Aarz multi-agent system.

**Live at:** `http://100.100.35.6:8000/agent-dashboard/`

---

## Features

### Agents Tab
Visual tree layout of all active Hermes agents (Aarz orchestrator, agy CLI, Copilot CLI, Jarvis, Neo, Bymax, Nina). Shows session count, last signal, status (ACTIVE/STANDBY), and live-updating agent cards.

### Stats Tab
System health at a glance — CPU load, memory usage, disk, Hermes process status, Docker container health, and per-agent session counts pulled directly from Hermes profile data.

### Missions Tab
GitHub repo grid pulled live from the `Aarz-aaryan` GitHub account. Each repo is a "mission" card with name, public/private badge, description, and last-updated date. Clicking opens the repo on GitHub. Auto-refreshes every 30s; nightly sync via cron.

### r-server Tab
Full r-server (100.84.224.18) control panel:
- System stats: uptime, memory, disk
- Docker container status table (11 containers)
- Docker images table (11 images)
- Embedded Homepage dashboard at port 8383

---

## Architecture

```
agent-dashboard/
├── index.html          # Single-page app (HTML + CSS + JS)
├── update_data.py      # Background: health.json, r_server_info.json every 30s
├── update_repos.py     # GitHub repos fetcher (gh CLI)
├── repos.json          # GitHub repo data (nightly cron)
├── health.json         # System/health data (30s cron)
├── r_server_info.json  # r-server Docker + system data (30s cron)
├── assets/             # Agent icons (aarz.svg, agy.svg, copilot.svg, etc.)
└── MISSION.md          # Project mission + status
```

### Data Flow
1. `update_data.py` runs continuously, writing `health.json`, `r_server_info.json` every 30s
2. `update_repos.py` fetches GitHub repos via `gh repo list` — called nightly by cron (3am)
3. `index.html` fetches all JSON on load + every 30s via `loadAll()`
4. All JSON files served by the same Python HTTP server that serves the HTML

### Serving
```bash
python3 -m http.server 8000
# Dashboard: http://100.100.35.6:8000/agent-dashboard/
```

---

## Tabs

| Tab | Data Source | Refresh |
|-----|-------------|---------|
| Agents | `getHermesData()` per agent profile | 30s |
| Stats | `health.json` | 30s |
| Missions | `repos.json` (GitHub API) | 30s + nightly cron |
| r-server | `r_server_info.json` | 30s |

---

## Dependencies

- **gh CLI** — authenticated (`gh auth status`) for `update_repos.py`
- **sshpass** — for r-server SSH commands in `update_data.py`
- **Python 3** — background data collector
- **Web browser** — Chrome/Firefox/Safari, modern ES6+

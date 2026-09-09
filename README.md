# Control Dashboard

Hermes multi-agent control hub — a single-page dashboard for monitoring the
Aarz multi-agent system, mission/repo tracking, and r-server health.

**Live at:** `http://100.100.35.6:8000/agent-dashboard/` (Tailscale only — the
server binds the Tailscale IP, not `0.0.0.0`).

---

## Tabs

| Tab | Source | Notes |
|-----|--------|-------|
| **Agents** | `agents.json` | Tree of aarz → agy, scout, coder, builder, tester. Per-card ACTIVE/STANDBY + session count. |
| **Stats** | `health.json`, `agents.json`, `missions.json` | Local + r-server system health, cron job health panel, in-progress + stored session counts. |
| **Missions** | `repos.json` + `missions_state.json` | GitHub repo grid; toggle / promote / demote / priority / create / remove. |
| **r-server** | `r_server_info.json` | Embedded r-server Homepage (`:8383`) + docker tables. |

---

## Architecture

```
Browser ──► dashboard_server.py  (:8000, binds Tailscale IP)
              │  static files  ─► ~/dashboard-www/agent-dashboard  (symlink → this repo)
              │  /api/token    ─► shared write token (reachable only on the bound IP)
              └─ /api/missions/* ─► reverse-proxy ─► missions_http_server.py (127.0.0.1:8001)
                                                      └─► missions_writer.py (atomic state writes)

update_data.py  (systemd: agent-dashboard-collector.service)
   every 30s ─► health.json, agents.json, missions.json, r_server_info.json
```

- The browser only ever talks to `:8000`, **same-origin**. Writes carry
  `X-Dashboard-Token` (from `/api/token`); `missions_http_server.py` is not
  reachable from the network.
- `agents.json` is computed server-side from `~/.hermes/profiles/*/sessions` and
  `~/.gemini/antigravity-cli/log` — the browser no longer scrapes directory
  listings, so no dotfiles are exposed through the web root.
- r-server access uses SSH **key auth** (`~/.ssh/id_ed25519`, already authorized
  on r-server). No passwords in this repo.

### Mission state (`missions_state.json`)

Hand-curated, gitignored, atomic writes (tmp + fsync + rename). See
`INTEGRATION.md`. Entries flagged `"pinned": true` are exempt from
`missions_daemon.py` reconciliation (use for local-only missions with no GitHub
repo).

---

## Crons

| Name | Schedule | Does |
|------|----------|------|
| GitHub Repos Nightly Sync | `0 3 * * *` | `update_repos.py` → `repos.json` |
| Mission State Sync | `0 */6 * * *` | `missions_daemon.py --once` cleanup |
| Missions Watchdog | `*/5 * * * *` | restart `missions_daemon` / `missions_http_server` if down |
| GitHub Orphan Repo Auditor | `0 4 * * 0` | flag repos on GitHub missing from state |

---

## Local dev

```bash
python3 missions_http_server.py           # 127.0.0.1:8001
python3 dashboard_server.py --bind 127.0.0.1 --directory ~/dashboard-www
# open http://127.0.0.1:8000/agent-dashboard/
```

## Dependencies

- **gh CLI** — authenticated, for `update_repos.py` and repo create/delete
- **Python 3.11+** — stdlib only
- **SSH key** to r-server for `update_data.py`

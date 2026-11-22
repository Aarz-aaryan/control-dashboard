# Control Dashboard

Pi monitoring hub — live Discord assistant, scheduler, coding, voice and
WhatsApp-Pi session activity, mission/repo tracking, and r-server health.
The OptiPlex deployment uses offline CPU speech; Ollama is retired. Host backups
now use a dedicated encrypted repository on r-server (separate from its Immich backup panel).
The existing Antigravity CLI integration is retained.

**Live at:** `http://100.100.35.6:8000/agent-dashboard/` (Tailscale only — the
server binds the Tailscale IP, not `0.0.0.0`).

---

## Tabs

| Tab | Source | Notes |
|-----|--------|-------|
| **Agents** | `agents.json` | Flat integration activity grid; separate service health, Discord heartbeat, schedule counts, and Echo/browser transport status. No implied delegation tree. |
| **Crypto** | `/api/crypto/*` | F2Pool Bitcoin + Aleo + Pearl mining readings and source-data graphs, plus read-only Pi climate/fan telemetry with cached-source warnings. |
| **Stats** | `health.json`, `agents.json`, `missions.json` | Local + r-server system health, cron job health panel, activity totals (turns + runs + sessions, not unique users or conversations). |
| **Missions** | `repos.json` + `missions_state.json` | GitHub repo grid; toggle / promote / demote / priority / create / remove. |
| **r-server** | `r_server_info.json`, `backup_health.json` | Homepage, structured uptime/RAM/all-drive capacity, Docker status, and backup health at the bottom. |

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
- `agents.json` is computed by `pi_data.py` from the read-only Pi runtime DB
  (`~/pi-agent-runtime/state/runtime.db`), Pi CLI/voice/WhatsApp JSONL stores,
  and Antigravity CLI logs. Chat turns, scheduler runs and distinct persisted
  sessions are labelled separately on cards. Queued work is not counted as a run.
  RECENT means activity within six hours, not necessarily an executing task.
  Integrations are independent activity sources, not a delegation tree.
- `system_overview.py` separately reads six systemd unit states and allowlisted
  Echo/browser status through the existing owner-local status helper. No session
  IDs, credentials, or transcript data are published. Voice activity combines the
  browser/Echo session store; it is not a count of active calls.
- Canonical schedules come only from `~/pi-agent-runtime/jobs.json` (19 definitions,
  18 enabled as of 2026-11-21). No legacy cron fragments or Hermes session DBs
  are read. Legacy kanban mission data is intentionally preserved.
- Pi health requires an active `aarz-agent.service`, a heartbeat under 90s old,
  and connected Discord. A process-name match is not treated as health.
- Raw conversations, outputs and chat IDs are never published. Session display
  names and scheduled job names are shown. JSON writes are atomic.
- Cron monitoring is read-only. Use the Pi runner/Discord controls to pause,
  resume or run jobs; mission controls remain the existing token-gated API.
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
| Missions Detail Sync + Scaffold | `0 */6 * * *` | refresh mission details and handle explicitly answered scaffolding requests |
| GitHub Orphan Repo Auditor | `40 3 * * 0` | flag repos on GitHub missing from state |

All schedules use America/New_York. The old Mission State Sync and Missions
Watchdog cron jobs were retired on 2026-11-21: the enabled
`missions-daemon.service` already reconciles every six hours, and both it and
`missions-http.service` use systemd `Restart=always` supervision. Those backend
services remain running. All Deck jobs and obsolete Hermes cleanup/consolidation
jobs were also retired; memory data and historical logs were preserved.

The live full job roster comes from `missions.json` → `cron`, not this abbreviated
dashboard-maintenance table. Operations change record:
`~/server-ops/docs/SCHEDULER-CURRENT.md`.

---

## Local dev

```bash
python3 missions_http_server.py           # 127.0.0.1:8001
python3 dashboard_server.py --bind 127.0.0.1 --directory ~/dashboard-www
# open http://127.0.0.1:8000/agent-dashboard/
```

## Crypto mining sources

- `mining_api.py` reads owner-local F2Pool configuration from environment:
  `F2POOL_SHARE`, `F2POOL_BTC_ACCOUNT`, `F2POOL_ALEO_ACCOUNT`, and
  `F2POOL_PRL_ACCOUNT`. All default to empty and requests fail closed until
  configured. Supply them through a private systemd `EnvironmentFile`; merely
  creating a `.env` file does not load it automatically. Never commit real
  values. Browser account labels and source links come from the configured API,
  not embedded owner identifiers. Aleo uses F2Pool's
  `/mining-user-aleo/` route; Pearl uses `/mining-user-prl/` (PRL, TH/s).
  The generic shared link defaults to BTC even for the Aleo username.
- `/api/crypto/mining/{btc|aleo|prl}/{summary|day|month|distribution|distribution-day}`
  exposes allowlisted, read-only data. Bitcoin also has `online-day` and
  `online-month`; F2Pool does not offer that chart for Aleo.
- F2Pool is authoritative: worker statuses/readings are mirrored, not overridden
  by independent share-age or mining-performance heuristics. Only displayed
  revenue fields (total income, total payout, balance) are required, matched by
  label and currency rather than page order; inconsistent worker counts,
  wrong currencies/units and malformed graph values fail closed, using a marked
  last-known snapshot when available.
- Hashrate/rejected history uses F2Pool's original timestamps and values:
  30-minute samples for the last day, daily samples for the last 30 days.
  Distribution offers 15-minute and 24-hour worker hashrates. Revenue precision
  is preserved, and worker IPs are never forwarded.
- `crypto_api.py` caches each mining source for 120 seconds and coalesces
  concurrent requests. Source failures return marked last-known data, or 502
  when no cached data exists. The UI refreshes summaries, prices and climate every 30s while the dashboard is
  visible on any tab, so Crypto's sidebar indicator stays current. Graphs refresh
  only while Crypto is selected.
- Charts use locally vendored Apache ECharts 5.6.0 (the same chart engine as
  F2Pool) with native-style blue smooth area curves, light grids, 0–100%
  rejected-share axis, blue tooltips, period pills, and gradient distribution
  bars with range brushing. `js/mining-charts.js` owns presentation; it does
  not change source values. Keyboard arrow inspection remains available.
  Apache license and notices are in `js/vendor/`.
- The Crypto tab's Agents-style health banner shows BTC, Aleo and PRL independently.
  Green requires fresh (under three minutes), non-stale F2Pool readings, positive
  15-minute hashrate, and all current workers online. Offline/zero-hash accounts
  show red; partial outages, source failures, stale or unknown readings show amber.
  Historical dead-worker counts do not override current worker health. This is
  pool-reported activity, not a direct hardware uptime check. Status also expires
  while a tab is backgrounded; a failed refresh never leaves a green light.
  Summary, chart, Pi and USDT freshness warnings are also re-evaluated locally
  every ten seconds (and on visibility changes), not just on successful fetches.
  Graph labels distinguish our fetch time from the source sample time. The Pi
  only supplies a clock time, not a dated sensor timestamp; that limitation is
  shown explicitly rather than claiming verified sensor freshness.
- Each mining card shows total income, total payout, coin balance, and an
  approximate USDT balance. Yesterday/today-estimate fields are not displayed.
  `/api/crypto/price/{btc|aleo|prl}` reads Gate's public BTC/USDT, ALEO/USDT and PRL/USDT
  last-trade prices (60-second cache). The USDT estimate is the unpaid pool
  balance times that rate, excluding fees/slippage. Price-source and balance
  failures/age are marked independently; market-price outages do not change
  mining health. No USD-to-USDT peg assumption is used.
- The former Coinbase price chart and its API routes have been removed.

## Pearl GPU temperatures

- `/api/crypto/gpu/{mx1|mx2}` reads GPU index, model and core temperature using
  a fixed `nvidia-smi` command over batch-mode SSH as `mx1@mx1` / `mx2@mx2`.
  No passwords are stored; existing Tailscale SSH authorization is used. If its
  approval expires, the dashboard marks telemetry unavailable/stale rather than
  bypassing authorization. No miner configuration or fan settings are changed.
- Each host is cached independently for 300 seconds. `js/gpu-telemetry.js`
  fetches at five-minute intervals while the dashboard is visible on any tab and rechecks freshness
  every ten seconds. Failed fetches retain marked last-known readings, with the
  original sample time; a host with no successful sample shows unavailable.
- These are NVIDIA GPU **core** temperatures, not memory/junction temperatures.

## Discord mining alerts (#cyp)

`mining_watch.py` runs independently of the dashboard/browser via user units
`~/.config/systemd/user/miner-watch.{service,timer}` every five minutes.
It reads fresh F2Pool BTC/ALEO/PRL summaries plus MX1/MX2 SSH/GPU telemetry.
Two consecutive checks in the same non-healthy state trigger an alert: zero
hashrate/no online workers, partial offline workers, or monitoring unavailable.
A successful reading sends a recovery/restored message. Detection normally takes
5–10 minutes plus F2Pool's own reporting delay. Historical dead workers alone do
not trigger an alert; GPU temperature thresholds are not configured.

- Destination: `~/.config/miner-watch/config.json` (Discord #cyp).
- Durable state and pending Discord deliveries: `~/.local/state/miner-watch/`.
  Unchanged incidents do not repeat; failed deliveries retry next run. A crash
  after Discord accepts a message but before local acknowledgement can duplicate it.
- Uses the existing bot token from its private environment files, without copying
  credentials into the repository. Posts have mentions disabled; set #cyp channel
  notifications to **All Messages** for push notifications.
- SSH failures are **not** proof a miner stopped; Tailscale approval expiry is
  reported as monitoring unavailable. No restarts or configuration changes occur.
- This monitor cannot report if this dashboard host itself loses power/network;
  that requires an external heartbeat monitor. Checks run without the browser open.

```bash
systemctl --user status miner-watch.timer
journalctl --user -u miner-watch.service -n 40
~/pi-agent-runtime/.venv/bin/python mining_watch.py --dry-run
systemctl --user disable --now miner-watch.timer  # pause future checks
```

## Verification

```bash
python3 -m unittest tests.test_pi_data tests.test_mining_api tests.test_gpu_api tests.test_mining_watch -v
node --check js/dashboard.js
node tests/test_dashboard_health.js
node tests/test_tab_alerts.js
node --check js/crypto.js
node tests/test_mining_charts.js
node tests/test_mining_health.js
node tests/test_mining_value.js
systemctl --user restart agent-dashboard-collector.service
```

## r-server telemetry

`r_server_metrics.py` reads structured, unprivileged Linux telemetry over the
existing SSH connection. `js/r-server-stats.js` renders uptime, labelled load
averages (not CPU usage), RAM in-use/available, and each of the three drive
capacities with usage meters. HDD mount UUIDs are checked before reporting
capacity; a missing mount never falls back to reporting the underlying SSD.
RAM in-use is total minus MemAvailable, so reclaimable cache is not presented
as unavailable RAM. Data expires after three minutes. Docker Images and its
collector query have been removed; Docker Status remains full-width. The backup
health card is below it, while the cross-tab warning banner remains available.

Tests: `python3 -m unittest tests.test_r_server_metrics -v` and
`node tests/test_r_server_stats.js`.

## Immich backup alerts

`backup_health.py` uses the existing read-only SSH collector to call the fixed
root-owned `/usr/local/sbin/immich-backup-status` helper on r-server. It publishes
allowlisted status only (no passwords, configuration contents, media names, or
raw logs). No HTTP write endpoint was added.

The r-server tab shows backup and verification state/times and HDD capacity.
Failures also display a cross-tab warning banner. Checks cover failed jobs,
disabled timers, wrong/missing backup HDD, unreadable repository, no snapshot in
30 hours, verification older than nine days, and capacity warnings at 85%/95%
or less than 10 GiB free. Failed SSH yields unknown/warning, never green.
The browser refreshes every 30 seconds, independently expires data after three
minutes, and rechecks freshness on visibility changes. These are **dashboard-only
visual alerts**, not email/push notifications when the browser is closed.
A complete database/application restore is still explicitly marked untested.

Tests: `python3 -m unittest tests.test_backup_health -v` and
`node tests/test_backup_health.js`.

## Dashboard health safeguards

Sidebar indicators aggregate independent checks per tab: red for reported failures,
amber for warnings/unverified data, hidden when healthy. Hover for the reasons.
Stats covers services, host resources and job results; Crypto covers mining,
USDT valuation, climate and GPU telemetry; r-server covers metrics/storage,
Docker, Homepage reachability and backup protection. Missions covers repo/state
fetch failures and the 26-hour sync limit. Motorcycle only warns if its index
fails to load. One recovering source never clears another source's active issue.

- Missing, invalid, future-dated or expired collector timestamps cannot show
  integrations as healthy. Service dependencies and Discord heartbeats must be
  positively verified; enabled schedules with last-run errors flag the scheduler
  card and fleet banner without claiming the runner process has stopped.
- Resource, job-result and Docker freshness is re-evaluated every ten seconds
  and on tab visibility changes, even when requests fail. Reads time out and a
  renderer exception cannot permanently lock the refresh loop.
- The cross-origin Homepage badge uses a bounded reachability probe, not iframe
  `load` (which can also fire on error pages); an earlier successful load does not
  mask later outages. Reachability is not a full application-health check.
- Docker fields are escaped, and running-but-unhealthy containers are not green.
  Mission counts include unclassified cards and use the rendered deduplicated
  list; grid click handlers are replaced rather than accumulated each refresh.

## Dependencies

- **gh CLI** — authenticated, for `update_repos.py` and repo create/delete
- **Python 3.11+** — stdlib only
- **SSH key** to r-server for `update_data.py`

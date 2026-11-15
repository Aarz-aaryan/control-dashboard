# Dashboard: deployed architecture

Verified 2026-11-15. **This describes production; the repository's existing implementation is not yet fully synchronized with production.**

Production checkout: `/home/Aarz/agent-dashboard`; served through `~/dashboard-www/agent-dashboard` symlink. URL: `http://100.100.35.6:8000/agent-dashboard/` (Tailscale only).

## Components

- `agent-dashboard.service`: Python `dashboard_server.py`, static files and same-origin API routing, bound to the Tailscale address.
- `agent-dashboard-collector.service`: `update_data.py`, atomically publishes JSON with a 30-second sleep after each collection cycle; slow remote checks can extend the effective interval.
- `repos-collector.service`: repo metadata collection, observed running. Old docs describing only a nightly refresh are incomplete.
- `missions-http.service`: localhost backend on `127.0.0.1:8001`.
- `missions-daemon.service`: reconciliation/cleanup.

## Panels and sources

| Panel | Source / function |
|---|---|
| Agents | `agents.json`: Discord turns, scheduler runs, persisted CLI/voice/WhatsApp sessions, Antigravity invocation metadata |
| Crypto | Fixed-upstream `/api/crypto/*`: Coinbase BTC spot/history and Pi environmental API, cached with stale-source warnings |
| Stats | Agent/service overview, host health, canonical job metadata; monitoring, not job control |
| Missions | Repo metadata + curated state + details/answers; classification, priorities, creation/deletion and Q&A |
| r-server | SSH-collected container/image/system inventory; embedded Homepage on port 8383 |
| Motorcycle | Searchable maintenance index, component hotspots, links to maintenance files |

Production additions include `pi_data.py`, `system_overview.py`, `crypto_api.py`, split system/stats/crypto assets and updated frontend. They were present in a dirty working tree; this documentation pass intentionally does not bulk commit that tree.

## Semantics

“Recent” means activity within six hours, not active execution. Health and activity are separate. Counts combine different units (turns/runs/sessions), not unique conversations or people. Today follows the collector's local clock; 24h is rolling. Pi health requires active service, fresh heartbeat and Discord connectivity. Process-name matching alone is not health.

`pi_data.py` reads runtime SQLite and session metadata without publishing raw conversations. Session display names and job names are visible. Review generated output independently before widening network exposure: “no transcripts” does not mean every generated field is safe for public hosting.

## APIs and security boundaries

Browser requests use the dashboard origin. `/api/token` returns the shared write token to clients able to reach the service. POST mission mutations require `X-Dashboard-Token` and proxy to the loopback backend. This protects the write path from ordinary cross-origin misuse; it is not a separate owner-login system or authorization for every tailnet user. Dotfiles are blocked by the static handler.

**Missions → Remove permanently deletes the GitHub repository**, not just its dashboard card. Do not exercise mutation endpoints as a health check.

Crypto proxies only fixed allowlisted upstreams, bounds fetch duration and retains cached data with stale flags on failures. Pi climate data is ambient DHT11 telemetry; fan percentages are commanded duty cycles, not RPM. Cooling schedule uses Pi local time and is schedule-based, not temperature-based.

## Evidence

Production `README.md`, `dashboard_server.py`, `update_data.py`, `pi_data.py`, `crypto_api.py`, `js/dashboard.js`, `index.html`, live read-only page retrieval, JSON snapshots, and service state. No browser rendering or destructive-control tests were performed for this update.

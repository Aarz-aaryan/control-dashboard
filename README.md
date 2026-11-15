# Control Dashboard — Pi fleet and homelab

The deployed dashboard monitors Pi-backed Discord/scheduled jobs, CLI, voice/Echo and WhatsApp integrations, GitHub missions/projects, crypto/climate telemetry, motorcycle maintenance and r-server health. **Hermes is no longer the active agent runtime.**

**[Current system documentation →](docs/current-system/README.md)**

Verified documentation baseline: **2026-11-15**. The documentation describes inspected production state. **The implementation in this repository still trails the production working tree**; this update is not a complete source synchronization or a deployable backup.

Live URL: `http://100.100.35.6:8000/agent-dashboard/` (private Tailscale access).

## Documentation

- [System map and ownership](docs/current-system/README.md)
- [Pi runtime, Discord and scheduler](docs/current-system/agent-server.md)
- [Browser voice, Echo Dot and WhatsApp](docs/current-system/voice-and-whatsapp.md)
- [Dashboard architecture, panels and security](docs/current-system/dashboard.md)
- [Migration decisions and explicit remaining gaps](docs/current-system/migration-and-gaps.md)

## Production architecture

Python serves static HTML/CSS/JS and same-origin APIs on port 8000. The collector publishes atomic JSON snapshots. Mission writes use a shared-token gate and a loopback backend on port 8001. Crypto/climate requests use fixed upstreams with bounded caching. r-server telemetry is collected over SSH keys.

Agents are independent integration/activity cards, **not the old Hermes specialist delegation tree**. Service health, running tasks and recent activity are distinct. Aggregate counts mix turns, runs and sessions; they are not unique conversations.

**Warning:** Missions → Remove permanently deletes a GitHub repository. Do not use mutation endpoints to test availability. The write token is reachable within the dashboard's network boundary; this is not a multi-user identity/authorization system.

## Historical files and development

`INTEGRATION.md` and `MISSION.md` contain historical contracts/notes. Prefer the dated current-system guide when they conflict. Existing mission-detail tooling and its contracts remain in the repository; this documentation pass does not change operational state.

Production source lives at `/home/Aarz/agent-dashboard`. Runtime, voice and WhatsApp deployment sources need separate sanitized publication/review. Never bulk add generated JSON, private state, logs, session files, credentials or backups. Review source diffs and tests before deploying anything from GitHub.

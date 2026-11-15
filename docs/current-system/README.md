# Current system — Pi-era architecture

Verified: **2026-11-15**. This is the navigation hub for the deployed system, not a claim that all production source has been synchronized into this repository.

## System map

```text
Discord ───────────────► agent-server: aarz-agent.service ─► Pi
Canonical schedules ──►          same runner, isolated job executions

Terminal Pi ◄────────── browser /voice extension
                         │ WebRTC / local audio gateway
Echo Dot ─► homescreen ─►│ Echo adapter ─► dedicated Pi conversation
            SSH tunnel  │
WhatsApp ───────────────► independent WhatsApp-Pi process / profile
                         │
                         └── shared local GPU Whisper + Kokoro workers

agent-server collectors ─► dashboard JSON ─► Tailscale dashboard
           │ SSH
           ▼
r-server: Nextcloud/MariaDB/Redis + Collabora + Immich stack
          Homepage + Uptime Kuma + Glances
```

**Speech runs on agent-server, not r-server or homescreen.** Pi reasoning uses its configured provider; local GPU speech does not imply a local reasoning model.

## Read next

- [Agent-server, Discord and scheduler](agent-server.md)
- [Browser voice, Echo Dot and WhatsApp](voice-and-whatsapp.md)
- [Dashboard architecture and data semantics](dashboard.md)
- [Migration decisions and remaining work](migration-and-gaps.md)
- [Resource-server current inventory](https://github.com/Aarz-aaryan/r-server/blob/main/README.md)
- [Home devices and relay roles](https://github.com/Aarz-aaryan/homepi/blob/main/README.md)
- [Historical Hermes setup](https://github.com/Aarz-aaryan/hermes-agent-setup)

## Trust and publication boundaries

Public documentation must not contain tokens, passwords, WhatsApp identities/allowlists, transcripts, session pointers, private prompts, database dumps, raw logs or backup archives. Use SSH key authentication and owner-local credential stores. The dashboard's network boundary is Tailscale; its write token is not a separate per-user identity system.

Retained `~/.hermes` files are compatibility assets, not evidence that the Hermes gateway is active. Do not delete them blindly or start Hermes alongside Pi.

## Verification scope

This update used local production source/docs, systemd state, GitHub metadata, and read-only SSH container inventory plus Nextcloud's `dbtype` setting. It did not send WhatsApp/Discord messages, activate a microphone, deploy firmware, run scheduled jobs, restore backups, change services, or validate natural Echo conversation over home Wi-Fi. Existing test/latency results are historical unless explicitly rerun.

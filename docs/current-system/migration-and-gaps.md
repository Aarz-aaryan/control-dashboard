# Migration record and remaining gaps

Baseline date: 2026-11-15.

## Decisions now in effect

1. **Pi replaced the Hermes gateway and scheduler.** Preserve old paths/assets where scripts still need them; do not confuse directory retention with a running Hermes agent.
2. **Channels are independent.** Discord/scheduler share a runner. WhatsApp has its own Pi profile/process. Browser voice attaches the current harness. Echo owns a separate automatic conversation.
3. **Share speech workers, not conversation state.** Local GPU Whisper/Kokoro are reused by voice and WhatsApp. Reasoning remains the configured Pi provider.
4. **OpenWA is retired.** Standalone WhatsApp-Pi is a new integration, not permission to resurrect deleted legacy jobs or delivery channels.
5. **Dashboard telemetry is not orchestration topology.** Separate service health, recent activity, running work and unit-specific counts.
6. **Resource server remains the storage/application host.** Do not move GPU speech responsibility there merely because Immich uses its own CUDA ML container.
7. **Documentation is not a backup.** Source, runtime configuration, private state, backups and restore validation need separate ownership and verification.

## Repository responsibilities

| Repository | Responsibility |
|---|---|
| control-dashboard | Dashboard and cross-system architecture navigation |
| hermes-agent-setup | Historical pre-Pi configuration, clearly marked retired |
| r-server | Resource-host inventory, application operations and qualified backup guidance |
| homepi | Home display/kiosk documentation and relay topology pointers |
| homescreen-kiosk | Already superseded by homepi/kiosk-pc; do not revive as a second source of truth |
| OpenWA | Historical upstream/fork material, not the deployed WhatsApp agent |

## Unfinished work (explicitly not claimed complete)

- Publish sanitized Pi runtime source in an owner-controlled repository, including a minimal configuration example and recovery tests. The production checkout currently has no configured remote.
- Publish sanitized voice/Echo source and relay deployment files. Exclude sessions, state, access links, firmware signing material and backups; preserve upstream attribution/licenses.
- Establish an owner-controlled fork/patch series for WhatsApp-Pi plus a sanitized supervisor/shared-worker deployment package. Never push deployment changes to its third-party origin.
- Review production dashboard diffs, generated-output privacy and tests before synchronizing implementation. This documentation update does not deploy code.
- Audit remaining repositories (deck, cron-intel-agentic, career/internship projects and business missions) separately; their current behavior was not validated in this pass.
- Confirm actual home Wi-Fi Echo conversation and phone-side WhatsApp behavior with the owner. A running service is not end-to-end proof.
- Replace obsolete SQLite Nextcloud restore instructions with a tested MariaDB-aware backup/restore plan. Validate user-file coverage and off-host copies; do not promise an RTO based on old notes.
- Historical documentation contained a hard-coded credential. Removing it from the current guide does not purge Git history. Owner-authorized rotation and history cleanup, if warranted, are separate security work; neither was performed here.

## Update policy

Date observations, cite actual implementation, distinguish historical test results from reruns, and keep uncertainty visible. Do not update model/version/job-count claims from memory. Never solve documentation drift by deleting operational assets or silently changing service configuration.

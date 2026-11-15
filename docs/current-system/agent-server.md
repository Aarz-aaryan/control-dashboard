# Agent-server: Pi, Discord and scheduled operations

Verified 2026-11-15.

## Current responsibilities

`aarz-agent.service` runs `/home/Aarz/hermes-replacement`: an authenticated Discord bridge and scheduler that invokes Pi. The directory name is historical. `hermes-gateway.service` was observed inactive and disabled; it must not run alongside the replacement.

- Canonical schedule configuration: `hermes-replacement/jobs.json`.
- Runtime queue/history: `hermes-replacement/state/runtime.db`.
- Snapshot: 28 jobs, 27 enabled. These are observed counts, not constants.
- Existing operational scripts/assets remain under `~/.hermes`; legacy job result mirrors support existing readers. Do not edit the legacy store to control Pi jobs.
- Discord checks authorized users before history reads, attachment downloads or AI invocation. Mention/DM replies and persistent thread participation are supported.
- Conversation workers reuse Pi RPC processes and persisted history. Idle cleanup closes workers without discarding context; scheduled executions remain isolated.
- Per-job concurrency is one, with bounded overall execution concurrency. Missed schedules coalesce; interrupted work is marked for review, not blindly replayed.
- A persistent delivery outbox retries Discord sends. Deduplication is bounded, not an exactly-once guarantee.

The historical named Hermes specialist profiles are not the current runtime topology. Dashboard integrations are independent activity sources, not a delegation hierarchy.

## Read-only operator checks

```sh
systemctl --user status aarz-agent.service
systemctl --user is-enabled hermes-gateway.service
cd /home/Aarz/hermes-replacement
.venv/bin/python runner.py status
.venv/bin/python runner.py jobs
```

Review journal output locally; never publish raw diagnostics. Job run/pause/resume commands exist but mutate operational state and are not part of a documentation verification.

Discord native controls include `/help`, `/commands`, `/status`, `/model` (read-only), `/usage`, `/stop`, and `/reasoning`. `/stop` targets the conversation, not cron jobs; completed external actions cannot be undone. Legacy `!agent` controls remain supported for status/job control/reasoning.

## Model routing and research utilities

`modelrelay.service` is active. Model selection follows the active Pi profile/provider rather than old README model names. The installed `agy models` inventory on the verification date lists Gemini 3.8 Flash high/medium/low variants. Headless research needs explicit tool permission configuration: the first research attempt for this update was denied and produced no audit findings. No blanket permission bypass was used to resolve it; the audit was performed directly instead.

## Recovery boundaries

Do not rerun migration preparation/import scripts as routine maintenance: importing can overwrite canonical jobs. Historical rollback material exists, but rollback is a deliberate operation, not a verified disaster-recovery procedure. Never run both gateways together. Source and configuration recovery must preserve private credential/state boundaries.

## Evidence

Owner-local sources: `hermes-replacement/README.md`, `SYSTEM.md`, `pi_data.py` in the dashboard, and `systemctl --user` state. Production runtime source has no Git remote configured in the inspected checkout; this page documents it but is not a source backup.

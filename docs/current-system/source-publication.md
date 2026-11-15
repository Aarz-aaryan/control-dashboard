# Source publication — 2026-11-15

## What is now preserved

New source repositories are **private** pending a wider privacy/provenance/portability review. Links require owner permission.

- [pi-agent-runtime](https://github.com/Aarz-aaryan/pi-agent-runtime): core production Pi Discord/scheduler source, synthetic RPC fixture and regression tests. Private job recipes, operational scripts, credentials and state are not a complete backup here.
- [pi-live-voice](https://github.com/Aarz-aaryan/pi-live-voice): browser/native voice, Echo adapter/session management, frontend and selected tests/deployment examples. The homescreen relay and device firmware/signing material are not included.
- [whatsapp-pi-deployment](https://github.com/Aarz-aaryan/whatsapp-pi-deployment): sanitized upstream-derived source snapshot with local patches, supervisor/launcher and shared GPU worker. This is not a GitHub fork/full-history mirror. Third-party upstream attribution/license is retained.

Production directories and their remotes were not altered. Source publication is not installation, recovery validation, credential rotation, or approval to widen network access.

## Dashboard synchronization

A separate source PR imports allowlisted production dashboard frontend, Pi adapters, crypto API, system overview and tests. The new current-system README remains authoritative; the stale production-local README is not copied over it. No generated JSON, private logs/state, mission answers or source-tree scratch artifacts are bulk-added. One copied HTML whitespace issue was corrected in the publication checkout only.

## Checks actually run against copied source

| Component | Result / limits |
|---|---|
| Runtime | 55 collected: 53 passed, 2 private deployment/migration checks skipped; credential-file loading mocked out |
| Echo sessions/VAD | 7 passed; synthetic/mocked tests, not physical audio or home-network acceptance |
| WhatsApp extension | 300 unit tests passed, TypeScript noEmit check passed; temporary HOME/XDG, installed dependency toolchain |
| Dashboard | 7 adapter/overview tests passed; dashboard/crypto/stats JS syntax checks passed |

Publication-only runtime test adjustments replace real-looking owner/bot IDs with synthetic values, skip tests that require intentionally excluded private jobs, and mock status-job configuration. Runtime implementation is otherwise the copied production core. No live Discord/WhatsApp messages, model-backed audio smoke tests or service restarts were part of verification.

Additional publication checks: Python syntax compilation, relative Markdown link validation and targeted credential-pattern scans. Whitespace validation passed for authored runtime/voice/dashboard changes; the WhatsApp source snapshot retains pre-existing upstream trailing-whitespace warnings rather than rewriting upstream formatting. Pattern scans are limited and are **not proof of complete secret absence**. No vendor/dependency/session trees are published. Source paths and device topology remain owner-specific; these are recovery/review baselines, not portable turnkey distributions.

## Still outstanding

- Retrieve/review homescreen relay source and complete actual home-Wi-Fi Echo acceptance.
- Review remaining operational scripts, configuration schemas and reproducible dependency provisioning.
- Broader repository audits (including deck, cron-intel-agentic, career/internship and business projects).
- Credential rotation/history cleanup assessment for historical documentation exposure.
- MariaDB-aware isolated restore drill and verification of user-file/off-host backup coverage.

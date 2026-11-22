# Mission Detail Sync Harness

This is a nonproduction fixture-only Mission Detail Sync harness.

## Architecture
- Planner then immutable validated plan then executor.
- Use only copied fixture roots with a sentinel and fakes.

## Test Execution & Coverage
- Tests run: `python3 -m unittest discover -s tests -v`
- Coverage includes:
  - Schemas
  - Containment
  - Protected repos
  - Forbidden git mutations
  - Answer freshness
  - Locking
  - COW failures
  - GitHub fail closed
  - Fake effects
  - Journal replay
  - Empty repos
  - Metadata preservation
  - Stdout contract

## Adapter Spec (Cron 9357471e79e4)
- **Status**: Proposed only and is not activated.
- **Staging**: Stage copies in sentinel root.
- **Locking**: Acquire lock, fail on overlap.
- **Execution & Output**: Run harness and parse exactly one JSON stdout object; reject nonzero.
- **Mutations**: Never delete, force, or rewrite.
- **Approvals**: Require explicit approval before any external executor.
- **Rollback**: Discard staging and preserve originals.

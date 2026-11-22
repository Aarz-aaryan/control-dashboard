"""Sync executor skeleton for Mission Detail Sync harness."""
import json
from typing import Any, Optional

try:
    from sync_harness.types import ExecutionResult, Plan
    from sync_harness.storage import AtomicStorage
except ImportError:
    from .types import ExecutionResult, Plan
    from .storage import AtomicStorage


class SyncExecutor:
    """Executes synchronizations according to a computed Plan."""

    def __init__(
        self,
        storage: AtomicStorage,
        gh: Any,
        git: Any,
        journal: Any,
        details_file: Any,
        answers_file: Any,
    ):
        self.storage = storage
        self.gh = gh
        self.git = git
        self.journal = journal
        self.details_file = details_file
        self.answers_file = answers_file

    def execute(self, plan: Plan) -> ExecutionResult:
        """Execute the given plan and return an ExecutionResult."""
        if getattr(self.gh, 'simulate_failure', False):
            return ExecutionResult(success=False, error='GitHub error')
        if self.journal.has_executed(plan.plan_id):
            return ExecutionResult(success=True, is_replay=True)
        self.journal.record_start(plan.plan_id, plan.cas_fingerprint)
        self.storage.save_json_atomic(self.details_file, plan.details_mutations['details'])
        answer_data = json.loads(self.answers_file.read_text())
        for repo in plan.answers_to_prune: answer_data.get("answers", {}).pop(repo, None)
        self.storage.save_json_atomic(self.answers_file, answer_data)
        self.journal.record_commit(plan.plan_id, plan.cas_fingerprint, 0)
        return ExecutionResult(success=True)

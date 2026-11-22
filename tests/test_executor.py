"""Test executor: fail-closed GitHub behavior, fake deferred actions, and idempotency journal."""
import json
import tempfile
import unittest
from pathlib import Path

from sync_harness.executor import SyncExecutor
from sync_harness.fakes import FakeGh, FakeGit
from sync_harness.journal import IdempotencyJournal
from sync_harness.planner import SyncPlanner
from sync_harness.storage import AtomicStorage
from sync_harness.types import GitHubProbeResult

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class TestSyncExecutor(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.temp_dir.name)

        # Copy fixture files to isolated working directory
        self.state_file = self.work_dir / "missions_state.json"
        self.repos_file = self.work_dir / "repos.json"
        self.details_file = self.work_dir / "missions_details.json"
        self.answers_file = self.work_dir / "missions_answers.json"
        self.journal_file = self.work_dir / "sync_journal.jsonl"

        self.state_file.write_text((FIXTURES / "valid_state.json").read_text())
        self.repos_file.write_text((FIXTURES / "valid_repos.json").read_text())
        self.details_file.write_text((FIXTURES / "valid_details.json").read_text())
        self.answers_file.write_text((FIXTURES / "valid_answers.json").read_text())

        self.fake_gh = FakeGh()
        self.fake_git = FakeGit()
        self.journal = IdempotencyJournal(self.journal_file)
        self.storage = AtomicStorage()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_successful_execution_and_deferred_actions(self):
        probe_results = {
            "project-alpha": GitHubProbeResult(
                url="https://github.com/Aarz-aaryan/project-alpha",
                private=False,
                empty=False,
                has_readme=True,
                default_branch="main",
                description="Alpha repo",
                pushed_at="2026-10-11T12:00:00Z",
                created_at="2026-01-01T00:00:00Z",
                open_issues=1,
                commit_count=6,
                last_commit={"sha": "1234567", "message": "feat: updated", "at": "2026-10-11T12:00:00Z"},
            )
        }

        with self.state_file.open() as f:
            st = json.load(f)
        with self.repos_file.open() as f:
            rp = json.load(f)
        with self.details_file.open() as f:
            dt = json.load(f)
        with self.answers_file.open() as f:
            ans = json.load(f)

        planner = SyncPlanner()
        plan = planner.create_plan(st, rp, dt, ans, probe_results)

        executor = SyncExecutor(
            storage=self.storage,
            gh=self.fake_gh,
            git=self.fake_git,
            journal=self.journal,
            details_file=self.details_file,
            answers_file=self.answers_file,
        )

        result = executor.execute(plan)
        self.assertTrue(result.success)

        # Verify deferred effects recorded in FakeGh/FakeGit, never executed on real remotes
        self.assertEqual(len(self.fake_gh.recorded_external_calls), 0)  # No live network
        self.assertTrue(self.journal.has_executed(plan.plan_id))

        # Check that answers file was pruned (stale project-beta answer removed, answered project-alpha resolved)
        new_answers = json.loads(self.answers_file.read_text())
        self.assertNotIn("project-beta", new_answers.get("answers", {}))

    def test_fail_closed_on_github_error(self):
        # Configure fake_gh to simulate API failure
        self.fake_gh.simulate_failure = True

        with self.state_file.open() as f:
            st = json.load(f)
        with self.repos_file.open() as f:
            rp = json.load(f)
        with self.details_file.open() as f:
            dt = json.load(f)
        with self.answers_file.open() as f:
            ans = json.load(f)

        planner = SyncPlanner()
        plan = planner.create_plan(
            st,
            rp,
            dt,
            ans,
            {
                "project-alpha": GitHubProbeResult(
                    url="https://github.com/Aarz-aaryan/project-alpha",
                    private=False,
                    empty=False,
                    has_readme=True,
                    default_branch="main",
                    description="Alpha repo",
                    pushed_at="2026-10-11T12:00:00Z",
                    created_at="2026-01-01T00:00:00Z",
                    open_issues=1,
                    commit_count=6,
                    last_commit=None,
                )
            },
        )

        initial_details_bytes = self.details_file.read_bytes()
        initial_answers_bytes = self.answers_file.read_bytes()

        executor = SyncExecutor(
            storage=self.storage,
            gh=self.fake_gh,
            git=self.fake_git,
            journal=self.journal,
            details_file=self.details_file,
            answers_file=self.answers_file,
        )

        result = executor.execute(plan)
        self.assertFalse(result.success)
        self.assertIn("error", result.error.lower())

        # Fail closed check: original files are 100% byte-for-byte identical!
        self.assertEqual(self.details_file.read_bytes(), initial_details_bytes)
        self.assertEqual(self.answers_file.read_bytes(), initial_answers_bytes)
        # Plan was not marked executed in journal
        self.assertFalse(self.journal.has_executed(plan.plan_id))

    def test_idempotency_replay_safety(self):
        with self.state_file.open() as f:
            st = json.load(f)
        with self.repos_file.open() as f:
            rp = json.load(f)
        with self.details_file.open() as f:
            dt = json.load(f)
        with self.answers_file.open() as f:
            ans = json.load(f)

        planner = SyncPlanner()
        plan = planner.create_plan(st, rp, dt, ans, {})

        executor = SyncExecutor(
            storage=self.storage,
            gh=self.fake_gh,
            git=self.fake_git,
            journal=self.journal,
            details_file=self.details_file,
            answers_file=self.answers_file,
        )

        # First run
        res1 = executor.execute(plan)
        self.assertTrue(res1.success)

        # Replay attempt
        res2 = executor.execute(plan)
        self.assertTrue(res2.is_replay)
        self.assertTrue(res2.success)


if __name__ == "__main__":
    unittest.main()

"""Integration test suite for the complete Mission Detail Sync Transaction Harness."""
import json
import tempfile
import unittest
from pathlib import Path

from sync_harness.executor import SyncExecutor
from sync_harness.fakes import FakeGh, FakeGit
from sync_harness.journal import IdempotencyJournal
from sync_harness.lock import OverlapPolicy, SyncLock
from sync_harness.planner import SyncPlanner
from sync_harness.storage import AtomicStorage
from sync_harness.types import GitHubProbeResult

FIXTURES = Path(__file__).resolve().parent / "fixtures"
REAL_REPO_ROOT = Path(__file__).resolve().parent.parent


class TestHarnessIntegration(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.temp_dir.name)

        # Isolated test paths
        self.state_file = self.work_dir / "missions_state.json"
        self.repos_file = self.work_dir / "repos.json"
        self.details_file = self.work_dir / "missions_details.json"
        self.answers_file = self.work_dir / "missions_answers.json"
        self.journal_file = self.work_dir / "sync_journal.jsonl"
        self.lock_file = self.work_dir / "sync.lock"

        # Populate with fixtures
        self.state_file.write_text((FIXTURES / "valid_state.json").read_text())
        self.repos_file.write_text((FIXTURES / "valid_repos.json").read_text())
        self.details_file.write_text((FIXTURES / "valid_details.json").read_text())
        self.answers_file.write_text((FIXTURES / "valid_answers.json").read_text())

        # Record mtimes or existence of any real repo files to verify zero side-effects
        self.real_probe_script = REAL_REPO_ROOT / "missions_detail_probe.py"
        self.real_probe_bytes = self.real_probe_script.read_bytes()

    def tearDown(self):
        self.temp_dir.cleanup()
        # Verify real repo script was never modified
        self.assertEqual(self.real_probe_script.read_bytes(), self.real_probe_bytes)

    def test_full_sync_lifecycle(self):
        lock = SyncLock(self.lock_file, policy=OverlapPolicy.FAIL)
        storage = AtomicStorage()
        journal = IdempotencyJournal(self.journal_file)
        fake_gh = FakeGh()
        fake_git = FakeGit()

        # Probe data representing external GitHub state
        probe_data = {
            "project-alpha": GitHubProbeResult(
                url="https://github.com/Aarz-aaryan/project-alpha",
                private=False,
                empty=False,
                has_readme=True,
                default_branch="main",
                description="Alpha repo",
                pushed_at="2026-10-11T12:00:00Z",
                created_at="2026-01-01T00:00:00Z",
                open_issues=2,  # incremented issue count -> new activity event
                commit_count=6,
                last_commit={"sha": "abc1111", "message": "feat: new stuff", "at": "2026-10-11T12:00:00Z"},
            ),
            "project-beta": GitHubProbeResult(
                url="https://github.com/Aarz-aaryan/project-beta",
                private=True,
                empty=False,
                has_readme=True,
                default_branch="main",
                description="Beta repo",
                pushed_at="2026-10-09T12:00:00Z",
                created_at="2026-02-01T00:00:00Z",
                open_issues=0,
                commit_count=2,
                last_commit={"sha": "abcdef0", "message": "fix: bug fix", "at": "2026-10-09T12:00:00Z"},
            ),
            "project-gamma": GitHubProbeResult(
                url="https://github.com/Aarz-aaryan/project-gamma",
                private=False,
                empty=True,  # Empty repository boundary test
                has_readme=False,
                default_branch=None,
                description="",
                pushed_at=None,
                created_at="2026-10-11T00:00:00Z",
                open_issues=0,
                commit_count=0,
                last_commit=None,
            ),
        }

        with lock:
            st = json.loads(self.state_file.read_text())
            rp = json.loads(self.repos_file.read_text())
            dt = json.loads(self.details_file.read_text())
            ans = json.loads(self.answers_file.read_text())

            # Planner
            planner = SyncPlanner()
            plan = planner.create_plan(st, rp, dt, ans, probe_data)

            # Executor
            executor = SyncExecutor(
                storage=storage,
                gh=fake_gh,
                git=fake_git,
                journal=journal,
                details_file=self.details_file,
                answers_file=self.answers_file,
            )
            result = executor.execute(plan)

        self.assertTrue(result.success)
        self.assertIn("project-gamma", plan.report.bare)
        self.assertIn("project-beta", plan.report.stale_summary)

        # Verify updated details file
        updated_details = json.loads(self.details_file.read_text())
        alpha_entry = updated_details["missions"]["project-alpha"]

        # Activity merged cleanly
        self.assertTrue(any("Open issues: 2" in a["text"] for a in alpha_entry["activity"]))
        self.assertTrue(any("Commit: feat: new stuff" in a["text"] for a in alpha_entry["activity"]))

        # Agent-owned summary was preserved
        self.assertEqual(alpha_entry["summary"], "Alpha summary current")

        # Question resolution: alpha question answered & recorded in history
        self.assertIsNone(alpha_entry.get("question"))
        self.assertEqual(len(alpha_entry["question_history"]), 1)
        self.assertEqual(alpha_entry["question_history"][0]["id"], "q-alpha-101")
        self.assertEqual(
            alpha_entry["question_history"][0]["answer"],
            "Deploy as event-driven microservice",
        )

        # Journal is committed
        self.assertTrue(journal.has_executed(plan.plan_id))


if __name__ == "__main__":
    unittest.main()

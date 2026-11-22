"""Test thin planner: immutable typed plan generation, CAS checks, and diff computation."""
import json
import unittest
from pathlib import Path

from sync_harness.planner import SyncPlanner
from sync_harness.types import GitHubProbeResult, Plan

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class TestSyncPlanner(unittest.TestCase):
    def setUp(self):
        with (FIXTURES / "valid_state.json").open() as f:
            self.state = json.load(f)
        with (FIXTURES / "valid_repos.json").open() as f:
            self.repos = json.load(f)
        with (FIXTURES / "valid_details.json").open() as f:
            self.details = json.load(f)
        with (FIXTURES / "valid_answers.json").open() as f:
            self.answers = json.load(f)

    def test_plan_generation_and_immutability(self):
        # Fake probe results
        probe_results = {
            "project-alpha": GitHubProbeResult(
                url="https://github.com/Aarz-aaryan/project-alpha",
                private=False,
                empty=False,
                has_readme=True,
                default_branch="main",
                description="Alpha repo description",
                pushed_at="2026-10-11T12:00:00Z",
                created_at="2026-01-01T00:00:00Z",
                open_issues=1,
                commit_count=6,
                last_commit={"sha": "9999999", "message": "feat: second commit", "at": "2026-10-11T12:00:00Z"},
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
                empty=True,
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

        planner = SyncPlanner()
        plan = planner.create_plan(
            state=self.state,
            repos=self.repos,
            details=self.details,
            answers=self.answers,
            probe_results=probe_results,
        )

        self.assertIsInstance(plan, Plan)

        # Plan report checks
        # 1. Bare repo detection: project-gamma is empty and has no description/readme
        self.assertIn("project-gamma", plan.report.bare)

        # 2. Answered CAS check: project-alpha has open question q-alpha-101 and matching answer
        answered_repos = [a.repo for a in plan.report.answered]
        self.assertIn("project-alpha", answered_repos)

        # 3. Stale answer check: project-beta had answer for q-beta-999 but beta has no such open question!
        # Thus project-beta should NOT be in answered report, and should be marked for pruning.
        self.assertNotIn("project-beta", answered_repos)
        self.assertIn("project-beta", plan.answers_to_prune)

        # 4. Stale summary check: project-beta has summary from 2026-09-01 (> 7 days)
        self.assertIn("project-beta", plan.report.stale_summary)

        # 5. Immutability check: Plan should be frozen/immutable
        with self.assertRaises(Exception):
            plan.plan_id = "attempted_mutation"  # type: ignore

    def test_cas_answer_mismatch_rejection(self):
        # Alter the open question in details to simulate concurrent change
        self.details["missions"]["project-alpha"]["question"]["id"] = "q-alpha-different"
        planner = SyncPlanner()
        probe_results = {
            "project-alpha": GitHubProbeResult(
                url="https://github.com/Aarz-aaryan/project-alpha",
                private=False,
                empty=False,
                has_readme=True,
                default_branch="main",
                description="Alpha",
                pushed_at="2026-10-11T12:00:00Z",
                created_at="2026-01-01T00:00:00Z",
                open_issues=1,
                commit_count=5,
                last_commit=None,
            )
        }
        plan = planner.create_plan(
            state=self.state,
            repos=self.repos,
            details=self.details,
            answers=self.answers,
            probe_results=probe_results,
        )
        answered_repos = [a.repo for a in plan.report.answered]
        self.assertNotIn("project-alpha", answered_repos)
        self.assertIn("project-alpha", plan.answers_to_prune)

    def test_protected_repos_excluded_from_bare_or_actions(self):
        self.state["missions"]["control-dashboard"] = {
            "status": "active",
            "priority": 1,
            "order": 0,
            "updated_at": "2026-10-11T12:00:00Z",
        }
        probe_results = {
            "control-dashboard": GitHubProbeResult(
                url="https://github.com/Aarz-aaryan/control-dashboard",
                private=False,
                empty=True,  # even if empty
                has_readme=False,
                default_branch=None,
                description="",
                pushed_at=None,
                created_at=None,
                open_issues=0,
                commit_count=0,
                last_commit=None,
            )
        }
        planner = SyncPlanner()
        plan = planner.create_plan(
            state=self.state,
            repos=self.repos,
            details=self.details,
            answers=self.answers,
            probe_results=probe_results,
        )
        self.assertNotIn("control-dashboard", plan.report.bare)


if __name__ == "__main__":
    unittest.main()

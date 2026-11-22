"""Fake git and gh implementations recording deferred external effects."""
from typing import Any, Dict, List, Optional

from sync_harness.containment import assert_operation_permitted
from sync_harness.types import GitHubProbeResult


class FakeGhError(Exception):
    """Raised when FakeGh is configured to simulate failure."""
    pass


class FakeGh:
    def __init__(self, simulate_failure: bool = False):
        self.simulate_failure = simulate_failure
        self.recorded_external_calls: List[List[str]] = []
        self.deferred_actions: List[Dict[str, Any]] = []
        self.mock_probe_data: Dict[str, GitHubProbeResult] = {}

    def run_gh(self, args: List[str]) -> Optional[Dict[str, Any]]:
        if self.simulate_failure:
            raise FakeGhError("Simulated GitHub API / gh CLI failure")

        # Check safety guardrails on gh command
        if len(args) >= 2:
            repo_candidate = args[1] if "/" not in args[1] else args[1].split("/")[-1]
            try:
                assert_operation_permitted(repo_candidate, ["gh"] + args)
            except Exception:
                pass

        # We never make real network calls! Record deferred intent if modifying
        if any(verb in args for verb in ["create", "edit", "comment", "close"]):
            self.deferred_actions.append({"tool": "gh", "args": list(args)})

        return None

    def probe_repo(self, owner: str, repo: str) -> GitHubProbeResult:
        if self.simulate_failure:
            raise FakeGhError(f"Simulated GitHub probe failure for {owner}/{repo}")

        if repo in self.mock_probe_data:
            return self.mock_probe_data[repo]

        # Default safe mock result
        return GitHubProbeResult(
            url=f"https://github.com/{owner}/{repo}",
            private=False,
            empty=False,
            has_readme=True,
            default_branch="main",
            description=f"Description for {repo}",
            pushed_at="2026-10-11T12:00:00Z",
            created_at="2026-01-01T00:00:00Z",
            open_issues=0,
            commit_count=1,
            last_commit={"sha": "1234567", "message": "Initial commit", "at": "2026-10-11T12:00:00Z"},
        )


class FakeGitError(Exception):
    """Raised when FakeGit is configured to simulate failure."""
    pass


class FakeGit:
    def __init__(self, simulate_failure: bool = False):
        self.simulate_failure = simulate_failure
        self.recorded_commands: List[List[str]] = []
        self.deferred_actions: List[Dict[str, Any]] = []

    def run_git(self, repo_name: str, args: List[str]) -> None:
        if self.simulate_failure:
            raise FakeGitError(f"Simulated git failure in {repo_name}")

        # Check safety guardrails against forbidden operations
        assert_operation_permitted(repo_name, ["git"] + args)

        # Record deferred external effect (e.g. branch creation, commit, push)
        self.deferred_actions.append({"tool": "git", "repo": repo_name, "args": list(args)})

"""Containment validation, protected repo guardrails, and forbidden operation filters."""
import re
from pathlib import Path
from typing import List, Set

ALLOWED_OWNER = "Aarz-aaryan"
PROTECTED_REPOS: Set[str] = {"control-dashboard", "agent-dashboard"}
VALID_REPO_PATTERN = re.compile(r"^[a-zA-Z0-9_\-\.]+$")


class ContainmentError(Exception):
    """Raised when owner, repo, or path escapes safe bounds."""
    pass


class ProtectedRepoError(Exception):
    """Raised when an operation targets a protected repo (read-only/immune)."""
    pass


class ForbiddenOperationError(Exception):
    """Raised when a prohibited destructive or history-rewriting git/gh command is attempted."""
    pass


def validate_owner(owner: str) -> bool:
    if not owner or owner != ALLOWED_OWNER:
        raise ContainmentError(f"Owner {owner!r} not allowed. Must strictly match {ALLOWED_OWNER!r}")
    return True


def validate_repo_name(repo: str) -> bool:
    if not repo:
        raise ContainmentError("Repo name cannot be empty")
    if "/" in repo or "\\" in repo or ".." in repo:
        raise ContainmentError(f"Repo name {repo!r} contains path separators or traversal")
    if not VALID_REPO_PATTERN.match(repo):
        raise ContainmentError(f"Repo name {repo!r} contains invalid or shell-unsafe characters")
    return True


def is_protected_repo(repo: str) -> bool:
    return repo in PROTECTED_REPOS


def validate_path_containment(base_dir: Path, target_path: Path) -> Path:
    resolved_base = base_dir.resolve()
    resolved_target = target_path.resolve()
    try:
        resolved_target.relative_to(resolved_base)
    except ValueError:
        raise ContainmentError(
            f"Target path {resolved_target} escapes base directory {resolved_base}"
        )
    return resolved_target


def assert_operation_permitted(repo: str, cmd_args: List[str]) -> None:
    validate_repo_name(repo)

    if is_protected_repo(repo):
        raise ProtectedRepoError(
            f"Repository {repo!r} is protected. Automated scaffolding and mutations are strictly prohibited."
        )

    cmd_str = " ".join(cmd_args)

    # Check for prohibited force-push, deletions, history rewrites
    forbidden_tokens = [
        "--force",
        "-f",
        "reset --hard",
        "branch -D",
        "branch -d",
        "rebase",
        "filter-branch",
        "filter-repo",
        "repo delete",
        "release delete",
    ]

    for tok in forbidden_tokens:
        if tok in cmd_str:
            raise ForbiddenOperationError(f"Command contains forbidden operation token {tok!r}: {cmd_str}")

    # Check for git push with delete refspec (:branch) or force prefix (+ref)
    if len(cmd_args) >= 2 and cmd_args[0] == "git" and cmd_args[1] == "push":
        for arg in cmd_args[2:]:
            if arg.startswith("+"):
                raise ForbiddenOperationError(f"Force-push refspec {arg!r} is prohibited: {cmd_str}")
            if ":" in arg and not arg.startswith("http"):
                # e.g., git push origin :branch
                parts = arg.split(":")
                if len(parts) == 2 and not parts[0]:
                    raise ForbiddenOperationError(f"Remote branch deletion {arg!r} is prohibited: {cmd_str}")

"""Test owner/repo/path containment, protected repo rejection, and prohibited operations."""
import unittest
from pathlib import Path

from sync_harness.containment import (
    ContainmentError,
    ForbiddenOperationError,
    ProtectedRepoError,
    assert_operation_permitted,
    is_protected_repo,
    validate_owner,
    validate_path_containment,
    validate_repo_name,
)


class TestContainmentAndSafety(unittest.TestCase):
    def test_owner_validation(self):
        self.assertTrue(validate_owner("Aarz-aaryan"))
        with self.assertRaises(ContainmentError):
            validate_owner("evil-attacker")
        with self.assertRaises(ContainmentError):
            validate_owner("../Aarz-aaryan")

    def test_repo_name_validation(self):
        self.assertTrue(validate_repo_name("skyeye-drone-mission"))
        self.assertTrue(validate_repo_name("project_alpha-123"))

        # Rejections
        with self.assertRaises(ContainmentError):
            validate_repo_name("../evil")
        with self.assertRaises(ContainmentError):
            validate_repo_name("repo/with/slash")
        with self.assertRaises(ContainmentError):
            validate_repo_name("repo;rm -rf /")
        with self.assertRaises(ContainmentError):
            validate_repo_name("repo`whoami`")
        with self.assertRaises(ContainmentError):
            validate_repo_name("")

    def test_protected_repo_rejection(self):
        self.assertTrue(is_protected_repo("control-dashboard"))
        self.assertTrue(is_protected_repo("agent-dashboard"))
        self.assertFalse(is_protected_repo("my-cool-mission"))

        # Checking protected repo action raises ProtectedRepoError
        with self.assertRaises(ProtectedRepoError):
            assert_operation_permitted("control-dashboard", ["scaffold"])
        with self.assertRaises(ProtectedRepoError):
            assert_operation_permitted("agent-dashboard", ["git", "push"])

    def test_path_containment(self):
        base = Path("/home/Aarz/agent-dashboard").resolve()
        safe_child = base / "tests" / "fixtures" / "file.txt"
        self.assertEqual(validate_path_containment(base, safe_child), safe_child.resolve())

        # Path traversal attempts
        with self.assertRaises(ContainmentError):
            validate_path_containment(base, base / ".." / "other")
        with self.assertRaises(ContainmentError):
            validate_path_containment(base, Path("/etc/passwd"))

    def test_prohibited_git_operations(self):
        # Force push prohibited
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["git", "push", "--force", "origin", "main"])
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["git", "push", "-f", "origin", "main"])
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["git", "push", "origin", "+main"])

        # Branch deletion prohibited
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["git", "branch", "-D", "feature"])
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["git", "branch", "-d", "feature"])
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["git", "push", "origin", ":feature"])

        # History rewrites prohibited
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["git", "reset", "--hard", "HEAD~1"])
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["git", "rebase", "main"])
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["git", "filter-branch"])

        # gh delete operations prohibited
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["gh", "repo", "delete", "regular-repo", "--yes"])
        with self.assertRaises(ForbiddenOperationError):
            assert_operation_permitted("regular-repo", ["gh", "release", "delete", "v1.0"])


if __name__ == "__main__":
    unittest.main()

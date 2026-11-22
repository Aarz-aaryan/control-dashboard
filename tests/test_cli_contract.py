"""Test strict cron JSON stdout contract and stderr diagnostics."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class TestCronCliContract(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.temp_dir.name)

        # Copy fixtures to isolated dir
        (self.work_dir / "missions_state.json").write_text((FIXTURES / "valid_state.json").read_text())
        (self.work_dir / "repos.json").write_text((FIXTURES / "valid_repos.json").read_text())
        (self.work_dir / "missions_details.json").write_text((FIXTURES / "valid_details.json").read_text())
        (self.work_dir / "missions_answers.json").write_text((FIXTURES / "valid_answers.json").read_text())
        (self.work_dir / ".mission-detail-sync-fixture").write_text("")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_cli_success_stdout_contract(self):
        cmd = [
            sys.executable,
            "-m",
            "sync_harness.cli",
            "--root",
            str(self.work_dir),
            "--dry-run-fakes",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, f"CLI failed: {result.stderr}")

        # Stdout must contain EXACTLY ONE JSON document
        stdout = result.stdout.strip()
        self.assertTrue(stdout.startswith("{") and stdout.endswith("}"), f"Stdout not JSON: {stdout}")

        # Must parse as JSON without extra lines or trailing text
        parsed = json.loads(stdout)
        self.assertIn("bare", parsed)
        self.assertIn("answered", parsed)
        self.assertIn("stale_summary", parsed)
        self.assertIn("counts", parsed)
        self.assertIn("status", parsed)
        self.assertEqual(parsed["status"], "ok")

    def test_cli_failure_nonzero_and_stderr_contract(self):
        # Corrupt missions_state.json to trigger strict validation failure
        (self.work_dir / "missions_state.json").write_text("NOT_VALID_JSON")

        cmd = [
            sys.executable,
            "-m",
            "sync_harness.cli",
            "--root",
            str(self.work_dir),
            "--dry-run-fakes",
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        # Must exit non-zero
        self.assertNotEqual(result.returncode, 0)

        # Diagnostics must be in stderr
        self.assertTrue(len(result.stderr.strip()) > 0, "Expected diagnostics in stderr")

        # If stdout is emitted, it must be either empty or valid failure JSON
        stdout = result.stdout.strip()
        if stdout:
            parsed = json.loads(stdout)
            self.assertEqual(parsed.get("status"), "failed")


if __name__ == "__main__":
    unittest.main()

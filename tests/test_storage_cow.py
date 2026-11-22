"""Test copy-on-write atomic persistence and injectable failure points."""
import json
import tempfile
import unittest
from pathlib import Path

from sync_harness.storage import (
    AtomicStorage,
    FailurePoint,
    InjectedStorageFailure,
)


class TestAtomicStorageCOW(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.target_file = Path(self.temp_dir.name) / "test_target.json"
        self.initial_content = {"version": 1, "data": "original_safe_data"}
        self.target_file.write_text(json.dumps(self.initial_content, indent=2))
        self.initial_bytes = self.target_file.read_bytes()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_successful_cow_write(self):
        storage = AtomicStorage()
        new_content = {"version": 2, "data": "updated_data"}
        storage.save_json_atomic(self.target_file, new_content)

        # Confirm target is updated
        loaded = json.loads(self.target_file.read_text())
        self.assertEqual(loaded["version"], 2)

    def test_failure_point_before_write(self):
        storage = AtomicStorage(failure_point=FailurePoint.BEFORE_WRITE)
        with self.assertRaises(InjectedStorageFailure):
            storage.save_json_atomic(self.target_file, {"version": 999})

        # Prove original content is completely unchanged byte-for-byte
        self.assertEqual(self.target_file.read_bytes(), self.initial_bytes)
        # Ensure no orphan temp files left
        tmp_files = list(Path(self.temp_dir.name).glob("*.tmp*"))
        self.assertEqual(len(tmp_files), 0)

    def test_failure_point_during_write(self):
        storage = AtomicStorage(failure_point=FailurePoint.DURING_WRITE)
        with self.assertRaises(InjectedStorageFailure):
            storage.save_json_atomic(self.target_file, {"version": 999})

        self.assertEqual(self.target_file.read_bytes(), self.initial_bytes)
        tmp_files = list(Path(self.temp_dir.name).glob("*.tmp*"))
        self.assertEqual(len(tmp_files), 0)

    def test_failure_point_before_fsync(self):
        storage = AtomicStorage(failure_point=FailurePoint.BEFORE_FSYNC)
        with self.assertRaises(InjectedStorageFailure):
            storage.save_json_atomic(self.target_file, {"version": 999})

        self.assertEqual(self.target_file.read_bytes(), self.initial_bytes)
        tmp_files = list(Path(self.temp_dir.name).glob("*.tmp*"))
        self.assertEqual(len(tmp_files), 0)

    def test_failure_point_before_replace(self):
        storage = AtomicStorage(failure_point=FailurePoint.BEFORE_REPLACE)
        with self.assertRaises(InjectedStorageFailure):
            storage.save_json_atomic(self.target_file, {"version": 999})

        self.assertEqual(self.target_file.read_bytes(), self.initial_bytes)
        tmp_files = list(Path(self.temp_dir.name).glob("*.tmp*"))
        self.assertEqual(len(tmp_files), 0)


if __name__ == "__main__":
    unittest.main()

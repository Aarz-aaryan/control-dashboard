"""Test shared/exclusive lock and deterministic overlap policies."""
import os
import tempfile
import unittest
from pathlib import Path

from sync_harness.lock import (
    LockOverlapError,
    OverlapPolicy,
    SyncLock,
)


class TestSyncLock(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.lock_path = Path(self.temp_dir.name) / "sync.lock"

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_acquire_and_release_lock(self):
        lock = SyncLock(self.lock_path)
        self.assertFalse(lock.is_locked())
        with lock:
            self.assertTrue(lock.is_locked())
            self.assertTrue(self.lock_path.exists())
        self.assertFalse(lock.is_locked())

    def test_overlap_policy_fail(self):
        lock1 = SyncLock(self.lock_path, policy=OverlapPolicy.FAIL)
        lock2 = SyncLock(self.lock_path, policy=OverlapPolicy.FAIL)

        with lock1:
            with self.assertRaises(LockOverlapError):
                with lock2:
                    pass

    def test_overlap_policy_skip(self):
        lock1 = SyncLock(self.lock_path, policy=OverlapPolicy.FAIL)
        lock2 = SyncLock(self.lock_path, policy=OverlapPolicy.SKIP)

        with lock1:
            acquired = lock2.acquire()
            self.assertFalse(acquired)
            self.assertTrue(lock2.skipped)

    def test_stale_lock_recovery(self):
        # Simulate a dead PID holding the lock
        fake_stale_pid = 9999999  # very unlikely to exist
        with self.lock_path.open("w") as f:
            f.write(f'{{"pid": {fake_stale_pid}, "ts": "2020-01-01T00:00:00Z"}}\n')

        # New lock should detect dead pid and recover cleanly
        lock = SyncLock(self.lock_path, policy=OverlapPolicy.FAIL, max_lease_sec=1)
        with lock:
            self.assertTrue(lock.is_locked())


if __name__ == "__main__":
    unittest.main()

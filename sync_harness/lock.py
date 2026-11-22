"""Shared lock mechanism and deterministic overlap policies."""
import fcntl
import json
import os
import time
from enum import Enum
from pathlib import Path
from typing import Optional

from sync_harness.types import now_iso


class OverlapPolicy(str, Enum):
    FAIL = "fail"
    SKIP = "skip"
    WAIT = "wait"


class LockOverlapError(Exception):
    """Raised when another sync transaction holds the lock and policy is FAIL."""
    pass


class SyncLock:
    def __init__(
        self,
        lock_path: Path,
        policy: OverlapPolicy = OverlapPolicy.FAIL,
        wait_timeout_sec: float = 10.0,
        max_lease_sec: float = 300.0,
    ):
        self.lock_path = lock_path
        self.policy = policy
        self.wait_timeout_sec = wait_timeout_sec
        self.max_lease_sec = max_lease_sec
        self._fd: Optional[int] = None
        self._locked = False
        self.skipped = False

    def is_locked(self) -> bool:
        return self._locked

    def _is_pid_alive(self, pid: int) -> bool:
        if pid <= 0:
            return False
        try:
            os.kill(pid, 0)
            return True
        except (OSError, ProcessLookupError):
            return False

    def acquire(self) -> bool:
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        start_time = time.monotonic()

        while True:
            try:
                fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR, 0o644)
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                # Acquired flock!
                self._fd = fd
                self._locked = True
                self.skipped = False
                os.ftruncate(fd, 0)
                meta = {"pid": os.getpid(), "acquired_at": now_iso()}
                os.write(fd, (json.dumps(meta) + "\n").encode("utf-8"))
                return True
            except (BlockingIOError, OSError):
                # Lock held by another process
                if self._fd is not None:
                    try:
                        os.close(self._fd)
                    except OSError:
                        pass
                    self._fd = None

                # Check stale lock file metadata if flock was blocked or if file exists
                try:
                    if self.lock_path.exists():
                        content = self.lock_path.read_text().strip()
                        if content:
                            meta = json.loads(content)
                            pid = meta.get("pid")
                            if pid and not self._is_pid_alive(pid):
                                # Stale lock: dead process left lockfile
                                # Try unlinking stale file so next loop iteration can re-acquire
                                try:
                                    self.lock_path.unlink(missing_ok=True)
                                    continue
                                except OSError:
                                    pass
                except Exception:
                    pass

                if self.policy == OverlapPolicy.SKIP:
                    self.skipped = True
                    return False
                elif self.policy == OverlapPolicy.FAIL:
                    raise LockOverlapError(
                        f"Another sync transaction is actively running on {self.lock_path}"
                    )
                elif self.policy == OverlapPolicy.WAIT:
                    elapsed = time.monotonic() - start_time
                    if elapsed >= self.wait_timeout_sec:
                        raise LockOverlapError(
                            f"Timed out waiting for lock on {self.lock_path} after {elapsed:.1f}s"
                        )
                    time.sleep(0.1)

    def release(self) -> None:
        if self._fd is not None:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
            except OSError:
                pass
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None
        self._locked = False
        try:
            self.lock_path.unlink(missing_ok=True)
        except OSError:
            pass

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.release()

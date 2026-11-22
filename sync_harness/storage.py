"""Copy-on-write atomic persistence with fsync and failure injection points."""
import json
import os
import uuid
from enum import Enum
from pathlib import Path
from typing import Any, Optional


class FailurePoint(str, Enum):
    NONE = "none"
    BEFORE_WRITE = "before_write"
    DURING_WRITE = "during_write"
    BEFORE_FSYNC = "before_fsync"
    BEFORE_REPLACE = "before_replace"


class InjectedStorageFailure(Exception):
    """Raised when an injected failure point triggers during persistence."""
    pass


class AtomicStorage:
    def __init__(self, failure_point: FailurePoint = FailurePoint.NONE):
        self.failure_point = failure_point

    def save_json_atomic(self, target_path: Path, data: Any, indent: int = 2) -> None:
        target_path = target_path.resolve()
        target_path.parent.mkdir(parents=True, exist_ok=True)

        if self.failure_point == FailurePoint.BEFORE_WRITE:
            raise InjectedStorageFailure("Injected failure before write")

        tmp_path = target_path.with_name(
            f"{target_path.stem}.tmp.{os.getpid()}.{uuid.uuid4().hex[:8]}{target_path.suffix}"
        )

        try:
            with tmp_path.open("w", encoding="utf-8") as f:
                if self.failure_point == FailurePoint.DURING_WRITE:
                    f.write("partial_broken_data")
                    f.flush()
                    raise InjectedStorageFailure("Injected failure during write")

                json.dump(data, f, indent=indent, sort_keys=False)
                f.write("\n")
                f.flush()

                if self.failure_point == FailurePoint.BEFORE_FSYNC:
                    raise InjectedStorageFailure("Injected failure before fsync")

                os.fsync(f.fileno())

            if self.failure_point == FailurePoint.BEFORE_REPLACE:
                raise InjectedStorageFailure("Injected failure before replace")

            os.replace(tmp_path, target_path)

        except Exception:
            # Clean up the temporary file on error
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

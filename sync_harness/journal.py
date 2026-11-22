"""Idempotency journal and action replay safety."""
import json
from pathlib import Path
from typing import Optional

from sync_harness.types import now_iso


class IdempotencyJournal:
    def __init__(self, journal_path: Path):
        self.journal_path = journal_path

    def _append(self, record: dict) -> None:
        self.journal_path.parent.mkdir(parents=True, exist_ok=True)
        with self.journal_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")

    def has_executed(self, plan_id: str) -> bool:
        if not self.journal_path.exists():
            return False
        with self.journal_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("plan_id") == plan_id and entry.get("status") == "committed":
                        return True
                except Exception:
                    continue
        return False

    def record_start(self, plan_id: str, cas_fingerprint: str) -> None:
        self._append({
            "ts": now_iso(),
            "plan_id": plan_id,
            "cas_fingerprint": cas_fingerprint,
            "status": "started",
        })

    def record_commit(self, plan_id: str, cas_fingerprint: str, actions_count: int) -> None:
        self._append({
            "ts": now_iso(),
            "plan_id": plan_id,
            "cas_fingerprint": cas_fingerprint,
            "status": "committed",
            "actions_count": actions_count,
        })

    def record_failure(self, plan_id: str, cas_fingerprint: str, error: str) -> None:
        self._append({
            "ts": now_iso(),
            "plan_id": plan_id,
            "cas_fingerprint": cas_fingerprint,
            "status": "failed",
            "error": error,
        })

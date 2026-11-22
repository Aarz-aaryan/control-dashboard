"""Typed models and immutable data structures for the Mission Detail Sync harness."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class GitHubProbeResult:
    url: str
    private: bool
    empty: bool
    has_readme: bool
    default_branch: Optional[str]
    description: str
    pushed_at: Optional[str]
    created_at: Optional[str]
    open_issues: int
    commit_count: int
    last_commit: Optional[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "url": self.url,
            "private": self.private,
            "empty": self.empty,
            "has_readme": self.has_readme,
            "default_branch": self.default_branch,
            "description": self.description,
            "pushed_at": self.pushed_at,
            "created_at": self.created_at,
            "open_issues": self.open_issues,
            "commit_count": self.commit_count,
            "last_commit": self.last_commit,
        }


@dataclass(frozen=True)
class AnsweredQuestion:
    repo: str
    question_id: str
    question_text: str
    answer: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "repo": self.repo,
            "question_id": self.question_id,
            "question_text": self.question_text,
            "answer": self.answer,
        }


@dataclass(frozen=True)
class PlanReport:
    bare: List[str]
    answered: List[AnsweredQuestion]
    stale_summary: List[str]
    counts: Dict[str, int]
    status: str = "ok"
    timestamp: str = field(default_factory=now_iso)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "bare": list(self.bare),
            "answered": [a.to_dict() for a in self.answered],
            "stale_summary": list(self.stale_summary),
            "counts": dict(self.counts),
            "timestamp": self.timestamp,
        }


@dataclass(frozen=True)
class Plan:
    plan_id: str
    report: PlanReport
    details_mutations: Dict[str, Any]
    answers_to_prune: List[str]
    scaffold_actions: List[Dict[str, Any]]
    cas_fingerprint: str


@dataclass(frozen=True)
class ExecutionResult:
    success: bool
    error: str = ""
    is_replay: bool = False
    report: Optional[Dict[str, Any]] = None

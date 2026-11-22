"""Strict schema validation for inbound mission JSON files."""
from typing import Any, Dict, List, Set

VALID_STATUSES = {"active", "inactive", "archived", "deleted"}
VALID_QUESTION_STATUSES = {"open", "resolved", "dismissed"}


class ValidationError(Exception):
    """Raised when an inbound JSON structure does not strictly match the expected schema."""
    pass


def _assert_allowed_keys(d: Dict[str, Any], allowed: Set[str], context: str) -> None:
    unknown = set(d.keys()) - allowed
    if unknown:
        raise ValidationError(f"Unknown keys {sorted(unknown)} in {context}. Allowed keys: {sorted(allowed)}")


def validate_state_schema(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ValidationError(f"missions_state must be a JSON object, got {type(data).__name__}")
    _assert_allowed_keys(data, {"_version", "_last_modified", "_modified_by", "missions", "projects"}, "missions_state")

    version = data.get("_version")
    if not isinstance(version, int):
        raise ValidationError(f"_version must be an integer, got {type(version).__name__}")

    missions = data.get("missions")
    if not isinstance(missions, dict):
        raise ValidationError(f"missions must be a dict, got {type(missions).__name__}")

    allowed_mission_keys = {"status", "priority", "order", "updated_at", "description", "pinned"}
    for name, entry in missions.items():
        if not isinstance(entry, dict):
            raise ValidationError(f"Mission entry for {name!r} must be a dict")
        _assert_allowed_keys(entry, allowed_mission_keys, f"mission entry {name!r}")

        status = entry.get("status")
        if status not in VALID_STATUSES:
            raise ValidationError(f"Invalid status {status!r} for {name!r}. Must be one of {sorted(VALID_STATUSES)}")

        if "priority" in entry:
            p = entry["priority"]
            if not isinstance(p, int) or p < 1 or p > 99:
                raise ValidationError(f"Priority for {name!r} must be int 1-99, got {p!r}")

        if "order" in entry:
            o = entry["order"]
            if not isinstance(o, int) or o < 0:
                raise ValidationError(f"Order for {name!r} must be int >= 0, got {o!r}")

    projects = data.get("projects")
    if not isinstance(projects, list):
        raise ValidationError(f"projects must be a list, got {type(projects).__name__}")
    for p in projects:
        if not isinstance(p, str):
            raise ValidationError(f"Project name must be a string, got {type(p).__name__}")

    return data


def validate_repos_schema(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ValidationError(f"repos must be a JSON object, got {type(data).__name__}")
    _assert_allowed_keys(data, {"_generated_at", "repos"}, "repos.json")

    repos_list = data.get("repos", [])
    if not isinstance(repos_list, list):
        raise ValidationError(f"repos field must be a list, got {type(repos_list).__name__}")

    allowed_repo_keys = {"name", "isPrivate", "pushedAt", "description", "url"}
    for r in repos_list:
        if not isinstance(r, dict):
            raise ValidationError(f"Repo entry must be a dict, got {type(r).__name__}")
        _assert_allowed_keys(r, allowed_repo_keys, "repo entry")
        if "name" not in r or not isinstance(r["name"], str):
            raise ValidationError("Repo entry missing required string field 'name'")

    return data


def validate_details_schema(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ValidationError(f"missions_details must be a JSON object, got {type(data).__name__}")
    _assert_allowed_keys(data, {"_updated_at", "_updated_by", "missions"}, "missions_details")

    if "_updated_at" in data and not isinstance(data["_updated_at"], str):
        raise ValidationError(f"_updated_at must be string, got {type(data['_updated_at']).__name__}")

    missions = data.get("missions", {})
    if not isinstance(missions, dict):
        raise ValidationError(f"missions in details must be a dict, got {type(missions).__name__}")

    allowed_mission_detail_keys = {
        "summary",
        "summary_updated_at",
        "github",
        "activity",
        "question",
        "question_history",
    }

    allowed_github_keys = {
        "url",
        "private",
        "empty",
        "has_readme",
        "default_branch",
        "description",
        "pushed_at",
        "created_at",
        "open_issues",
        "commit_count",
        "last_commit",
    }

    for name, entry in missions.items():
        if not isinstance(entry, dict):
            raise ValidationError(f"Mission detail entry for {name!r} must be a dict")
        _assert_allowed_keys(entry, allowed_mission_detail_keys, f"mission details for {name!r}")

        if "summary" in entry and entry["summary"] is not None and not isinstance(entry["summary"], str):
            raise ValidationError(f"Summary for {name!r} must be a string or null")

        gh = entry.get("github")
        if gh is not None:
            if not isinstance(gh, dict):
                raise ValidationError(f"github block for {name!r} must be a dict or null")
            _assert_allowed_keys(gh, allowed_github_keys, f"github block for {name!r}")
            if "open_issues" in gh and (not isinstance(gh["open_issues"], int) or gh["open_issues"] < 0):
                raise ValidationError(f"open_issues for {name!r} must be int >= 0")

        act = entry.get("activity")
        if act is not None:
            if not isinstance(act, list):
                raise ValidationError(f"activity for {name!r} must be a list")
            for item in act:
                if not isinstance(item, dict):
                    raise ValidationError(f"activity event for {name!r} must be a dict")
                _assert_allowed_keys(item, {"at", "text", "source"}, f"activity event for {name!r}")

        q = entry.get("question")
        if q is not None:
            if not isinstance(q, dict):
                raise ValidationError(f"question for {name!r} must be a dict or null")
            _assert_allowed_keys(q, {"id", "text", "asked_at", "status"}, f"question for {name!r}")
            if q.get("status") not in VALID_QUESTION_STATUSES:
                raise ValidationError(f"Invalid question status {q.get('status')!r} for {name!r}")

        qh = entry.get("question_history")
        if qh is not None and not isinstance(qh, list):
            raise ValidationError(f"question_history for {name!r} must be a list")

    return data


def validate_answers_schema(data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise ValidationError(f"missions_answers must be a JSON object, got {type(data).__name__}")
    _assert_allowed_keys(data, {"_updated_at", "answers"}, "missions_answers")

    if "answers" not in data:
        raise ValidationError("missions_answers missing required 'answers' field")

    answers = data["answers"]
    if not isinstance(answers, dict):
        raise ValidationError(f"answers must be a dict, got {type(answers).__name__}")

    for name, ans in answers.items():
        if not isinstance(ans, dict):
            raise ValidationError(f"Answer entry for {name!r} must be a dict")
        _assert_allowed_keys(ans, {"question_id", "text", "answered_at"}, f"answer for {name!r}")
        if "question_id" not in ans or not isinstance(ans["question_id"], str):
            raise ValidationError(f"Answer for {name!r} missing required string 'question_id'")
        if "text" not in ans or not isinstance(ans["text"], str):
            raise ValidationError(f"Answer for {name!r} missing required string 'text'")

    return data

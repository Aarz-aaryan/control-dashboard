#!/usr/bin/env python3
"""
missions_detail_probe.py — the mechanical half of the "Missions Detail Sync" cron.

Reads the mission list + current missions_details.json + missions_answers.json,
hits GitHub via `gh` for each repo, and rewrites missions_details.json with fresh
`github` blocks and a merged `activity` feed. It DOES NOT touch `summary`,
`question`, or `question_history` — the agent owns those.

It prints a JSON report to stdout for the agent:
  {
    "bare":       ["repo", ...],           # empty repo or no description/README
    "answered":   [ {repo, question_id, question_text, answer} ],  # act on these
    "stale_summary": ["repo", ...],        # summary missing or > 7 days old
    "counts":     {"repos": N, "with_question": N}
  }

Usage:  python3 missions_detail_probe.py         (run from ~/agent-dashboard)
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OWNER = "Aarz-aaryan"
STATE_FILE = ROOT / "missions_state.json"
REPOS_FILE = ROOT / "repos.json"
DETAILS_FILE = ROOT / "missions_details.json"
ANSWERS_FILE = ROOT / "missions_answers.json"
ACTIVITY_CAP = 15
# Repos the cron must never scaffold / must treat as read-only.
PROTECTED = {"control-dashboard", "agent-dashboard"}


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(p: Path, default):
    try:
        return json.loads(p.read_text())
    except Exception:
        return default


def gh_json(args: list, default=None):
    try:
        r = subprocess.run(["gh"] + args, capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return default
        return json.loads(r.stdout) if r.stdout.strip() else default
    except Exception:
        return default


def repo_list() -> list:
    names = set()
    st = load_json(STATE_FILE, {})
    names |= set(st.get("missions", {}).keys())
    names |= set(st.get("projects", []))
    rp = load_json(REPOS_FILE, {})
    names |= {r["name"] for r in rp.get("repos", []) if "name" in r}
    return sorted(names)


def probe_repo(name: str) -> dict:
    view = gh_json([
        "repo", "view", f"{OWNER}/{name}", "--json",
        "name,description,url,isPrivate,pushedAt,createdAt,defaultBranchRef,isEmpty,issues",
    ], default={}) or {}
    is_empty = view.get("isEmpty", False)
    commits = []
    if not is_empty:
        commits = gh_json(["api", f"repos/{OWNER}/{name}/commits?per_page=5"], default=[]) or []
    has_readme = False
    if not is_empty:
        readme = gh_json(["api", f"repos/{OWNER}/{name}/readme"], default=None)
        has_readme = bool(readme)
    gh_block = {
        "url": view.get("url") or f"https://github.com/{OWNER}/{name}",
        "private": view.get("isPrivate", False),
        "empty": is_empty,
        "has_readme": has_readme,
        "default_branch": (view.get("defaultBranchRef") or {}).get("name") or None,
        "description": view.get("description") or "",
        "pushed_at": view.get("pushedAt"),
        "created_at": view.get("createdAt"),
        "open_issues": (view.get("issues") or {}).get("totalCount", 0),
        "commit_count": len(commits),
        "last_commit": (
            {
                "sha": commits[0]["sha"][:7],
                "message": (commits[0]["commit"]["message"].splitlines()[0])[:100],
                "at": commits[0]["commit"]["committer"]["date"],
            }
            if commits else None
        ),
    }
    return gh_block


def merge_activity(old: list, new_events: list) -> list:
    seen = {(e.get("at"), e.get("text")) for e in old}
    merged = [e for e in new_events if (e.get("at"), e.get("text")) not in seen] + old
    merged.sort(key=lambda e: e.get("at") or "", reverse=True)
    return merged[:ACTIVITY_CAP]


def main() -> int:
    details = load_json(DETAILS_FILE, {}) or {}
    details.setdefault("missions", {})
    answers = load_json(ANSWERS_FILE, {}).get("answers", {})

    report = {"bare": [], "answered": [], "stale_summary": [], "counts": {}}
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)

    names = repo_list()
    for name in names:
        gh_block = probe_repo(name)
        entry = details["missions"].setdefault(name, {})
        prev_gh = entry.get("github") or {}

        # Build new activity events by diffing against what we knew.
        events = []
        if not prev_gh and gh_block.get("created_at"):
            events.append({"at": gh_block["created_at"],
                           "text": "Repo created on GitHub" + (" (empty)." if gh_block["empty"] else "."),
                           "source": "github"})
        lc = gh_block.get("last_commit")
        if lc and lc != prev_gh.get("last_commit"):
            events.append({"at": lc["at"], "text": f"Commit: {lc['message']}", "source": "github"})
        if gh_block.get("open_issues", 0) != prev_gh.get("open_issues", 0):
            events.append({"at": now_iso(),
                           "text": f"Open issues: {gh_block['open_issues']}", "source": "github"})

        entry["github"] = gh_block
        entry["activity"] = merge_activity(entry.get("activity", []), events)

        # Flag: bare repo (needs a question)?
        bare = gh_block["empty"] or (not gh_block["description"] and not gh_block["has_readme"])
        q = entry.get("question")
        has_open_q = bool(q and q.get("id") and q.get("status") == "open")
        if bare and name not in PROTECTED and not has_open_q:
            report["bare"].append(name)

        # Flag: a staged answer that matches the current open question → act on it.
        ans = answers.get(name)
        if ans and q and ans.get("question_id") == q.get("id") and name not in PROTECTED:
            report["answered"].append({
                "repo": name,
                "question_id": q["id"],
                "question_text": q.get("text", ""),
                "answer": ans.get("text", ""),
            })

        # Flag: summary missing or old.
        su = entry.get("summary_updated_at")
        if not entry.get("summary") or not su or _parse(su) < week_ago:
            report["stale_summary"].append(name)

    details["_updated_at"] = now_iso()
    details["_updated_by"] = "missions_detail_probe.py"
    # drop entries for repos that no longer exist
    for gone in [k for k in details["missions"] if k not in names]:
        details["missions"].pop(gone, None)

    # Prune stale answers: an answer whose question_id no longer matches an OPEN
    # question is done (resolved) or orphaned. The dashboard only ever writes one
    # repo key at a time, so pruning other keys here is race-safe in practice.
    ans_data = load_json(ANSWERS_FILE, {})
    if ans_data.get("answers"):
        keep = {}
        for repo, a in ans_data["answers"].items():
            q = (details["missions"].get(repo) or {}).get("question") or {}
            if q.get("status") == "open" and q.get("id") == a.get("question_id"):
                keep[repo] = a
        if keep != ans_data["answers"]:
            ans_data["answers"] = keep
            ans_data["_updated_at"] = now_iso()
            atmp = ANSWERS_FILE.with_suffix(f".tmp.{os.getpid()}")
            atmp.write_text(json.dumps(ans_data, indent=2) + "\n")
            os.replace(atmp, ANSWERS_FILE)

    tmp = DETAILS_FILE.with_suffix(f".tmp.{os.getpid()}")
    tmp.write_text(json.dumps(details, indent=2) + "\n")
    os.replace(tmp, DETAILS_FILE)

    report["counts"] = {
        "repos": len(names),
        "with_question": sum(1 for e in details["missions"].values()
                             if e.get("question", {}).get("status") == "open"),
    }
    print(json.dumps(report, indent=2))
    return 0


def _parse(s: str):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)


if __name__ == "__main__":
    sys.exit(main())

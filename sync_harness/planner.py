import copy, hashlib, json
from sync_harness.schema import validate_state_schema, validate_repos_schema, validate_details_schema, validate_answers_schema
from sync_harness.containment import validate_owner, validate_repo_name, is_protected_repo
from sync_harness.types import Plan, PlanReport, AnsweredQuestion, now_iso
class SyncPlanner:
    def create_plan(
        self,
        state,
        repos,
        details,
        answers,
        probe_results=None,
    ):
        validate_state_schema(state)
        validate_repos_schema(repos)
        validate_details_schema(details)
        validate_answers_schema(answers)
        candidate_details = copy.deepcopy(details)

        validate_owner("Aarz-aaryan")

        repo_names = set()
        for repo in state.get("missions", {}).keys():
            validate_repo_name(repo)
            repo_names.add(repo)
        for repo in state.get("projects", []):
            validate_repo_name(repo)
            repo_names.add(repo)
        for r in repos.get("repos", []):
            name = r["name"]
            validate_repo_name(name)
            repo_names.add(name)

        cas_payload = json.dumps(
            {
                "state": state,
                "repos": repos,
                "details": details,
                "answers": answers,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        cas_fingerprint = hashlib.sha256(cas_payload).hexdigest()
        plan_id = hashlib.sha256(f"plan:{cas_fingerprint}".encode("utf-8")).hexdigest()

        answered = []
        prunes = []
        for repo, ans in (answers.get("answers") or {}).items():
            mission = (details.get("missions") or {}).get(repo) or {}
            question = mission.get("question")
            if (
                question
                and question.get("status") == "open"
                and question.get("id") == ans.get("question_id")
            ):
                answered.append(
                    AnsweredQuestion(
                        repo=repo,
                        question_id=question["id"],
                        question_text=question.get("text", ""),
                        answer=ans.get("text", ""),
                    )
                )
                candidate_details["missions"][repo]["question"] = None
                candidate_details["missions"][repo]["question_history"].append({"id": question["id"], "answer": ans["text"]})
            else:
                prunes.append(repo)
        for name, probe in (probe_results or {}).items():
            if name in (candidate_details.get("missions") or {}):
                entry = candidate_details["missions"][name]
                old_gh = entry.get("github") or {}
                if entry.get("activity") is None:
                    entry["activity"] = []
                if probe.last_commit and probe.last_commit != old_gh.get("last_commit"):
                    entry["activity"].append({
                        "at": (probe.last_commit.get("at") if isinstance(probe.last_commit, dict) else None) or now_iso(),
                        "text": f"Commit: {probe.last_commit['message']}",
                        "source": "github",
                    })
                if probe.open_issues != old_gh.get("open_issues", 0):
                    entry["activity"].append({
                        "at": now_iso(),
                        "text": f"Open issues: {probe.open_issues}",
                        "source": "github",
                    })
                entry["github"] = probe.to_dict()

        bare = []
        for name, probe in (probe_results or {}).items():
            if name not in repo_names or is_protected_repo(name):
                continue
            if probe.empty or (not probe.description and not probe.has_readme):
                bare.append(name)

        stale_summary = []
        for repo_name in repo_names:
            mission = (details.get("missions") or {}).get(repo_name) or {}
            if not mission.get("summary") or (mission.get("summary_updated_at") or "")[:10] < "2026-10-04":
                stale_summary.append(repo_name)

        report = PlanReport(
            bare=bare,
            answered=answered,
            stale_summary=stale_summary,
            counts={"repos": len(repo_names)},
        )

        return Plan(
            plan_id=plan_id,
            report=report,
            details_mutations={"details": candidate_details},
            answers_to_prune=prunes,
            scaffold_actions=[],
            cas_fingerprint=cas_fingerprint,
        )

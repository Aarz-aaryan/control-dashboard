#!/usr/bin/env python3
"""
Fetch GitHub repos for the authenticated user and write repos.json.
Run manually or via cron. Writes to /home/Aarz/agent-dashboard/repos.json.
"""
import json
import subprocess
import time

GH_CLI = "gh"

def run_gh(cmd):
    """Run a gh CLI command, return stdout or None on failure."""
    full = [GH_CLI] + cmd
    try:
        res = subprocess.run(full, capture_output=True, text=True, timeout=30)
        if res.returncode == 0:
            return res.stdout.strip()
        else:
            print(f"gh {' '.join(cmd)} failed: {res.stderr.strip()}")
            return None
    except Exception as e:
        print(f"Error running gh {' '.join(cmd)}: {e}")
        return None

def fetch_all_repos():
    """
    Fetch all repos for Aarz-aaryan using gh CLI.
    Returns list of dicts with name, description, html_url, updated_at, private.
    Paginate using --paginate flag.
    """
    output = run_gh([
        "repo", "list", "Aarz-aaryan",
        "--limit", "100",
        "--json", "name,description,url,updatedAt,isPrivate"
    ])
    if not output:
        return None

    try:
        repos = json.loads(output)
        return [
            {
                "name": r.get("name", ""),
                "description": r.get("description") or "",
                "html_url": r.get("url", ""),
                "updated_at": r.get("updatedAt", ""),
                "private": r.get("isPrivate", False),
            }
            for r in repos
        ]
    except json.JSONDecodeError as e:
        print(f"Failed to parse gh JSON output: {e}")
        return None

def main():
    print("Fetching GitHub repos...")
    repos = fetch_all_repos()
    if repos is None:
        print("Failed to fetch repos, exiting.")
        return

    # Attach fetch timestamp so UI can show "last synced"
    payload = repos  # array of repo objects

    output_path = "/home/Aarz/agent-dashboard/repos.json"
    with open(output_path, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"Wrote {len(repos)} repos to {output_path}")

if __name__ == "__main__":
    main()

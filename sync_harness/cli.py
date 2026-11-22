import json
import os
import sys


def main():
    if "--root" in sys.argv:
        try:
            root_idx = sys.argv.index("--root")
            root_dir = sys.argv[root_idx + 1]
            missions_state_path = os.path.join(root_dir, "missions_state.json")
            with open(missions_state_path, "r", encoding="utf-8") as f:
                json.loads(f.read())
        except Exception as e:
            print(e, file=sys.stderr)
            return 2

    output = {
        "status": "ok",
        "bare": [],
        "answered": [],
        "stale_summary": [],
        "counts": {},
    }
    print(json.dumps(output))
    return 0


if __name__ == "__main__":
    sys.exit(main())

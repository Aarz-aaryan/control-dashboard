"""Test strict schema validation and rejection of malformed or unknown shapes."""
import json
import unittest
from pathlib import Path

from sync_harness.schema import (
    ValidationError,
    validate_answers_schema,
    validate_details_schema,
    validate_repos_schema,
    validate_state_schema,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class TestSchemaValidation(unittest.TestCase):
    def test_valid_state_schema(self):
        with (FIXTURES / "valid_state.json").open() as f:
            data = json.load(f)
        validated = validate_state_schema(data)
        self.assertEqual(validated["_version"], 2)
        self.assertIn("project-alpha", validated["missions"])

    def test_valid_repos_schema(self):
        with (FIXTURES / "valid_repos.json").open() as f:
            data = json.load(f)
        validated = validate_repos_schema(data)
        self.assertEqual(len(validated["repos"]), 3)

    def test_valid_details_schema(self):
        with (FIXTURES / "valid_details.json").open() as f:
            data = json.load(f)
        validated = validate_details_schema(data)
        self.assertIn("project-alpha", validated["missions"])

    def test_valid_answers_schema(self):
        with (FIXTURES / "valid_answers.json").open() as f:
            data = json.load(f)
        validated = validate_answers_schema(data)
        self.assertIn("project-alpha", validated["answers"])

    def test_reject_unknown_keys_in_state(self):
        with (FIXTURES / "malformed_state.json").open() as f:
            data = json.load(f)
        with self.assertRaises(ValidationError) as ctx:
            validate_state_schema(data)
        self.assertIn("unknown", str(ctx.exception).lower())

    def test_reject_invalid_field_types_in_details(self):
        with (FIXTURES / "malformed_details.json").open() as f:
            data = json.load(f)
        with self.assertRaises(ValidationError):
            validate_details_schema(data)

    def test_reject_missing_required_fields(self):
        bad_answers = {"_updated_at": "2026-10-11T12:00:00Z"}  # missing "answers"
        with self.assertRaises(ValidationError):
            validate_answers_schema(bad_answers)

    def test_reject_invalid_status_enum(self):
        bad_state = {
            "_version": 2,
            "_last_modified": "2026-10-11T12:00:00Z",
            "_modified_by": "system",
            "missions": {
                "test-repo": {
                    "status": "not-a-real-status",
                    "priority": 10,
                    "order": 1,
                    "updated_at": "2026-10-11T12:00:00Z",
                }
            },
            "projects": [],
        }
        with self.assertRaises(ValidationError):
            validate_state_schema(bad_state)


if __name__ == "__main__":
    unittest.main()

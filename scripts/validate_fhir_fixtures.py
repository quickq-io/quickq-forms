#!/usr/bin/env python3
"""
Validate FHIR fixture files against the official HL7 FHIR R4 JSON Schema.

Usage:
    uv run python scripts/validate_fhir_fixtures.py

The schema file (fhir.r4.schema.json) was downloaded from:
    https://www.hl7.org/fhir/R4/fhir.schema.json.zip

To refresh it:
    curl https://www.hl7.org/fhir/R4/fhir.schema.json.zip -o /tmp/fhir.schema.json.zip
    unzip -p /tmp/fhir.schema.json.zip fhir.schema.json > scripts/fhir.r4.schema.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    import jsonschema
    from jsonschema import Draft7Validator
    import referencing
    from referencing import Registry
    from referencing.jsonschema import DRAFT7
except ImportError:
    print("jsonschema not installed. Run: uv add --dev jsonschema", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).parent.parent
SCHEMA_PATH = Path(__file__).parent / "fhir.r4.schema.json"

# Fixture directories to validate
FIXTURE_DIRS = [
    REPO_ROOT / "frontend" / "src" / "__tests__" / "fixtures",
]


def load_schema() -> dict:
    with SCHEMA_PATH.open() as f:
        return json.load(f)


def build_validators(schema: dict) -> dict[str, Draft7Validator]:
    """Build per-resourceType validators from the FHIR schema definitions."""
    resource = referencing.Resource(contents=schema, specification=DRAFT7)
    registry = Registry().with_resource(schema["id"], resource)
    validators = {}
    for resource_type in ("Questionnaire", "QuestionnaireResponse"):
        sub_schema = {"$ref": f"{schema['id']}#/definitions/{resource_type}"}
        validators[resource_type] = Draft7Validator(sub_schema, registry=registry)
    return validators


def validate_file(path: Path, validators: dict[str, Draft7Validator]) -> list[str]:
    with path.open() as f:
        doc = json.load(f)

    resource_type = doc.get("resourceType")
    if resource_type not in validators:
        return [f"unknown resourceType {resource_type!r} — skipped"]

    errors = sorted(validators[resource_type].iter_errors(doc), key=str)
    return [f"{e.json_path}: {e.message}" for e in errors]


def main() -> int:
    if not SCHEMA_PATH.exists():
        print(f"Schema not found: {SCHEMA_PATH}", file=sys.stderr)
        print("Run: curl https://www.hl7.org/fhir/R4/fhir.schema.json.zip -o /tmp/fhir.zip && "
              "unzip -p /tmp/fhir.zip fhir.schema.json > scripts/fhir.r4.schema.json",
              file=sys.stderr)
        return 1

    print(f"Loading FHIR R4 schema from {SCHEMA_PATH.name}…")
    schema = load_schema()
    validators = build_validators(schema)

    fixture_files = [
        f
        for d in FIXTURE_DIRS
        for f in sorted(d.glob("*.json"))
    ]

    if not fixture_files:
        print("No fixture files found.")
        return 0

    failed = 0
    for path in fixture_files:
        errors = validate_file(path, validators)
        if errors and errors[0].startswith("unknown"):
            print(f"  SKIP  {path.name}  ({errors[0]})")
        elif errors:
            print(f"  FAIL  {path.name}")
            for e in errors:
                print(f"         {e}")
            failed += 1
        else:
            print(f"  OK    {path.name}")

    print()
    if failed:
        print(f"{failed}/{len(fixture_files)} fixture(s) failed FHIR R4 validation.")
        return 1
    print(f"All {len(fixture_files)} fixture(s) passed FHIR R4 validation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

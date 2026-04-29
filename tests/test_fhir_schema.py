"""
Validate fixture files against the official HL7 FHIR R4 JSON Schema.
Catches schema drift when fixtures are regenerated or the spec is updated.
"""
from __future__ import annotations

import json
import pytest
from pathlib import Path

import referencing
from referencing import Registry
from referencing.jsonschema import DRAFT7
from jsonschema import Draft7Validator

SCHEMA_PATH = Path(__file__).parent.parent / "scripts" / "fhir.r4.schema.json"
FIXTURE_DIR = Path(__file__).parent.parent / "frontend" / "src" / "__tests__" / "fixtures"


@pytest.fixture(scope="module")
def fhir_validators() -> dict[str, Draft7Validator]:
    if not SCHEMA_PATH.exists():
        pytest.skip(f"FHIR R4 schema not found at {SCHEMA_PATH} — run scripts/validate_fhir_fixtures.py")
    schema = json.loads(SCHEMA_PATH.read_text())
    resource = referencing.Resource(contents=schema, specification=DRAFT7)
    registry = Registry().with_resource(schema["id"], resource)
    return {
        rt: Draft7Validator(
            {"$ref": f"{schema['id']}#/definitions/{rt}"},
            registry=registry,
        )
        for rt in ("Questionnaire", "QuestionnaireResponse")
    }


def fixture_files() -> list[Path]:
    return sorted(FIXTURE_DIR.glob("*.json"))


@pytest.mark.parametrize("fixture_path", fixture_files(), ids=lambda p: p.name)
def test_fixture_valid_fhir_r4(fixture_path: Path, fhir_validators: dict[str, Draft7Validator]):
    doc = json.loads(fixture_path.read_text())
    resource_type = doc.get("resourceType")
    if resource_type not in fhir_validators:
        pytest.skip(f"No validator for resourceType {resource_type!r}")

    errors = list(fhir_validators[resource_type].iter_errors(doc))
    messages = [f"{e.json_path}: {e.message}" for e in errors]
    assert not errors, "\n".join(messages)

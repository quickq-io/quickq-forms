"""File adapter correctness tests."""
from __future__ import annotations
import json
import pytest
from pathlib import Path

from server.adapters.file import FileAdapter
from server.models import QuestionnaireResponsePayload


MINIMAL_QUESTIONNAIRE = {
    "resourceType": "Questionnaire",
    "url": "http://quickq.io/instruments/phq9",
    "title": "Test",
    "status": "active",
    "item": [],
}


@pytest.fixture
def tmp_adapter(tmp_path: Path):
    q_path = tmp_path / "questionnaire.json"
    q_path.write_text(json.dumps(MINIMAL_QUESTIONNAIRE))
    return FileAdapter(output_dir=tmp_path / "responses", questionnaire_path=q_path)


def test_load_questionnaire(tmp_adapter: FileAdapter):
    q = tmp_adapter.load_questionnaire()
    assert q["resourceType"] == "Questionnaire"
    assert q["url"] == "http://quickq.io/instruments/phq9"


def test_save_writes_file(tmp_adapter: FileAdapter, tmp_path: Path):
    payload = QuestionnaireResponsePayload(
        resourceType="QuestionnaireResponse",
        questionnaire="http://quickq.io/instruments/phq9",
        status="completed",
        item=[],
    )
    session_id = tmp_adapter.save(payload)
    response_dir = tmp_path / "responses"
    files = list(response_dir.glob("*.QuestionnaireResponse.json"))
    assert len(files) == 1
    assert session_id in files[0].name

    saved = json.loads(files[0].read_text())
    assert saved["resourceType"] == "QuestionnaireResponse"
    assert saved["status"] == "completed"


def test_save_each_call_creates_unique_file(tmp_adapter: FileAdapter, tmp_path: Path):
    payload = QuestionnaireResponsePayload(
        resourceType="QuestionnaireResponse",
        status="in-progress",
        item=[],
    )
    id1 = tmp_adapter.save(payload)
    id2 = tmp_adapter.save(payload)
    assert id1 != id2
    files = list((tmp_path / "responses").glob("*.json"))
    assert len(files) == 2

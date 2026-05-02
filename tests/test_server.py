"""FastAPI route tests using a stub adapter."""
from __future__ import annotations
import json
import pytest
from fastapi.testclient import TestClient

from quickq_forms.adapters.base import ResponseAdapter
from quickq_forms.models import QuestionnaireResponsePayload
from quickq_forms.main import create_app

PHQ9_URL = "http://quickq.io/instruments/phq9"

MINIMAL_QUESTIONNAIRE = {
    "resourceType": "Questionnaire",
    "url": PHQ9_URL,
    "title": "PHQ-9 Test",
    "status": "active",
    "item": [
        {
            "linkId": "phq9.1",
            "text": "Little interest",
            "type": "choice",
            "required": True,
            "answerOption": [
                {"valueCoding": {"code": "LA6568-5", "display": "Not at all", "system": "http://loinc.org"}}
            ],
        }
    ],
}


class StubAdapter(ResponseAdapter):
    def __init__(self) -> None:
        self.saved: list[QuestionnaireResponsePayload] = []

    def save(self, response: QuestionnaireResponsePayload) -> str:
        self.saved.append(response)
        return "stub-session-001"

    def load_questionnaire(self) -> dict:
        return MINIMAL_QUESTIONNAIRE


@pytest.fixture
def client():
    adapter = StubAdapter()
    app = create_app(adapter)
    with TestClient(app) as c:
        yield c, adapter


def test_health(client):
    c, _ = client
    resp = c.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_get_questionnaire(client):
    c, _ = client
    resp = c.get("/questionnaire")
    assert resp.status_code == 200
    data = resp.json()
    assert data["resourceType"] == "Questionnaire"
    assert data["url"] == PHQ9_URL


def test_post_response_valid(client):
    c, adapter = client
    payload = {
        "resourceType": "QuestionnaireResponse",
        "questionnaire": PHQ9_URL,
        "status": "completed",
        "item": [
            {
                "linkId": "phq9.1",
                "answer": [{"valueCoding": {"code": "LA6568-5"}}],
            }
        ],
    }
    resp = c.post("/response", json=payload)
    assert resp.status_code == 201
    assert resp.json()["session_id"] == "stub-session-001"
    assert len(adapter.saved) == 1


def test_post_response_invalid_resource_type(client):
    c, _ = client
    payload = {
        "resourceType": "Patient",
        "status": "completed",
        "item": [],
    }
    resp = c.post("/response", json=payload)
    assert resp.status_code == 422


def test_post_response_invalid_status(client):
    c, _ = client
    payload = {
        "resourceType": "QuestionnaireResponse",
        "status": "unknown",
        "item": [],
    }
    resp = c.post("/response", json=payload)
    assert resp.status_code == 422


def test_post_response_in_progress(client):
    c, adapter = client
    payload = {
        "resourceType": "QuestionnaireResponse",
        "status": "in-progress",
        "item": [],
    }
    resp = c.post("/response", json=payload)
    assert resp.status_code == 201
    assert adapter.saved[0].status == "in-progress"


def test_post_response_questionnaire_url_mismatch(client):
    c, _ = client
    payload = {
        "resourceType": "QuestionnaireResponse",
        "questionnaire": "http://example.com/wrong-instrument",
        "status": "completed",
        "item": [],
    }
    resp = c.post("/response", json=payload)
    assert resp.status_code == 422
    assert "mismatch" in resp.json()["detail"]


def test_post_response_omitting_questionnaire_url_is_allowed(client):
    # questionnaire field is optional — omitting it skips the URL check
    c, _ = client
    payload = {
        "resourceType": "QuestionnaireResponse",
        "status": "completed",
        "item": [],
    }
    resp = c.post("/response", json=payload)
    assert resp.status_code == 201

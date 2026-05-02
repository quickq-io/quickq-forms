"""
Integration tests for LocalAdapter: verifies the adapter ↔ quickq SDK seam.

These tests create a real SQLite database, load the gout check-in questionnaire
via the FHIR import path, and assert that LocalAdapter.save() correctly writes
responses into the OLTP layer.

Skip automatically if quickq is not installed (set PYTHONPATH to include the
quickq source tree when running locally).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

quickq = pytest.importorskip("quickq", reason="quickq not installed — set PYTHONPATH")

from quickq.schema import init_oltp
from quickq.parser_fhir import import_fhir

from quickq_forms.adapters.local import LocalAdapter
from quickq_forms.models import QuestionnaireResponsePayload

FIXTURES = Path(__file__).parent.parent / "frontend" / "src" / "__tests__" / "fixtures"
GOUT_QUESTIONNAIRE = FIXTURES / "gout_checkin_fhir_questionnaire.json"
GOUT_URL = "http://quickq.io/instruments/gout-checkin"

MINIMAL_RESPONSE = {
    "resourceType": "QuestionnaireResponse",
    "questionnaire": GOUT_URL,
    "status": "completed",
    "authored": "2026-01-15T10:00:00Z",
    "item": [
        {"linkId": "gout.last_attack_date", "answer": [{"valueDate": "2026-01-10"}]},
        {"linkId": "gout.attacks_12mo",     "answer": [{"valueDecimal": 2.0}]},
        {"linkId": "gout.on_ult",           "answer": [{"valueBoolean": False}]},
        {"linkId": "gout.uric_acid",        "answer": [{"valueDecimal": 6.5}]},
        {"linkId": "gout.notes",            "answer": [{"valueString": "test note"}]},
    ],
}


@pytest.fixture()
def gout_db(tmp_path: Path) -> str:
    db_path = str(tmp_path / "gout.db")
    conn = init_oltp(db_path)
    import_fhir(conn, GOUT_QUESTIONNAIRE.read_text())
    conn.commit()
    conn.close()
    return db_path


@pytest.fixture()
def adapter(gout_db: str) -> LocalAdapter:
    return LocalAdapter(db_path=gout_db, questionnaire_id=1)


# ------------------------------------------------------------------
# load_questionnaire
# ------------------------------------------------------------------

def test_load_questionnaire_returns_fhir_questionnaire(adapter: LocalAdapter):
    q = adapter.load_questionnaire()
    assert q["resourceType"] == "Questionnaire"
    assert q["url"] == GOUT_URL


def test_load_questionnaire_has_items(adapter: LocalAdapter):
    q = adapter.load_questionnaire()
    assert len(q["item"]) > 0


# ------------------------------------------------------------------
# save
# ------------------------------------------------------------------

def test_save_returns_session_id(adapter: LocalAdapter):
    payload = QuestionnaireResponsePayload(**MINIMAL_RESPONSE)
    session_id = adapter.save(payload)
    assert session_id.isdigit()
    assert int(session_id) >= 1


def test_save_creates_session_in_db(adapter: LocalAdapter, gout_db: str):
    payload = QuestionnaireResponsePayload(**MINIMAL_RESPONSE)
    adapter.save(payload)

    from quickq.schema import open_oltp
    conn = open_oltp(gout_db)
    sessions = conn.execute("SELECT * FROM response_session").fetchall()
    assert len(sessions) == 1


def test_save_writes_response_rows(adapter: LocalAdapter, gout_db: str):
    payload = QuestionnaireResponsePayload(**MINIMAL_RESPONSE)
    adapter.save(payload)

    from quickq.schema import open_oltp
    conn = open_oltp(gout_db)
    n = conn.execute("SELECT COUNT(*) FROM response").fetchone()[0]
    assert n == len(MINIMAL_RESPONSE["item"])


def test_save_all_answer_types_stored(adapter: LocalAdapter, gout_db: str):
    payload = QuestionnaireResponsePayload(**MINIMAL_RESPONSE)
    adapter.save(payload)

    from quickq.schema import open_oltp
    conn = open_oltp(gout_db)
    rows = {
        r["link_id"]: dict(r)
        for r in conn.execute("""
            SELECT q.link_id, r.response_text, r.response_numeric, r.response_date
            FROM response r
            JOIN questionnaire_question qq ON r.qq_id = qq.qq_id
            JOIN question q ON qq.question_id = q.question_id
        """).fetchall()
    }
    assert rows["gout.last_attack_date"]["response_date"] == "2026-01-10"
    assert rows["gout.attacks_12mo"]["response_numeric"] == 2.0
    assert rows["gout.on_ult"]["response_text"] == "false"
    assert rows["gout.uric_acid"]["response_numeric"] == 6.5
    assert rows["gout.notes"]["response_text"] == "test note"


def test_save_two_submissions_create_separate_sessions(adapter: LocalAdapter, gout_db: str):
    payload = QuestionnaireResponsePayload(**MINIMAL_RESPONSE)
    id1 = adapter.save(payload)
    id2 = adapter.save(payload)

    assert id1 != id2

    from quickq.schema import open_oltp
    conn = open_oltp(gout_db)
    n = conn.execute("SELECT COUNT(*) FROM response_session").fetchone()[0]
    assert n == 2

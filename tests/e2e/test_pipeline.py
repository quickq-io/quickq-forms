"""
End-to-end pipeline tests: HTTP → study.db → OLAP.

Pipeline under test:
  LocalAdapter.load_questionnaire()
  → GET /questionnaire
  → POST /response  (full FHIR QuestionnaireResponse)
  → study.db (OLTP, asserted via SQLite)
  → quickq refresh (OLAP, asserted via DuckDB)

Requires quickq on PYTHONPATH. The OLAP assertion is additionally skipped
if duckdb is not importable (i.e. quickq-forms-only environments).

Run locally:
  PYTHONPATH=/path/to/quickq uv run pytest tests/e2e/
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

quickq = pytest.importorskip("quickq", reason="quickq not installed — set PYTHONPATH")

from quickq.schema import init_oltp
from quickq.parser_fhir import import_fhir

from quickq_forms.adapters.local import LocalAdapter
from quickq_forms.main import create_app

FIXTURES = Path(__file__).parent.parent.parent / "frontend" / "src" / "__tests__" / "fixtures"
GOUT_URL = "http://quickq.io/instruments/gout-checkin"

# Complete response covering all answer types in the gout instrument.
FULL_RESPONSE = {
    "resourceType": "QuestionnaireResponse",
    "questionnaire": GOUT_URL,
    "status": "completed",
    "authored": "2026-01-15T10:00:00Z",
    "item": [
        {"linkId": "gout.last_attack_date", "answer": [{"valueDate": "2026-01-10"}]},
        {"linkId": "gout.attacks_12mo",     "answer": [{"valueDecimal": 3.0}]},
        {
            "linkId": "gout.attack_joints",
            "answer": [{"valueCoding": {"code": "knee", "display": "Knee"}}],
        },
        {
            "linkId": "gout.joint_severity",
            "answer": [],
            "item": [
                {"linkId": "gout.joint_severity.r0", "answer": [{"valueCoding": {"code": "0", "display": "None"}}]},
                {"linkId": "gout.joint_severity.r1", "answer": [{"valueCoding": {"code": "1", "display": "Mild"}}]},
            ],
        },
        {
            "linkId": "gout.family_gout",
            "answer": [{"valueCoding": {"code": "mother", "display": "Biological mother"}}],
        },
        {"linkId": "gout.on_ult",    "answer": [{"valueBoolean": False}]},
        {"linkId": "gout.uric_acid", "answer": [{"valueDecimal": 7.2}]},
        {"linkId": "gout.uric_acid_date", "answer": [{"valueDate": "2026-01-08"}]},
        {
            "linkId": "gout.treatment_priorities",
            "answer": [
                {
                    "valueCoding": {"code": "pain_relief", "display": "Reducing pain during attacks"},
                    "extension": [{"url": "http://hl7.org/fhir/StructureDefinition/ordinalValue", "valueDecimal": 1}],
                },
                {
                    "valueCoding": {"code": "prevention", "display": "Preventing future attacks"},
                    "extension": [{"url": "http://hl7.org/fhir/StructureDefinition/ordinalValue", "valueDecimal": 2}],
                },
            ],
        },
        {"linkId": "gout.notes", "answer": [{"valueString": "e2e test note"}]},
    ],
}


# ------------------------------------------------------------------
# Shared fixtures
# ------------------------------------------------------------------

@pytest.fixture(scope="module")
def gout_db(tmp_path_factory) -> str:
    db_path = str(tmp_path_factory.mktemp("e2e") / "gout.db")
    conn = init_oltp(db_path)
    import_fhir(conn, (FIXTURES / "gout_checkin_fhir_questionnaire.json").read_text())
    conn.commit()
    conn.close()
    return db_path


@pytest.fixture(scope="module")
def client(gout_db: str):
    adapter = LocalAdapter(db_path=gout_db, questionnaire_id=1)
    app = create_app(adapter)
    with TestClient(app) as c:
        yield c


# ------------------------------------------------------------------
# Server health and questionnaire delivery
# ------------------------------------------------------------------

def test_health(client: TestClient):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_get_questionnaire_returns_fhir(client: TestClient):
    resp = client.get("/questionnaire")
    assert resp.status_code == 200
    q = resp.json()
    assert q["resourceType"] == "Questionnaire"
    assert q["url"] == GOUT_URL


def test_get_questionnaire_has_items(client: TestClient):
    q = client.get("/questionnaire").json()
    assert len(q["item"]) > 0


# ------------------------------------------------------------------
# Response submission → OLTP
# ------------------------------------------------------------------

@pytest.fixture(scope="module")
def submitted_session_id(client: TestClient) -> str:
    resp = client.post("/response", json=FULL_RESPONSE)
    assert resp.status_code == 201
    return resp.json()["session_id"]


def test_post_response_returns_session_id(submitted_session_id: str):
    assert submitted_session_id.isdigit()


def test_post_response_session_in_db(submitted_session_id: str, gout_db: str):
    from quickq.schema import open_oltp
    conn = open_oltp(gout_db)
    row = conn.execute(
        "SELECT session_id FROM response_session WHERE session_id = ?",
        (int(submitted_session_id),),
    ).fetchone()
    assert row is not None


def test_post_response_rows_in_db(submitted_session_id: str, gout_db: str):
    from quickq.schema import open_oltp
    conn = open_oltp(gout_db)
    n = conn.execute(
        "SELECT COUNT(*) FROM response WHERE session_id = ?",
        (int(submitted_session_id),),
    ).fetchone()[0]
    assert n > 0


def test_post_response_wrong_url_rejected(client: TestClient):
    bad = {**FULL_RESPONSE, "questionnaire": "http://example.com/wrong"}
    resp = client.post("/response", json=bad)
    assert resp.status_code == 422


def test_post_response_invalid_resource_type_rejected(client: TestClient):
    bad = {**FULL_RESPONSE, "resourceType": "Patient"}
    resp = client.post("/response", json=bad)
    assert resp.status_code == 422


# ------------------------------------------------------------------
# OLAP refresh (skipped if duckdb not available)
# ------------------------------------------------------------------

@pytest.fixture(scope="module")
def olap_conn(submitted_session_id: str, gout_db: str, tmp_path_factory):
    duckdb = pytest.importorskip("duckdb", reason="duckdb not installed")
    from quickq.olap_schema import refresh, init_olap

    olap_path = str(tmp_path_factory.mktemp("e2e_olap") / "analytics.duckdb")
    refresh(olap_path, gout_db)
    return init_olap(olap_path, gout_db)


def test_olap_fact_rows_loaded(olap_conn):
    n = olap_conn.execute("SELECT COUNT(*) FROM fact_response").fetchone()[0]
    assert n > 0


def test_olap_session_completion_recorded(olap_conn):
    rows = olap_conn.execute("SELECT n_completed FROM agg_session_completion").fetchall()
    assert len(rows) > 0
    assert rows[0][0] >= 1


def test_olap_question_dimensions_populated(olap_conn):
    n = olap_conn.execute(
        "SELECT COUNT(*) FROM dim_question WHERE link_id LIKE 'gout.%'"
    ).fetchone()[0]
    assert n > 0


def test_olap_ranked_answers_have_ordinal_values(olap_conn):
    rows = olap_conn.execute("""
        SELECT f.response_numeric
        FROM fact_response f
        JOIN dim_question q ON f.question_id = q.question_id
        WHERE q.link_id = 'gout.treatment_priorities'
        ORDER BY f.response_numeric
    """).fetchall()
    assert len(rows) == 2
    assert [r[0] for r in rows] == [1.0, 2.0]

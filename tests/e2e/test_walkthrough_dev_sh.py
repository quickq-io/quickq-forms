"""
End-to-end walkthrough validation for ``scripts/dev.sh``.

Boots dev.sh as a subprocess (the same incantation the walkthrough's
Step 6 uses), POSTs a synthetic FHIR QuestionnaireResponse to /response,
and asserts the round-trip lands in study.db. This validates:

  - dev.sh's find_quickq_root resolver (regression guard for asu fix)
  - The /health and /response endpoints with the local adapter
  - Pydantic validation accepts a valid QuestionnaireResponse payload
  - LocalAdapter writes through to SQLite via the quickq SDK

This is the dev.sh-specific counterpart to tests/e2e/test_pipeline.py
(which uses an in-process FastAPI TestClient — faster, but does not
exercise the dev.sh subprocess + venv + ports flow that beta testers
actually hit).

Skips if quickq is not importable in this venv. With quickq-io-7p6
unfixed, that means a developer needs to run::

    uv pip install --editable ../quickq

inside quickq-forms's venv before this test will run. When 7p6 is
fixed (dev.sh auto-installs quickq), this skip should disappear.

Run locally:
    PYTHONPATH=../quickq uv run pytest tests/e2e/test_walkthrough_dev_sh.py -v
"""
from __future__ import annotations

import json
import os
import signal
import socket
import sqlite3
import subprocess
import time
from pathlib import Path

import pytest

quickq = pytest.importorskip("quickq", reason="quickq not installed — set PYTHONPATH or `uv pip install --editable ../quickq`")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DEV_SH = REPO_ROOT / "scripts" / "dev.sh"
GOUT_URL = "http://example.com/instruments/gout-checkin"


def _free_port() -> int:
    """Pick an unused TCP port. Race-free enough for tests."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_health(port: int, timeout: float = 15.0) -> bool:
    """Poll /health until 200 or timeout."""
    import urllib.error
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://localhost:{port}/health", timeout=0.5) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(0.3)
    return False


@pytest.fixture
def study_db(tmp_path):
    """Build a study.db with the gout walkthrough questionnaire and one library question."""
    from quickq.schema import init_oltp
    from quickq.loader import load_yaml

    db = tmp_path / "study.db"
    init_oltp(str(db))

    yaml_path = tmp_path / "gout.yaml"
    yaml_path.write_text(f"""
questionnaire:
  name: "Gout Symptoms Check-In"
  canonical_url: "{GOUT_URL}"
  version: "1.0"
  questions:
    - {{ link_id: gout.last_attack, text: "When did you last have a gout attack?", type: date }}
    - {{ link_id: gout.pain_now,    text: "Pain 0-10",                              type: numeric, range: [0, 10] }}
""")
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        load_yaml(conn, str(yaml_path))
    finally:
        conn.close()
    return db


@pytest.fixture
def dev_server(study_db, tmp_path):
    """
    Start dev.sh in the background and yield the API port. Cleans up on teardown.

    Note: dev.sh also starts the Vite dev server on port 5173 (or higher if
    that's taken). The test only talks to the API, so port collisions on the
    Vite side are harmless to this test.
    """
    api_port = _free_port()
    log = tmp_path / "devsh.log"

    proc = subprocess.Popen(
        ["bash", str(DEV_SH), "--db", str(study_db), "--questionnaire-id", "1",
         "--port", str(api_port)],
        stdout=open(log, "w"), stderr=subprocess.STDOUT,
        # New process group so we can kill all children with one signal
        preexec_fn=os.setsid,
    )

    try:
        if not _wait_for_health(api_port):
            log_text = log.read_text() if log.exists() else "(no log)"
            pytest.fail(f"dev.sh API did not become healthy on :{api_port}\n--- log ---\n{log_text}")
        yield api_port
    finally:
        # Kill the whole process group (uvicorn, vite, and the orchestrator)
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass


@pytest.mark.e2e
def test_devsh_round_trip(dev_server, study_db):
    """POST a FHIR QuestionnaireResponse via dev.sh's API, assert it lands in study.db."""
    import urllib.request

    port = dev_server
    payload = {
        "resourceType": "QuestionnaireResponse",
        "questionnaire": GOUT_URL,
        "status": "completed",
        "authored": "2026-05-02T12:00:00Z",
        "item": [
            {"linkId": "gout.last_attack", "answer": [{"valueDate": "2026-04-15"}]},
            {"linkId": "gout.pain_now",    "answer": [{"valueDecimal": 7}]},
        ],
    }

    req = urllib.request.Request(
        f"http://localhost:{port}/response",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert resp.status == 201, f"expected 201, got {resp.status}"
        body = json.loads(resp.read())
        assert "session_id" in body, body

    # Confirm the response landed in the OLTP DB
    conn = sqlite3.connect(str(study_db))
    try:
        n_sessions = conn.execute("SELECT COUNT(*) FROM response_session").fetchone()[0]
        n_responses = conn.execute("SELECT COUNT(*) FROM response").fetchone()[0]
    finally:
        conn.close()
    assert n_sessions == 1, f"expected 1 session, got {n_sessions}"
    assert n_responses == 2, f"expected 2 responses (date + numeric), got {n_responses}"


@pytest.mark.e2e
def test_devsh_health_endpoint(dev_server):
    """The most basic smoke test: /health returns ok."""
    import urllib.request
    port = dev_server
    with urllib.request.urlopen(f"http://localhost:{port}/health", timeout=2) as r:
        assert r.status == 200
        assert json.loads(r.read())["status"] == "ok"

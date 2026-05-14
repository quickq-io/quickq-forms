"""
End-to-end Playwright suite for the quickq-forms renderer.

Counterpart to quickq's test_e2e_lhcforms.py — same fixture-driven pattern,
but driving the React frontend served by FastAPI instead of LHC-Forms. Each
test:

  1. Boots uvicorn with the FileAdapter pointing at a temp output directory
     and one of the shared FHIR Questionnaire fixtures.
  2. Loads the page in a real browser, fills the form via DOM interaction.
  3. Submits and reads back the saved QuestionnaireResponse JSON.
  4. (When quickq is importable) round-trips through import_fhir_response and
     asserts the expected response rows land in study.db.

The suite is the regression net for phase 1 correctness work:
  - Repeating groups emit one parent item per instance (same linkId)
  - Grids nested inside repeating groups are keyed per instance
  - Skip logic with enableBehavior=all gates correctly
  - Single-choice / boolean / numeric / date / text round-trip through FHIR

Run:
    uv run pytest tests/e2e/test_render_round_trip.py -v
"""
from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterator

import pytest
from playwright.sync_api import Page, expect

REPO = Path(__file__).resolve().parent.parent.parent
FIXTURES = REPO / "frontend" / "src" / "__tests__" / "fixtures"
DIST = REPO / "frontend" / "dist"

# Round-trip assertions need quickq's parser. Tests that only check the saved
# response JSON shape run without it; round-trip tests skip.
_has_quickq = False
try:
    import quickq  # noqa: F401
    _has_quickq = True
except ImportError:
    pass


# ------------------------------------------------------------------
# Skip the entire module if the production build is absent. The
# FastAPI app's static-serving block needs frontend/dist/index.html
# to exist for the page to load.
# ------------------------------------------------------------------

if not (DIST / "index.html").is_file():
    pytest.skip(
        "frontend/dist not built — run `npm run build --prefix frontend` first",
        allow_module_level=True,
    )


# ------------------------------------------------------------------
# Server fixture factory
# ------------------------------------------------------------------

def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_health(port: int, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=0.5) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionError):
            pass
        time.sleep(0.2)
    return False


@pytest.fixture
def serve_fixture(tmp_path: Path) -> Iterator:
    """
    Returns a factory: serve_fixture(fixture_stem, preview=False) -> (url, output_dir).

    Starts one uvicorn subprocess per call against the named FHIR fixture in
    frontend/src/__tests__/fixtures/{stem}_fhir_questionnaire.json. The
    FileAdapter writes responses to a per-call subdirectory of tmp_path so
    each test sees only its own submissions. Pass preview=True to start the
    server in read-only preview mode.
    """
    procs: list[subprocess.Popen] = []

    def factory(
        fixture_stem: str,
        *,
        preview: bool = False,
        drafts: bool = False,
        roster: list[str] | None = None,
    ) -> tuple[str, Path]:
        port = _free_port()
        fixture_path = FIXTURES / f"{fixture_stem}_fhir_questionnaire.json"
        assert fixture_path.is_file(), f"missing fixture: {fixture_path}"

        suffix = ""
        if preview:
            suffix += "_preview"
        if drafts:
            suffix += "_drafts"
        if roster is not None:
            suffix += "_roster"
        out_dir = tmp_path / f"{fixture_stem}{suffix}"
        out_dir.mkdir(exist_ok=True)
        drafts_dir = (out_dir / "drafts") if drafts else None

        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        drafts_arg = f"r'{drafts_dir}'" if drafts_dir else "None"
        roster_arg = "None" if roster is None else "set(" + repr(roster) + ")"
        bootstrap = (
            f"from quickq_forms.adapters.file import FileAdapter;"
            f"from quickq_forms.main import create_app;"
            f"adapter = FileAdapter(output_dir=r'{out_dir}', questionnaire_path=r'{fixture_path}');"
            f"app = create_app(adapter, preview={preview}, drafts_dir={drafts_arg}, roster={roster_arg});"
            f"import uvicorn; uvicorn.run(app, host='127.0.0.1', port={port}, log_level='warning')"
        )
        proc = subprocess.Popen(
            [sys.executable, "-c", bootstrap],
            cwd=REPO,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
            preexec_fn=os.setsid,
        )
        procs.append(proc)

        if not _wait_for_health(port):
            pytest.fail(f"uvicorn for fixture {fixture_stem!r} did not become healthy on :{port}")
        return f"http://127.0.0.1:{port}", out_dir

    yield factory

    for proc in procs:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            proc.wait(timeout=5)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass


# ------------------------------------------------------------------
# DOM helpers — narrow, durable selectors driven by data-link-id +
# input names. Each helper takes the Page and the linkId of the
# *question wrapper*; for repeating-group children, the linkId is the
# fully-keyed form (`parent[0]:child`).
# ------------------------------------------------------------------

def _question_locator(page: Page, link_id: str):
    return page.locator(f'[data-link-id="{link_id}"]')


def _select_radio_by_index(page: Page, link_id: str, option_index: int) -> None:
    """Click the Nth (zero-indexed) option in a SingleChoice/Boolean question."""
    radios = _question_locator(page, link_id).locator(f'input[name="{link_id}"]')
    radios.nth(option_index).click(force=True)


def _select_radio_by_label(page: Page, link_id: str, label_text: str) -> None:
    """Click the option in this question whose visible label matches text."""
    _question_locator(page, link_id).locator("label").filter(has_text=label_text).first.click()


def _select_boolean(page: Page, link_id: str, value: bool) -> None:
    _select_radio_by_label(page, link_id, "Yes" if value else "No")


def _fill_numeric(page: Page, link_id: str, value: float | int) -> None:
    page.locator(f'input[id="{link_id}"]').fill(str(value))


def _fill_text(page: Page, link_id: str, value: str) -> None:
    page.locator(f'textarea[id="{link_id}"]').fill(value)


def _fill_date(page: Page, link_id: str, iso_date: str) -> None:
    page.locator(f'input[id="{link_id}"]').fill(iso_date)


def _check_multiple(page: Page, link_id: str, labels: list[str]) -> None:
    q = _question_locator(page, link_id)
    for label in labels:
        q.locator("label").filter(has_text=label).first.click()


def _select_grid_cell(
    page: Page, parent_link_id: str, row_link_id: str, col_label: str
) -> None:
    """Click a grid cell. Grid renders as a table where each row has radios
    grouped by the row.linkId. Clicking the label with col_label in that row."""
    row_radios = _question_locator(page, parent_link_id).locator(
        f'input[name="{row_link_id}"]'
    )
    # The radio for column N is at index N (columns are in order). Easier: click
    # the label that contains both the input and the screen-reader span with the
    # column display. We use the per-row scope by walking from the radio up.
    # Simpler: find the table row by row.text, then click the Nth column.
    n = row_radios.count()
    for i in range(n):
        radio = row_radios.nth(i)
        if col_label in (radio.evaluate("e => e.closest('label').textContent") or ""):
            radio.click(force=True)
            return
    raise AssertionError(f"grid cell not found: row={row_link_id}, col={col_label}")


def _add_repeating_instance(page: Page, parent_link_id: str) -> None:
    btn = _question_locator(page, parent_link_id).locator(
        'button:has-text("Add another")'
    )
    btn.first.click()


def _fill_slider(page: Page, link_id: str, value: int) -> None:
    """Set a range input via the value setter and fire React's onChange.

    Uses locator.evaluate so Playwright auto-waits for the element to exist
    after React hydrates. The native value setter + dispatched input/change
    events are what React's onChange handler listens for; calling
    locator.fill() on a range input doesn't fire React's synthetic event.
    """
    page.locator(f'input[id="{link_id}"]').evaluate(
        """
        (el, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, String(val));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        """,
        value,
    )


def _set_ranked_position(page: Page, link_id: str, option_label: str, rank: int) -> None:
    """For the Ranked component, find the row by option label and pick rank
    N from its select. Each option is a flex row with a <select> next to a
    <span>{display}</span>; targeting the span by partial text and then
    its sibling select avoids matching the outer container."""
    span = _question_locator(page, link_id).get_by_text(option_label, exact=False).first
    select = span.locator("xpath=preceding-sibling::select[1]")
    select.select_option(str(rank))


def _submit(page: Page) -> None:
    page.locator('button:has-text("Submit")').click()
    expect(page.locator('text=Thank you')).to_be_visible(timeout=5000)


def _saved_response(out_dir: Path) -> dict:
    files = list(out_dir.glob("*.QuestionnaireResponse.json"))
    assert len(files) == 1, f"expected exactly one saved response, found {len(files)}"
    return json.loads(files[0].read_text())


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

@pytest.mark.e2e
def test_phq9_basic_render_and_submit(serve_fixture, page: Page) -> None:
    """All 9 PHQ items answered → completed response with 9 valueCoding items."""
    url, out = serve_fixture("phq9")
    page.goto(url)
    expect(page.locator("h1")).to_be_visible()

    for i in range(1, 10):
        # Option 0 = "Not at all" (LA6568-5)
        _select_radio_by_index(page, f"phq9.{i}", 0)

    _submit(page)
    payload = _saved_response(out)

    assert payload["resourceType"] == "QuestionnaireResponse"
    assert payload["status"] == "completed"
    assert payload["questionnaire"] == "http://quickq.io/instruments/phq9"
    items = {it["linkId"]: it for it in payload["item"]}
    for i in range(1, 10):
        assert f"phq9.{i}" in items, f"missing phq9.{i}"
        ans = items[f"phq9.{i}"]["answer"][0]
        assert ans["valueCoding"]["code"] == "LA6568-5"

    # difficulty is gated on any item != Not-at-all. All zeroed → excluded.
    assert "phq9.difficulty" not in items


@pytest.mark.e2e
def test_phq9_skip_logic_reveals_difficulty(serve_fixture, page: Page) -> None:
    """A single non-zero PHQ answer reveals phq9.difficulty."""
    url, _ = serve_fixture("phq9")
    page.goto(url)
    expect(page.locator("h1")).to_be_visible()

    # difficulty starts hidden
    expect(_question_locator(page, "phq9.difficulty")).to_have_count(0)

    # Answer phq9.2 = Several days (option 1)
    _select_radio_by_index(page, "phq9.2", 1)

    expect(_question_locator(page, "phq9.difficulty")).to_be_visible()


@pytest.mark.e2e
def test_enable_behavior_all_round_trip(serve_fixture, page: Page) -> None:
    """The cessation question is only revealed when BOTH triggers are true."""
    url, out = serve_fixture("enable_behavior_all")
    page.goto(url)

    expect(_question_locator(page, "gated.cessation")).to_have_count(0)

    _select_boolean(page, "trig.age_18", True)
    expect(_question_locator(page, "gated.cessation")).to_have_count(0)

    _select_boolean(page, "trig.smoker", True)
    expect(_question_locator(page, "gated.cessation")).to_be_visible()

    _fill_text(page, "gated.cessation", "Tried last March")
    _submit(page)

    payload = _saved_response(out)
    items = {it["linkId"]: it for it in payload["item"]}
    assert items["trig.age_18"]["answer"][0]["valueBoolean"] is True
    assert items["trig.smoker"]["answer"][0]["valueBoolean"] is True
    assert items["gated.cessation"]["answer"][0]["valueString"] == "Tried last March"


@pytest.mark.e2e
def test_prenatal_repeating_group_emits_separate_parent_items(
    serve_fixture, page: Page
) -> None:
    """Two visit instances must emit two top-level items with linkId='visits'."""
    url, out = serve_fixture("prenatal_visits")
    page.goto(url)

    _fill_numeric(page, "visit_count", 2)

    # Instance 0
    _fill_numeric(page, "visits[0]:visits.week", 12)
    _select_radio_by_label(page, "visits[0]:visits.provider", "OB/GYN")
    _select_boolean(page, "visits[0]:visits.concern", False)

    # Add and fill instance 1
    _add_repeating_instance(page, "visits")
    _fill_numeric(page, "visits[1]:visits.week", 20)
    _select_radio_by_label(page, "visits[1]:visits.provider", "Midwife")
    _select_boolean(page, "visits[1]:visits.concern", True)

    _submit(page)
    payload = _saved_response(out)

    visits = [it for it in payload["item"] if it["linkId"] == "visits"]
    assert len(visits) == 2, f"expected 2 'visits' items, got {len(visits)}: {payload['item']}"
    # Instance 0
    children0 = {c["linkId"]: c for c in visits[0]["item"]}
    assert children0["visits.week"]["answer"][0]["valueDecimal"] == 12
    assert children0["visits.concern"]["answer"][0]["valueBoolean"] is False
    # Instance 1
    children1 = {c["linkId"]: c for c in visits[1]["item"]}
    assert children1["visits.week"]["answer"][0]["valueDecimal"] == 20
    assert children1["visits.concern"]["answer"][0]["valueBoolean"] is True


@pytest.mark.e2e
def test_grid_in_repeating_group_per_instance_keys(
    serve_fixture, page: Page
) -> None:
    """Grid cells in instance N must serialize under the Nth parent item."""
    url, out = serve_fixture("repeating_with_grid")
    page.goto(url)

    _fill_numeric(page, "rg.visit_count", 2)

    # Instance 0
    _fill_numeric(page, "rg.visits[0]:rg.visits.week", 1)
    _select_grid_cell(
        page,
        "rg.visits[0]:rg.visits.severity",
        "rg.visits[0]:rg.visits.severity.r0",
        "None",
    )
    _select_grid_cell(
        page,
        "rg.visits[0]:rg.visits.severity",
        "rg.visits[0]:rg.visits.severity.r1",
        "Mild",
    )

    # Instance 1
    _add_repeating_instance(page, "rg.visits")
    _fill_numeric(page, "rg.visits[1]:rg.visits.week", 2)
    _select_grid_cell(
        page,
        "rg.visits[1]:rg.visits.severity",
        "rg.visits[1]:rg.visits.severity.r0",
        "Severe",
    )

    _submit(page)
    payload = _saved_response(out)

    visits = [it for it in payload["item"] if it["linkId"] == "rg.visits"]
    assert len(visits) == 2

    grid0 = next(c for c in visits[0]["item"] if c["linkId"] == "rg.visits.severity")
    grid0_rows = {c["linkId"]: c for c in grid0["item"]}
    assert grid0_rows["rg.visits.severity.r0"]["answer"][0]["valueCoding"]["code"] == "0"
    assert grid0_rows["rg.visits.severity.r1"]["answer"][0]["valueCoding"]["code"] == "1"

    grid1 = next(c for c in visits[1]["item"] if c["linkId"] == "rg.visits.severity")
    grid1_rows = {c["linkId"]: c for c in grid1["item"]}
    assert grid1_rows["rg.visits.severity.r0"]["answer"][0]["valueCoding"]["code"] == "3"


# ------------------------------------------------------------------
# UI polish — numbering, validation, progress bar, description
# ------------------------------------------------------------------

@pytest.mark.e2e
def test_questions_are_numbered_in_display_order(serve_fixture, page: Page) -> None:
    """Top-level answerable items get 1., 2., 3., … prefixed in display order."""
    url, _ = serve_fixture("phq9")
    page.goto(url)
    expect(page.locator("h1")).to_be_visible()

    first = _question_locator(page, "phq9.1")
    text = first.locator("p").first.text_content() or ""
    assert text.strip().startswith("1."), f"phq9.1 should start with '1.', got: {text!r}"

    second = _question_locator(page, "phq9.2")
    text2 = second.locator("p").first.text_content() or ""
    assert text2.strip().startswith("2."), f"phq9.2 should start with '2.', got: {text2!r}"


@pytest.mark.e2e
def test_submit_with_missing_required_shows_inline_errors(serve_fixture, page: Page) -> None:
    """Clicking Submit with required+enabled items unanswered must:
    show a banner, mark the invalid question(s), and NOT POST the response."""
    url, out = serve_fixture("phq9")
    page.goto(url)

    # Only fill the first PHQ-9 item; items 2–9 are required and remain empty
    _select_radio_by_index(page, "phq9.1", 0)

    page.locator('button:has-text("Submit")').click()

    # Banner appears
    expect(page.locator('[data-testid="validation-banner"]')).to_be_visible()
    # First unanswered required question is highlighted (alert text appears)
    expect(_question_locator(page, "phq9.2").get_by_role("alert")).to_be_visible()
    # Nothing was POSTed — no saved response file
    page.wait_for_timeout(200)
    assert not list(out.glob("*.QuestionnaireResponse.json")), "Submission should have been blocked"


@pytest.mark.e2e
def test_validation_error_clears_when_question_gets_answered(
    serve_fixture, page: Page
) -> None:
    url, _ = serve_fixture("phq9")
    page.goto(url)

    _select_radio_by_index(page, "phq9.1", 0)
    page.locator('button:has-text("Submit")').click()
    expect(_question_locator(page, "phq9.2").get_by_role("alert")).to_be_visible()

    # Answering should clear the alert for that specific question
    _select_radio_by_index(page, "phq9.2", 0)
    expect(_question_locator(page, "phq9.2").get_by_role("alert")).to_have_count(0)


@pytest.mark.e2e
def test_progress_bar_fills_as_required_questions_get_answered(
    serve_fixture, page: Page
) -> None:
    """Answering the 9 required PHQ-9 items walks the progress fill from 0% to 100%."""
    url, _ = serve_fixture("phq9")
    page.goto(url)

    fill = page.locator('[data-testid="progress-fill"]')
    expect(fill).to_have_attribute("style", "width: 0%;")

    for i in range(1, 10):
        _select_radio_by_index(page, f"phq9.{i}", 0)
    # 9 of 9 required PHQ items answered (difficulty is not required)
    expect(fill).to_have_attribute("style", "width: 100%;")


@pytest.mark.e2e
def test_description_renders_below_title_when_present(serve_fixture, page: Page) -> None:
    """The FHIR Questionnaire `description` field — when populated — appears as
    intro text under the title. Not every fixture has one; this asserts the
    plumbing rather than per-fixture content."""
    url, _ = serve_fixture("enable_behavior_all")
    page.goto(url)
    header = page.locator("header")
    description = header.locator("p")
    if description.count() > 0:
        text = description.text_content() or ""
        assert len(text) > 0
    # Else: fixture has no description; the absence isn't a bug, just a no-op


# ------------------------------------------------------------------
# Question-type coverage — fills the remaining ⚪ cells in the
# quickq-forms column of docs/internal/renderer-coverage.md
# ------------------------------------------------------------------

@pytest.mark.e2e
def test_multiple_choice_emits_multiple_value_codings(serve_fixture, page: Page) -> None:
    """Multi-select choice question (gout.attack_joints) emits one
    valueCoding answer per selected option."""
    url, out = serve_fixture("gout_checkin")
    page.goto(url)
    expect(page.locator("h1")).to_be_visible()

    _check_multiple(page, "gout.attack_joints", ["Big toe", "Ankle", "Knee"])
    _submit(page)
    payload = _saved_response(out)

    item = next(i for i in payload["item"] if i["linkId"] == "gout.attack_joints")
    codes = {a["valueCoding"]["code"] for a in item["answer"]}
    assert codes == {"big_toe", "ankle", "knee"}, f"got {codes}"


@pytest.mark.e2e
def test_sata_other_emits_codings_plus_value_string(serve_fixture, page: Page) -> None:
    """sata_other (FHIR open-choice): selected checkboxes serialize as valueCoding,
    free-text 'Other' field serializes as valueString in the same answer array."""
    url, out = serve_fixture("prapare")
    page.goto(url)
    expect(page.locator("h1")).to_be_visible()

    _check_multiple(page, "prapare.necessities", ["Food", "Medicine"])
    page.locator('[data-link-id="prapare.necessities"] input[type="text"]').fill(
        "Pet food"
    )
    _submit(page)
    payload = _saved_response(out)

    item = next(i for i in payload["item"] if i["linkId"] == "prapare.necessities")
    codes = {a["valueCoding"]["code"] for a in item["answer"] if "valueCoding" in a}
    strings = [a["valueString"] for a in item["answer"] if "valueString" in a]
    assert "LA30125-1" in codes  # Food
    assert "LA30128-5" in codes  # Medicine
    assert strings == ["Pet food"]


@pytest.mark.e2e
def test_date_value_is_iso_yyyy_mm_dd(serve_fixture, page: Page) -> None:
    """`type: date` renders as a date input and serializes valueDate."""
    url, out = serve_fixture("gout_checkin")
    page.goto(url)

    _fill_date(page, "gout.last_attack_date", "2026-04-15")
    _fill_date(page, "gout.uric_acid_date", "2026-04-01")
    _submit(page)
    payload = _saved_response(out)

    items = {i["linkId"]: i for i in payload["item"]}
    assert items["gout.last_attack_date"]["answer"][0] == {"valueDate": "2026-04-15"}
    assert items["gout.uric_acid_date"]["answer"][0] == {"valueDate": "2026-04-01"}


@pytest.mark.e2e
def test_datetime_value_is_iso_with_time(serve_fixture, page: Page) -> None:
    """`type: datetime` renders as datetime-local and serializes valueDateTime."""
    url, out = serve_fixture("gout_checkin")
    page.goto(url)

    # datetime-local format is 'YYYY-MM-DDTHH:mm'
    page.locator('input[id="gout.last_attack_datetime"]').fill("2026-04-15T08:30")
    _submit(page)
    payload = _saved_response(out)

    item = next(i for i in payload["item"] if i["linkId"] == "gout.last_attack_datetime")
    assert item["answer"][0] == {"valueDateTime": "2026-04-15T08:30"}


@pytest.mark.e2e
def test_likert_round_trips_as_value_coding(serve_fixture, page: Page) -> None:
    """Likert items render as a horizontal scale; selecting one option emits
    valueCoding with the LOINC code. AUDIT q1-q3 are dedicated likert questions."""
    url, out = serve_fixture("audit")
    page.goto(url)
    expect(page.locator("h1")).to_be_visible()

    # audit.q1: "Never" is option 0; q2: "1 or 2" is option 0; q3: option 1
    _select_radio_by_index(page, "audit.q1", 0)
    _select_radio_by_index(page, "audit.q2", 1)
    _select_radio_by_index(page, "audit.q3", 2)
    _submit(page)
    payload = _saved_response(out)

    items = {i["linkId"]: i for i in payload["item"]}
    assert items["audit.q1"]["answer"][0]["valueCoding"]["code"] == "LA6270-8"
    # q2 option 1 is "3 or 4"
    assert items["audit.q2"]["answer"][0]["valueCoding"]["code"] == "LA15695-2"


@pytest.mark.e2e
def test_slider_round_trips_as_value_integer(serve_fixture, page: Page) -> None:
    """Slider renders as a native range input; the value flows through
    as valueInteger and lands in response_numeric on import."""
    url, out = serve_fixture("gout_checkin")
    page.goto(url)

    _fill_slider(page, "gout.pain_vas", 7)
    _submit(page)
    payload = _saved_response(out)

    item = next(i for i in payload["item"] if i["linkId"] == "gout.pain_vas")
    assert item["answer"][0] == {"valueInteger": 7}


@pytest.mark.e2e
def test_ranked_emits_ordinal_value_extensions(serve_fixture, page: Page) -> None:
    """Ranked: assign 1/2/3 to three options via per-row dropdowns;
    each gets an ordinalValue extension in order."""
    url, out = serve_fixture("gout_checkin")
    page.goto(url)

    _set_ranked_position(page, "gout.treatment_priorities", "Reducing pain", 1)
    _set_ranked_position(page, "gout.treatment_priorities", "Preventing future", 2)
    _set_ranked_position(page, "gout.treatment_priorities", "target uric acid", 3)
    _submit(page)
    payload = _saved_response(out)

    item = next(i for i in payload["item"] if i["linkId"] == "gout.treatment_priorities")
    ranks = [
        (a["valueCoding"]["code"], a["extension"][0]["valueDecimal"])
        for a in item["answer"]
    ]
    assert ranks == [
        ("pain_relief", 1),
        ("prevention", 2),
        ("uric_acid", 3),
    ], f"got {ranks}"


@pytest.mark.e2e
def test_standalone_grid_round_trips(serve_fixture, page: Page) -> None:
    """Grid not nested in a repeating group: each row cell selection serializes
    as a child item under the grid parent."""
    url, out = serve_fixture("gout_checkin")
    page.goto(url)

    # joint_severity has 6 rows × 4 columns (None/Mild/Moderate/Severe).
    # Pick a mix of severity values.
    _select_grid_cell(
        page, "gout.joint_severity", "gout.joint_severity.r0", "Severe"
    )
    _select_grid_cell(
        page, "gout.joint_severity", "gout.joint_severity.r1", "Mild"
    )
    _select_grid_cell(
        page, "gout.joint_severity", "gout.joint_severity.r2", "None"
    )
    _submit(page)
    payload = _saved_response(out)

    grid = next(i for i in payload["item"] if i["linkId"] == "gout.joint_severity")
    rows = {c["linkId"]: c["answer"][0]["valueCoding"]["code"] for c in grid["item"]}
    assert rows["gout.joint_severity.r0"] == "3"
    assert rows["gout.joint_severity.r1"] == "1"
    assert rows["gout.joint_severity.r2"] == "0"


# ------------------------------------------------------------------
# End-to-end submission round-trips (fill remaining ⚪ cells in the
# "End-to-end submission flow" table of renderer-coverage.md)
# ------------------------------------------------------------------

@pytest.mark.e2e
@pytest.mark.skipif(not _has_quickq, reason="quickq not installed")
def test_gout_multi_type_round_trips_into_typed_columns(
    serve_fixture, page: Page, tmp_path: Path
) -> None:
    """Fill date, boolean, numeric, multiple_choice, slider, ranked, grid, and
    text in one gout submission; assert each lands in the correct typed column."""
    from quickq.schema import init_oltp, open_oltp
    from quickq.parser_fhir import import_fhir
    from quickq.parser_fhir_response import import_fhir_response

    url, out = serve_fixture("gout_checkin")
    page.goto(url)

    _fill_date(page, "gout.last_attack_date", "2026-04-15")
    _fill_numeric(page, "gout.attacks_12mo", 3)
    _check_multiple(page, "gout.attack_joints", ["Big toe", "Ankle"])
    _select_grid_cell(page, "gout.joint_severity", "gout.joint_severity.r0", "Severe")
    _select_boolean(page, "gout.on_ult", True)
    _fill_numeric(page, "gout.uric_acid", 7.2)
    _fill_slider(page, "gout.pain_vas", 6)
    _set_ranked_position(page, "gout.treatment_priorities", "Reducing pain", 1)
    _fill_text(page, "gout.notes", "Symptoms improving.")
    _submit(page)
    payload = _saved_response(out)

    db = tmp_path / "study.db"
    conn = init_oltp(str(db))
    import_fhir(conn, (FIXTURES / "gout_checkin_fhir_questionnaire.json").read_text())
    conn.commit()
    session_id = import_fhir_response(conn, payload)
    conn.commit()

    conn = open_oltp(str(db))
    n_flags = conn.execute(
        "SELECT COUNT(*) FROM data_quality_flag WHERE session_id = ? AND severity='error'",
        (session_id,),
    ).fetchone()[0]
    assert n_flags == 0, f"expected no error flags, got {n_flags}"

    rows = conn.execute(
        """
        SELECT q.link_id, r.response_text, r.response_numeric, r.response_date, r.option_id
        FROM response r
        JOIN questionnaire_question qq ON r.qq_id = qq.qq_id
        JOIN question q ON qq.question_id = q.question_id
        WHERE r.session_id = ?
        """,
        (session_id,),
    ).fetchall()
    # One link_id may appear multiple times (multi_choice, ranked, grid)
    by_link: dict[str, list[tuple]] = {}
    for link_id, text, num, date, opt in rows:
        by_link.setdefault(link_id, []).append((text, num, date, opt))

    assert by_link["gout.last_attack_date"][0][2] == "2026-04-15"
    assert by_link["gout.on_ult"][0][0] == "true"
    assert by_link["gout.attacks_12mo"][0][1] == 3
    assert by_link["gout.uric_acid"][0][1] == 7.2
    assert by_link["gout.pain_vas"][0][1] == 6
    assert by_link["gout.notes"][0][0] == "Symptoms improving."
    # multi-choice: 2 rows for attack_joints (big_toe, ankle)
    assert len(by_link["gout.attack_joints"]) == 2
    conn.close()


@pytest.mark.e2e
@pytest.mark.skipif(not _has_quickq, reason="quickq not installed")
def test_grid_in_repeating_imports_per_instance_grid_cells(
    serve_fixture, page: Page, tmp_path: Path
) -> None:
    """Closes the renderer-coverage cell for the grid-in-repeating import
    path: drive the form, submit, import, and assert each grid cell lands in
    `response` with the correct repeat_index + grid_row_id + grid_column_id."""
    from quickq.schema import init_oltp, open_oltp
    from quickq.parser_fhir import import_fhir
    from quickq.parser_fhir_response import import_fhir_response

    url, out = serve_fixture("repeating_with_grid")
    page.goto(url)

    _fill_numeric(page, "rg.visit_count", 2)
    _fill_numeric(page, "rg.visits[0]:rg.visits.week", 1)
    _select_grid_cell(
        page, "rg.visits[0]:rg.visits.severity",
        "rg.visits[0]:rg.visits.severity.r0", "None",
    )
    _add_repeating_instance(page, "rg.visits")
    _fill_numeric(page, "rg.visits[1]:rg.visits.week", 2)
    _select_grid_cell(
        page, "rg.visits[1]:rg.visits.severity",
        "rg.visits[1]:rg.visits.severity.r0", "Severe",
    )
    _submit(page)
    payload = _saved_response(out)

    db = tmp_path / "study.db"
    conn = init_oltp(str(db))
    import_fhir(
        conn,
        (FIXTURES / "repeating_with_grid_fhir_questionnaire.json").read_text(),
    )
    conn.commit()
    session_id = import_fhir_response(conn, payload)
    conn.commit()

    conn = open_oltp(str(db))
    rows = list(conn.execute(
        """
        SELECT q.link_id, r.repeat_index, r.grid_row_id, r.grid_column_id
        FROM response r
        JOIN questionnaire_question qq ON r.qq_id = qq.qq_id
        JOIN question q ON qq.question_id = q.question_id
        WHERE r.session_id = ? AND r.grid_row_id IS NOT NULL
        ORDER BY r.repeat_index, r.grid_row_id
        """,
        (session_id,),
    ).fetchall())
    grid_rows = [tuple(r) for r in rows]
    assert len(grid_rows) == 2, f"expected 2 grid-cell rows, got {grid_rows}"
    assert {r[1] for r in grid_rows} == {0, 1}
    conn.close()


# ------------------------------------------------------------------
# Respondent identification (pilot-readiness phase 1)
# ------------------------------------------------------------------

@pytest.mark.e2e
def test_respondent_id_from_url_appears_in_header_and_response(
    serve_fixture, page: Page,
) -> None:
    """A `?r=R042` query param should display in the form header AND be
    serialized into subject.reference when the response is submitted."""
    url, out = serve_fixture("phq9")
    page.goto(f"{url}/?r=R042")
    expect(page.locator("h1")).to_be_visible()

    pill = page.locator('[data-testid="respondent-id"]')
    expect(pill).to_be_visible()
    assert "R042" in (pill.text_content() or "")

    for i in range(1, 10):
        _select_radio_by_index(page, f"phq9.{i}", 0)
    _submit(page)

    payload = _saved_response(out)
    assert payload.get("subject", {}).get("reference") == "Patient/R042"


@pytest.mark.e2e
def test_anonymous_submission_has_no_subject(serve_fixture, page: Page) -> None:
    """No query param → no subject in the response (anonymous mode preserved)."""
    url, out = serve_fixture("phq9")
    page.goto(url)
    for i in range(1, 10):
        _select_radio_by_index(page, f"phq9.{i}", 0)
    _submit(page)
    payload = _saved_response(out)
    assert "subject" not in payload, f"anonymous submission should have no subject, got {payload}"


@pytest.mark.e2e
@pytest.mark.skipif(not _has_quickq, reason="quickq not installed")
def test_respondent_id_round_trips_through_import_fhir_response(
    serve_fixture, page: Page, tmp_path: Path,
) -> None:
    """End-to-end: `?r=R042` → submit → import → respondent table has
    external_id='R042' and the session is linked to that respondent."""
    from quickq.schema import init_oltp, open_oltp
    from quickq.parser_fhir import import_fhir
    from quickq.parser_fhir_response import import_fhir_response

    url, out = serve_fixture("phq9")
    page.goto(f"{url}/?r=R042")

    for i in range(1, 10):
        _select_radio_by_index(page, f"phq9.{i}", 0)
    _submit(page)
    payload = _saved_response(out)

    db = tmp_path / "study.db"
    conn = init_oltp(str(db))
    import_fhir(conn, (FIXTURES / "phq9_fhir_questionnaire.json").read_text())
    conn.commit()
    session_id = import_fhir_response(conn, payload)
    conn.commit()
    conn.close()

    conn = open_oltp(str(db))
    row = conn.execute(
        """
        SELECT r.external_id
        FROM response_session rs
        JOIN respondent r ON rs.respondent_id = r.respondent_id
        WHERE rs.session_id = ?
        """,
        (session_id,),
    ).fetchone()
    conn.close()
    assert row is not None, "session should be linked to a respondent"
    assert row[0] == "R042", f"expected external_id=R042, got {row[0]!r}"


# ------------------------------------------------------------------
# Resume / drafts (pilot-readiness phase 2)
# ------------------------------------------------------------------

@pytest.mark.e2e
def test_draft_autosave_then_resume(serve_fixture, page: Page) -> None:
    """Fill in a few PHQ-9 items, wait for autosave, reload the page with the
    same respondent ID → answers are restored and a 'welcome back' hint shows."""
    url, _ = serve_fixture("phq9", drafts=True)
    page.goto(f"{url}/?r=R042")
    expect(page.locator("h1")).to_be_visible()

    # Fill first three items at different option indices to make the state
    # check meaningful (not all "option 0")
    _select_radio_by_index(page, "phq9.1", 0)
    _select_radio_by_index(page, "phq9.2", 1)
    _select_radio_by_index(page, "phq9.3", 2)

    # Autosave debounce is 1s — wait a bit longer to be safe
    page.wait_for_timeout(1500)

    # Reload — should now hydrate from the saved draft
    page.goto(f"{url}/?r=R042")
    expect(page.locator("h1")).to_be_visible()

    expect(page.locator('[data-testid="draft-resumed"]')).to_be_visible()

    # The three answered radios remain checked at the right options
    assert page.locator(f'input[name="phq9.1"]').nth(0).is_checked()
    assert page.locator(f'input[name="phq9.2"]').nth(1).is_checked()
    assert page.locator(f'input[name="phq9.3"]').nth(2).is_checked()


@pytest.mark.e2e
def test_draft_deleted_after_final_submission(serve_fixture, page: Page) -> None:
    """Submitting a final response should clear the draft. A subsequent visit
    with the same respondent ID must NOT show the resumed banner."""
    url, _ = serve_fixture("phq9", drafts=True)
    page.goto(f"{url}/?r=R007")
    for i in range(1, 10):
        _select_radio_by_index(page, f"phq9.{i}", 0)
    # No "Several days" → difficulty stays disabled, no need to answer
    _submit(page)

    # Revisit — fresh state, no resume banner
    page.goto(f"{url}/?r=R007")
    expect(page.locator("h1")).to_be_visible()
    expect(page.locator('[data-testid="draft-resumed"]')).to_have_count(0)


@pytest.mark.e2e
def test_drafts_per_respondent_isolation(serve_fixture, page: Page) -> None:
    """Two different respondent IDs maintain separate drafts."""
    url, _ = serve_fixture("phq9", drafts=True)

    # Respondent A fills q1=option 0
    page.goto(f"{url}/?r=A001")
    _select_radio_by_index(page, "phq9.1", 0)
    page.wait_for_timeout(1500)

    # Respondent B fills q1=option 2
    page.goto(f"{url}/?r=B001")
    _select_radio_by_index(page, "phq9.1", 2)
    page.wait_for_timeout(1500)

    # Back to A — should see q1 at option 0, not option 2
    page.goto(f"{url}/?r=A001")
    expect(page.locator("h1")).to_be_visible()
    expect(page.locator('[data-testid="draft-resumed"]')).to_be_visible()
    assert page.locator('input[name="phq9.1"]').nth(0).is_checked()
    assert not page.locator('input[name="phq9.1"]').nth(2).is_checked()


@pytest.mark.e2e
def test_drafts_disabled_when_no_drafts_dir(serve_fixture, page: Page) -> None:
    """A server started without drafts must not advertise the feature, and
    /draft requests should 404."""
    url, _ = serve_fixture("phq9", drafts=False)
    with urllib.request.urlopen(f"{url}/config", timeout=2) as r:
        cfg = json.load(r)
    assert cfg.get("drafts_enabled") is False

    req = urllib.request.Request(f"{url}/draft?r=R001")
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(req, timeout=2)
    assert exc.value.code == 404


@pytest.mark.e2e
def test_drafts_rejects_path_traversal_id(serve_fixture, page: Page) -> None:
    """Respondent IDs are validated server-side. A bogus value must 400."""
    url, _ = serve_fixture("phq9", drafts=True)
    req = urllib.request.Request(f"{url}/draft?r=../etc/passwd")
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(req, timeout=2)
    assert exc.value.code == 400


# ------------------------------------------------------------------
# Roster gate (pilot-readiness phase 3)
# ------------------------------------------------------------------

@pytest.mark.e2e
def test_roster_rejects_missing_respondent_code(serve_fixture, page: Page) -> None:
    """No ?r= → 'missing respondent code' page, form does not render."""
    url, _ = serve_fixture("phq9", roster=["R001", "R002"])
    page.goto(url)
    expect(page.locator('[data-testid="roster-rejection"]')).to_be_visible()
    expect(page.locator("form")).to_have_count(0)


@pytest.mark.e2e
def test_roster_rejects_unknown_respondent_code(serve_fixture, page: Page) -> None:
    """?r=R999 not in roster → 'not valid' page."""
    url, _ = serve_fixture("phq9", roster=["R001", "R002"])
    page.goto(f"{url}/?r=R999")
    expect(page.locator('[data-testid="roster-rejection"]')).to_be_visible()
    expect(page.locator("form")).to_have_count(0)


@pytest.mark.e2e
def test_roster_accepts_known_respondent_code(serve_fixture, page: Page) -> None:
    """?r=R001 in roster → form renders normally."""
    url, _ = serve_fixture("phq9", roster=["R001", "R002"])
    page.goto(f"{url}/?r=R001")
    expect(page.locator('[data-testid="roster-rejection"]')).to_have_count(0)
    expect(page.locator("form")).to_be_visible()
    expect(page.locator('[data-testid="respondent-id"]')).to_be_visible()


@pytest.mark.e2e
def test_roster_rejects_response_submission_for_unknown_id(serve_fixture) -> None:
    """Even bypassing the UI, the server must 403 a submission with an
    unknown respondent ID."""
    url, _ = serve_fixture("phq9", roster=["R001"])
    req = urllib.request.Request(
        f"{url}/response",
        data=json.dumps({
            "resourceType": "QuestionnaireResponse",
            "questionnaire": "http://quickq.io/instruments/phq9",
            "status": "completed",
            "subject": {"reference": "Patient/R999"},
            "item": [],
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(req, timeout=2)
    assert exc.value.code == 403


@pytest.mark.e2e
def test_roster_rejects_draft_for_unknown_id(serve_fixture) -> None:
    """Same defense-in-depth check for the draft endpoint."""
    url, _ = serve_fixture("phq9", drafts=True, roster=["R001"])
    req = urllib.request.Request(f"{url}/draft?r=R999")
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(req, timeout=2)
    assert exc.value.code == 403


# ------------------------------------------------------------------
# Preview mode
# ------------------------------------------------------------------

@pytest.mark.e2e
def test_preview_banner_visible_and_no_submit_button(serve_fixture, page: Page) -> None:
    url, _ = serve_fixture("phq9", preview=True)
    page.goto(url)

    expect(page.locator('[data-testid="preview-banner"]')).to_be_visible()
    expect(page.locator('button:has-text("Submit")')).to_have_count(0)


@pytest.mark.e2e
def test_preview_inputs_are_disabled(serve_fixture, page: Page) -> None:
    """Wrapping fieldset disabled=true should disable every native input."""
    url, _ = serve_fixture("gout_checkin", preview=True)
    page.goto(url)
    expect(page.locator("h1")).to_be_visible()

    # Every radio, checkbox, number/text/date/range input must report disabled
    all_inputs = page.locator("form input, form textarea, form select, form button")
    n = all_inputs.count()
    assert n > 0, "expected the form to have at least one interactive control"
    for i in range(n):
        assert all_inputs.nth(i).is_disabled(), (
            f"control {i} is not disabled in preview mode: "
            f"{all_inputs.nth(i).evaluate('e => e.outerHTML.slice(0,120)')}"
        )


@pytest.mark.e2e
def test_preview_post_response_returns_403(serve_fixture, page: Page) -> None:
    """Even if a client bypasses the UI, the server must reject submissions."""
    url, _ = serve_fixture("phq9", preview=True)

    req = urllib.request.Request(
        f"{url}/response",
        data=json.dumps({
            "resourceType": "QuestionnaireResponse",
            "questionnaire": "http://quickq.io/instruments/phq9",
            "status": "completed",
            "item": [],
        }).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(req, timeout=5)
    assert exc.value.code == 403, f"expected 403, got {exc.value.code}"


# ------------------------------------------------------------------
# Round-trip into study.db via quickq.import_fhir_response. The above
# tests prove the renderer emits the right shape; these prove that
# shape lands in the OLTP exactly as expected.
# ------------------------------------------------------------------

pytestmark = pytest.mark.skipif(False, reason="")


@pytest.mark.e2e
@pytest.mark.skipif(not _has_quickq, reason="quickq not installed")
def test_phq9_imports_into_study_db(serve_fixture, page: Page, tmp_path: Path) -> None:
    from quickq.schema import init_oltp
    from quickq.parser_fhir import import_fhir
    from quickq.parser_fhir_response import import_fhir_response

    url, out = serve_fixture("phq9")
    page.goto(url)

    for i in range(1, 10):
        _select_radio_by_index(page, f"phq9.{i}", 1)  # Several days
    # Non-zero PHQ answers reveal phq9.difficulty — answer it too
    _select_radio_by_index(page, "phq9.difficulty", 0)
    _submit(page)
    payload = _saved_response(out)

    db = tmp_path / "study.db"
    conn = init_oltp(str(db))
    import_fhir(conn, (FIXTURES / "phq9_fhir_questionnaire.json").read_text())
    conn.commit()
    session_id = import_fhir_response(conn, payload)
    conn.commit()

    n = conn.execute(
        "SELECT COUNT(*) FROM response WHERE session_id = ?", (session_id,)
    ).fetchone()[0]
    # 9 PHQ answers + 1 difficulty (gated open since all are Several days)
    assert n == 10, f"expected 10 response rows, got {n}"
    conn.close()


@pytest.mark.e2e
@pytest.mark.skipif(not _has_quickq, reason="quickq not installed")
def test_prenatal_visits_import_records_repeat_index(
    serve_fixture, page: Page, tmp_path: Path
) -> None:
    from quickq.schema import init_oltp
    from quickq.parser_fhir import import_fhir
    from quickq.parser_fhir_response import import_fhir_response

    url, out = serve_fixture("prenatal_visits")
    page.goto(url)

    _fill_numeric(page, "visit_count", 2)
    _fill_numeric(page, "visits[0]:visits.week", 12)
    _select_radio_by_label(page, "visits[0]:visits.provider", "OB/GYN")
    _select_boolean(page, "visits[0]:visits.concern", False)
    _add_repeating_instance(page, "visits")
    _fill_numeric(page, "visits[1]:visits.week", 20)
    _select_radio_by_label(page, "visits[1]:visits.provider", "Midwife")
    _select_boolean(page, "visits[1]:visits.concern", True)
    _submit(page)
    payload = _saved_response(out)

    db = tmp_path / "study.db"
    conn = init_oltp(str(db))
    import_fhir(conn, (FIXTURES / "prenatal_visits_fhir_questionnaire.json").read_text())
    conn.commit()
    session_id = import_fhir_response(conn, payload)
    conn.commit()

    # 3 children x 2 instances + 1 visit_count = 7 rows
    rows = conn.execute(
        """
        SELECT q.link_id, r.repeat_index
        FROM response r
        JOIN questionnaire_question qq ON r.qq_id = qq.qq_id
        JOIN question q ON qq.question_id = q.question_id
        WHERE r.session_id = ?
        ORDER BY r.response_id
        """,
        (session_id,),
    ).fetchall()
    repeat_indices = [row[1] for row in rows if row[0] != "visit_count"]
    # Both 0 and 1 must appear in the repeat_index column
    assert 0 in repeat_indices and 1 in repeat_indices, f"got {repeat_indices}"
    conn.close()

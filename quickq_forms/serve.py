"""
Serve a quickq Questionnaire and collect FHIR QuestionnaireResponses.

Public entry point shared by:
  - quickq-forms's CLI (`quickq-forms serve …`)
  - quickq's CLI shim (`quickq serve …`, after pip install quickq[serve])

Polymorphic on input source: exactly one of `db_path` or `questionnaire_path`
must be provided.
  - db_path: LocalAdapter writes to a quickq study.db. Requires quickq.
  - questionnaire_path: FileAdapter reads a FHIR Questionnaire JSON;
    writes responses as files in output_dir. No quickq dependency.
"""
from __future__ import annotations

from pathlib import Path


def run(
    *,
    db_path: str | None = None,
    questionnaire_path: str | None = None,
    questionnaire_id: int = 1,
    output_dir: str = "responses",
    drafts_dir: str | None = "drafts",
    respondents_path: str | None = None,
    port: int = 8000,
    host: str = "127.0.0.1",
    open_browser: bool = True,
    reload: bool = False,
    preview: bool = False,
) -> None:
    if (db_path is None) == (questionnaire_path is None):
        raise ValueError("must provide exactly one of db_path or questionnaire_path")

    import uvicorn

    from .main import create_app

    if db_path is not None:
        from .adapters.local import LocalAdapter
        adapter = LocalAdapter(
            db_path=str(Path(db_path).resolve()),
            questionnaire_id=questionnaire_id,
        )
        source_label = f"questionnaire {questionnaire_id} from {db_path}"
    else:
        from .adapters.file import FileAdapter
        adapter = FileAdapter(
            output_dir=output_dir,
            questionnaire_path=questionnaire_path,
        )
        source_label = str(questionnaire_path)

    # Drafts default to a `drafts/` directory in the cwd. Preview mode
    # disables them automatically inside create_app.
    resolved_drafts = None if drafts_dir is None else str(Path(drafts_dir).resolve())

    roster: set[str] | None = None
    if respondents_path is not None:
        roster = _read_roster(respondents_path)
        if not roster:
            raise ValueError(f"roster file {respondents_path!r} is empty")

    app = create_app(
        adapter,
        preview=preview,
        drafts_dir=resolved_drafts,
        roster=roster,
    )

    if open_browser:
        import threading
        import time
        import webbrowser

        def _open() -> None:
            time.sleep(1.0)
            webbrowser.open(f"http://localhost:{port}")

        threading.Thread(target=_open, daemon=True).start()

    mode = "preview (read-only)" if preview else "serving"
    print(f"{mode}: {source_label} on http://localhost:{port}")
    if roster is not None:
        print(f"roster: {len(roster)} respondent(s) accepted from {respondents_path}")
    uvicorn.run(app, host=host, port=port, reload=reload)


def _read_roster(path: str) -> set[str]:
    """One ID per line. Blank lines and `# comments` are skipped. IDs must
    pass DraftStore's validator — same charset as on the wire."""
    from .drafts import is_valid_respondent_id

    out: set[str] = set()
    with open(path, encoding="utf-8") as f:
        for line_no, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if not is_valid_respondent_id(line):
                raise ValueError(
                    f"{path}:{line_no}: {line!r} is not a valid respondent ID "
                    f"(allowed chars: alphanumeric, dash, underscore; max 64)"
                )
            out.add(line)
    return out

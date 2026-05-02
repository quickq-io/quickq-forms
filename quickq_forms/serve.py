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
    port: int = 8000,
    host: str = "127.0.0.1",
    open_browser: bool = True,
    reload: bool = False,
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

    app = create_app(adapter)

    if open_browser:
        import threading
        import time
        import webbrowser

        def _open() -> None:
            time.sleep(1.0)
            webbrowser.open(f"http://localhost:{port}")

        threading.Thread(target=_open, daemon=True).start()

    print(f"Serving {source_label} on http://localhost:{port}")
    uvicorn.run(app, host=host, port=port, reload=reload)

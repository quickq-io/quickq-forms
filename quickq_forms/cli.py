from __future__ import annotations

import click


@click.group()
def main() -> None:
    """quickq-forms — FHIR questionnaire delivery server."""


@main.command()
@click.argument("questionnaire", type=click.Path(exists=True), required=False)
@click.option("--db", "db_path", type=click.Path(exists=True), default=None,
              help="Path to a quickq study.db. Switches to LocalAdapter mode (requires "
                   "quickq installed; responses write directly to the SQLite OLTP).")
@click.option("--questionnaire-id", default=1, show_default=True,
              help="Questionnaire ID to serve when using --db.")
@click.option("--output-dir", default="responses", show_default=True,
              help="Directory to write QuestionnaireResponse JSON files (file mode).")
@click.option("--port", default=8000, show_default=True)
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--no-browser", is_flag=True, default=False,
              help="Do not open a browser tab after the server starts.")
@click.option("--reload", is_flag=True, default=False,
              help="Enable uvicorn auto-reload (file mode dev only).")
def serve(questionnaire: str | None, db_path: str | None, questionnaire_id: int,
          output_dir: str, port: int, host: str, no_browser: bool, reload: bool) -> None:
    """Serve a Questionnaire and collect FHIR QuestionnaireResponses.

    Provide either QUESTIONNAIRE (a FHIR JSON file; FileAdapter mode) or
    --db PATH (a quickq study.db; LocalAdapter mode).
    """
    if (questionnaire is None) == (db_path is None):
        raise click.UsageError(
            "provide either QUESTIONNAIRE (file mode) or --db PATH (DB mode), "
            "not both and not neither"
        )

    from .serve import run
    run(
        db_path=db_path,
        questionnaire_path=questionnaire,
        questionnaire_id=questionnaire_id,
        output_dir=output_dir,
        port=port,
        host=host,
        open_browser=not no_browser,
        reload=reload,
    )

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
@click.option("--respondents", "respondents_path", type=click.Path(exists=True), default=None,
              help="Path to a file with one respondent ID per line. When provided, only "
                   "listed IDs may fetch drafts or submit responses; everyone else gets "
                   "a clean error page.")
@click.option("--port", default=8000, show_default=True)
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--no-browser", is_flag=True, default=False,
              help="Do not open a browser tab after the server starts.")
@click.option("--reload", is_flag=True, default=False,
              help="Enable uvicorn auto-reload (file mode dev only).")
def serve(questionnaire: str | None, db_path: str | None, questionnaire_id: int,
          output_dir: str, respondents_path: str | None,
          port: int, host: str, no_browser: bool, reload: bool) -> None:
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
        respondents_path=respondents_path,
        port=port,
        host=host,
        open_browser=not no_browser,
        reload=reload,
    )


@main.command()
@click.argument("questionnaire", type=click.Path(exists=True))
@click.option("--port", default=8000, show_default=True)
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--no-browser", is_flag=True, default=False)
def preview(questionnaire: str, port: int, host: str, no_browser: bool) -> None:
    """Render a FHIR Questionnaire JSON in read-only preview mode.

    Inputs are disabled and submissions are rejected — for visual review of
    an instrument before deploying it to respondents.
    """
    from .serve import run
    run(
        questionnaire_path=questionnaire,
        port=port,
        host=host,
        open_browser=not no_browser,
        preview=True,
    )

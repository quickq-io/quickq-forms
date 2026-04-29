from __future__ import annotations
import click
import uvicorn

from server.adapters.file import FileAdapter
from server.main import create_app


@click.group()
def main() -> None:
    """quickq-forms — FHIR questionnaire delivery server."""


@main.command()
@click.argument("questionnaire", type=click.Path(exists=True))
@click.option("--output-dir", default="responses", show_default=True,
              help="Directory to write QuestionnaireResponse JSON files.")
@click.option("--port", default=8000, show_default=True)
@click.option("--host", default="127.0.0.1", show_default=True)
@click.option("--reload", is_flag=True, default=False)
def serve(questionnaire: str, output_dir: str, port: int, host: str, reload: bool) -> None:
    """Serve a FHIR Questionnaire JSON file and collect responses."""
    adapter = FileAdapter(output_dir=output_dir, questionnaire_path=questionnaire)
    app = create_app(adapter)
    uvicorn.run(app, host=host, port=port, reload=reload)

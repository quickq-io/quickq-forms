from __future__ import annotations
import json
import uuid
from pathlib import Path

from .base import ResponseAdapter
from quickq_forms.models import QuestionnaireResponsePayload


class FileAdapter(ResponseAdapter):
    """
    Writes each QuestionnaireResponse as a JSON file in output_dir.
    Reads the Questionnaire from a JSON file at questionnaire_path.
    No quickq dependency — works standalone.
    """

    def __init__(self, output_dir: str | Path, questionnaire_path: str | Path) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._questionnaire_path = Path(questionnaire_path)

    def save(self, response: QuestionnaireResponsePayload) -> str:
        session_id = str(uuid.uuid4())
        out_path = self.output_dir / f"{session_id}.QuestionnaireResponse.json"
        out_path.write_text(
            json.dumps(response.model_dump(exclude_none=True), indent=2),
            encoding="utf-8",
        )
        return session_id

    def load_questionnaire(self) -> dict:
        with self._questionnaire_path.open(encoding="utf-8") as f:
            return json.load(f)

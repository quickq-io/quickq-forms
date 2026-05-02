from __future__ import annotations

from .base import ResponseAdapter
from server.models import QuestionnaireResponsePayload


class LocalAdapter(ResponseAdapter):
    """
    Writes responses to a quickq study.db via the quickq Python SDK.
    Requires quickq to be installed (quickq-forms[local]).
    """

    def __init__(self, db_path: str, questionnaire_id: int = 1) -> None:
        try:
            import quickq.schema as _schema
            import quickq.parser_fhir_response as _parser
            import quickq.renderer_fhir as _renderer_fhir
        except ImportError as e:
            raise ImportError(
                "quickq is not installed. Install with: pip install quickq-forms[local]"
            ) from e

        self._schema = _schema
        self._parser = _parser
        self._renderer_fhir = _renderer_fhir
        self._db_path = db_path
        self._questionnaire_id = questionnaire_id

    def save(self, response: QuestionnaireResponsePayload) -> str:
        conn = self._schema.open_oltp(self._db_path)
        session_id = self._parser.import_fhir_response(
            conn, response.model_dump(exclude_none=True)
        )
        conn.close()
        return str(session_id)

    def load_questionnaire(self) -> dict:
        conn = self._schema.open_oltp(self._db_path)
        questionnaire = self._renderer_fhir.export_fhir(conn, self._questionnaire_id)
        conn.close()
        return questionnaire

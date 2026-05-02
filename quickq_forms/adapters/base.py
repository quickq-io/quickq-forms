from abc import ABC, abstractmethod
from quickq_forms.models import QuestionnaireResponsePayload


class ResponseAdapter(ABC):
    @abstractmethod
    def save(self, response: QuestionnaireResponsePayload) -> str:
        """Persist a validated QuestionnaireResponse. Returns a session identifier."""

    @abstractmethod
    def load_questionnaire(self) -> dict:
        """Return the FHIR Questionnaire dict to serve to the frontend."""

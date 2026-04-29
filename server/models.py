from __future__ import annotations
from typing import Literal, Any
from pydantic import BaseModel, Field


class AnswerValue(BaseModel):
    valueString: str | None = None
    valueDecimal: float | None = None
    valueInteger: int | None = None
    valueBoolean: bool | None = None
    valueDate: str | None = None
    valueDateTime: str | None = None
    valueCoding: dict[str, str | None] | None = None
    extension: list[dict[str, Any]] | None = None


class ResponseItem(BaseModel):
    linkId: str
    text: str | None = None
    answer: list[AnswerValue] = Field(default_factory=list)
    item: list[ResponseItem] = Field(default_factory=list)


ResponseItem.model_rebuild()


class QuestionnaireResponsePayload(BaseModel):
    resourceType: Literal["QuestionnaireResponse"]
    questionnaire: str | None = None
    status: Literal["completed", "in-progress", "amended", "stopped"]
    authored: str | None = None
    item: list[ResponseItem] = Field(default_factory=list)

from __future__ import annotations
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from quickq_forms.adapters.base import ResponseAdapter
from quickq_forms.models import QuestionnaireResponsePayload

_adapter: ResponseAdapter | None = None
_questionnaire: dict | None = None   # cached at startup; one load per server process


def create_app(adapter: ResponseAdapter) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        global _adapter, _questionnaire
        _adapter = adapter
        _questionnaire = adapter.load_questionnaire()
        yield

    app = FastAPI(title="quickq-forms", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.get("/questionnaire")
    def get_questionnaire() -> dict:
        if _questionnaire is None:
            raise HTTPException(status_code=503, detail="Questionnaire not loaded")
        return _questionnaire

    @app.post("/response", status_code=201)
    def post_response(payload: QuestionnaireResponsePayload) -> dict:
        if _adapter is None or _questionnaire is None:
            raise HTTPException(status_code=503, detail="Adapter not initialised")

        expected_url = _questionnaire.get("url")
        if expected_url and payload.questionnaire and payload.questionnaire != expected_url:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"questionnaire URL mismatch: "
                    f"expected {expected_url!r}, got {payload.questionnaire!r}"
                ),
            )

        session_id = _adapter.save(payload)
        return {"session_id": session_id}

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app

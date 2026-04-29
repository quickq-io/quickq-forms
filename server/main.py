from __future__ import annotations
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from server.adapters.base import ResponseAdapter
from server.models import QuestionnaireResponsePayload

# The adapter is injected at startup — the app has no adapter-specific logic.
_adapter: ResponseAdapter | None = None


def create_app(adapter: ResponseAdapter) -> FastAPI:
    global _adapter

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        global _adapter
        _adapter = adapter
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
        if _adapter is None:
            raise HTTPException(status_code=503, detail="Adapter not initialised")
        return _adapter.load_questionnaire()

    @app.post("/response", status_code=201)
    def post_response(payload: QuestionnaireResponsePayload) -> dict:
        if _adapter is None:
            raise HTTPException(status_code=503, detail="Adapter not initialised")
        session_id = _adapter.save(payload)
        return {"session_id": session_id}

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app

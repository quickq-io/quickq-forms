from __future__ import annotations
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from quickq_forms.adapters.base import ResponseAdapter
from quickq_forms.drafts import DraftStore, is_valid_respondent_id
from quickq_forms.models import QuestionnaireResponsePayload

_adapter: ResponseAdapter | None = None
_questionnaire: dict | None = None   # cached at startup; one load per server process

# Production frontend build. Looked up at app construction time; if absent
# (e.g. fresh checkout with no `npm run build`), the JSON API still works,
# the user just gets a 404 on /. The dev flow uses Vite at :5173 with a proxy
# back to this server, so /assets/ static serving isn't needed there.
_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def create_app(
    adapter: ResponseAdapter,
    *,
    preview: bool = False,
    drafts_dir: str | Path | None = None,
    roster: set[str] | None = None,
) -> FastAPI:
    # Drafts are optional — in preview mode, or when the caller explicitly
    # passes drafts_dir=None, the /draft endpoints return 404 and the
    # frontend treats resume as unsupported. In normal serve mode, a sibling
    # `drafts/` directory next to the questionnaire output keeps drafts
    # local to the deployment.
    drafts: DraftStore | None = None
    if drafts_dir is not None and not preview:
        drafts = DraftStore(drafts_dir)

    # Roster: when provided, every action (response, draft) must carry a
    # respondent ID present in this set. When None, the server runs in
    # anonymous mode (any well-formed ID is accepted, no ID also accepted).
    def _check_roster(respondent_id: str | None) -> bool:
        if roster is None:
            return True
        return respondent_id is not None and respondent_id in roster

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
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["*"],
    )

    @app.get("/questionnaire")
    def get_questionnaire() -> dict:
        if _questionnaire is None:
            raise HTTPException(status_code=503, detail="Questionnaire not loaded")
        return _questionnaire

    @app.get("/config")
    def get_config(r: str | None = Query(None)) -> dict:
        # When a respondent ID is supplied, the response also reports whether
        # the roster accepts it — the frontend uses this to gate the form
        # before the respondent invests time filling answers that will be
        # rejected at submission time.
        cfg: dict = {
            "preview": preview,
            "drafts_enabled": drafts is not None,
            "roster_enforced": roster is not None,
        }
        if roster is not None:
            cfg["respondent_valid"] = r is not None and _check_roster(r)
        return cfg

    @app.post("/response", status_code=201)
    def post_response(payload: QuestionnaireResponsePayload) -> dict:
        if preview:
            raise HTTPException(
                status_code=403,
                detail="Preview mode: responses are not accepted.",
            )
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

        # Roster enforcement (defense in depth — the frontend gate already
        # blocks invalid IDs, but a curl-wielding adversary should also bounce).
        rid_for_check: str | None = None
        if payload.subject and payload.subject.reference:
            rid_for_check = _respondent_id_from_subject(payload.subject.reference)
        if not _check_roster(rid_for_check):
            raise HTTPException(
                status_code=403,
                detail="Respondent is not on the roster for this study.",
            )

        session_id = _adapter.save(payload)

        # Final submission supersedes any in-flight draft for this respondent.
        if drafts is not None and rid_for_check and is_valid_respondent_id(rid_for_check):
            drafts.delete(rid_for_check)

        return {"session_id": session_id}

    def _gate_draft_request(r: str) -> None:
        if drafts is None:
            raise HTTPException(status_code=404, detail="Drafts not enabled")
        if not is_valid_respondent_id(r):
            raise HTTPException(status_code=400, detail="Invalid respondent ID")
        if not _check_roster(r):
            raise HTTPException(
                status_code=403,
                detail="Respondent is not on the roster for this study.",
            )

    @app.get("/draft")
    def get_draft(r: str = Query(..., description="Respondent ID")) -> dict:
        _gate_draft_request(r)
        assert drafts is not None  # narrowed by _gate_draft_request
        payload = drafts.load(r)
        if payload is None:
            raise HTTPException(status_code=404, detail="No draft for this respondent")
        return payload

    @app.post("/draft", status_code=204)
    def save_draft(
        r: str = Query(..., description="Respondent ID"),
        payload: dict = Body(...),
    ) -> None:
        _gate_draft_request(r)
        assert drafts is not None
        drafts.save(r, payload)

    @app.delete("/draft", status_code=204)
    def delete_draft(r: str = Query(...)) -> None:
        _gate_draft_request(r)
        assert drafts is not None
        drafts.delete(r)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    def _respondent_id_from_subject(reference: str) -> str | None:
        """Extract the respondent ID from a FHIR subject.reference.

        Matches quickq.parser_fhir_response._external_id_from_ref:
        'Patient/R042' → 'R042', 'R042' → 'R042'.
        """
        if "/" in reference:
            return reference.split("/", 1)[1]
        return reference

    if _FRONTEND_DIST.is_dir():
        # Mount /assets first so it takes priority over the SPA index route.
        assets_dir = _FRONTEND_DIST / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        index_html = _FRONTEND_DIST / "index.html"

        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(index_html)

    return app

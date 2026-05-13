"""
Server-side draft storage for resume support.

Drafts are NOT FHIR — they're a small JSON dump of the frontend's store state
(answers map + repeating-group instance counts) keyed by respondent ID. They
exist only so a respondent can close their browser tab and pick up where they
left off; once the respondent submits, the draft is deleted and the canonical
FHIR QuestionnaireResponse is what persists.

A separate format (vs storing partial FHIR) keeps deserialization simple: the
frontend just calls JSON.parse and rehydrates the store directly, no inverse
serializer needed.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

# Whitelist for respondent IDs we'll accept as filename components. Pilots
# typically use short codes (R001, P-042, AB123) — keep it narrow and reject
# anything else with a 400 rather than risk path traversal. The same regex
# is enforced on /draft endpoints below.
_RESPONDENT_ID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")


def is_valid_respondent_id(respondent_id: str) -> bool:
    return bool(_RESPONDENT_ID_RE.match(respondent_id))


class DraftStore:
    """
    File-backed key-value store keyed on respondent ID.

    One DraftStore instance per server. Threadsafe enough for a pilot: each
    POST replaces the file atomically (write tmp, rename); concurrent saves
    from two tabs are last-writer-wins, which is acceptable for the use case.
    """

    def __init__(self, base_dir: str | Path) -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, respondent_id: str) -> Path:
        if not is_valid_respondent_id(respondent_id):
            raise ValueError(f"invalid respondent id: {respondent_id!r}")
        return self.base_dir / f"{respondent_id}.draft.json"

    def save(self, respondent_id: str, payload: dict[str, Any]) -> None:
        path = self._path(respondent_id)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(path)

    def load(self, respondent_id: str) -> dict[str, Any] | None:
        path = self._path(respondent_id)
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def delete(self, respondent_id: str) -> None:
        try:
            self._path(respondent_id).unlink()
        except FileNotFoundError:
            pass

from __future__ import annotations
from typing import Literal
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    adapter: Literal["local", "file"] = "file"
    db_path: str | None = None           # required for local adapter
    output_dir: str | None = None        # required for file adapter; defaults to cwd
    questionnaire_path: str | None = None  # path to a Questionnaire JSON file (file/local adapter)
    questionnaire_id: int = 1
    port: int = 5173
    host: str = "127.0.0.1"
    open_browser: bool = True

    model_config = {"env_prefix": "QUICKQ_FORMS_"}


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings

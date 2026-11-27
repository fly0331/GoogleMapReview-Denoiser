from datetime import datetime, timezone
import os
from pathlib import Path
from tempfile import gettempdir
import pytest

os.environ["DATABASE_PATH"] = str(Path(gettempdir()) / "review-denoiser-pytest-import.sqlite3")
from app import main
from app.cache import SQLiteCache
from app.services import llm_absa
from app.services.gemini_limits import GeminiLimits


@pytest.fixture(autouse=True)
def isolate_gemini_quota(tmp_path, monkeypatch):
    monkeypatch.setattr(llm_absa, "gemini_limits", GeminiLimits(tmp_path / "quota.sqlite3", 100, 2))

@pytest.fixture
def cache_path(tmp_path):
    return tmp_path / "test-cache.sqlite3"

@pytest.fixture
def client(cache_path, monkeypatch):
    main.cache = SQLiteCache(cache_path)
    monkeypatch.setenv("MOCK_LLM", "true")
    return main.app

@pytest.fixture
def scraped_at():
    return datetime(2026, 11, 25, tzinfo=timezone.utc)

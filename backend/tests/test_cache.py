
import json
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest

from app import main
from app.cache import SQLiteCache, create_fingerprint
from app.core.schemas import AnalyzeRequest, LLMABSAOutput
from app.services.gemini_limits import GeminiLimits, GeminiQuotaExceededError


def test_fingerprint_is_stable_for_same_payload():
    first = {"place_id": "p1", "reviews": [{"rating": 5, "text": "good"}]}
    second = {"reviews": [{"text": "good", "rating": 5}], "place_id": "p1"}

    assert create_fingerprint(first) == create_fingerprint(second)


def test_fingerprint_changes_when_payload_changes():
    first = {"place_id": "p1", "reviews": [{"rating": 5, "text": "good"}]}
    second = {"place_id": "p1", "reviews": [{"rating": 1, "text": "bad"}]}

    assert create_fingerprint(first) != create_fingerprint(second)


def test_cache_requires_matching_fingerprint(cache_path):
    cache = SQLiteCache(cache_path)
    response = {"analyzed_count": 3}
    cache.set("p1", "fingerprint-a", response)

    assert cache.get("p1", "fingerprint-a") == response
    assert cache.get("p1", "fingerprint-b") is None


def test_cache_expires_after_ttl(cache_path, monkeypatch):
    cache = SQLiteCache(cache_path, ttl_seconds=60)
    monkeypatch.setattr("app.cache.time.time", lambda: 1000)

    cache.set("p1", "fingerprint-a", {"analyzed_count": 3})

    monkeypatch.setattr("app.cache.time.time", lambda: 1061)

    assert cache.get("p1", "fingerprint-a") is None


def test_legacy_cache_entry_is_treated_as_miss(cache_path):
    cache = SQLiteCache(cache_path)

    with cache._connect() as connection:
        connection.execute(
            """
            INSERT INTO cache(place_id, value, cached_at)
            VALUES (?, ?, ?)
            """,
            ("p1", json.dumps({"analyzed_count": 3}), time.time()),
        )

    assert cache.get("p1", "fingerprint-a") is None


def test_corrupted_json_is_treated_as_miss(cache_path):
    cache = SQLiteCache(cache_path)

    with cache._connect() as connection:
        connection.execute(
            """
            INSERT INTO cache(place_id, value, cached_at)
            VALUES (?, ?, ?)
            """,
            ("p1", "{invalid-json",  time.time()),
        )

    assert cache.get("p1", "fingerprint-a") is None

    with cache._connect() as connection:
        row = connection.execute(
            "SELECT place_id FROM cache WHERE place_id = ?",
            ("p1",),
        ).fetchone()

    assert row is None


def test_cache_overwrites_previous_fingerprint(cache_path):
    cache = SQLiteCache(cache_path)

    cache.set("p1", "fingerprint-a", {"analyzed_count": 3})
    cache.set("p1", "fingerprint-b", {"analyzed_count": 5})

    assert cache.get("p1", "fingerprint-a") is None
    assert cache.get("p1", "fingerprint-b") == {"analyzed_count": 5}

def test_cache_uses_wal_mode(cache_path):
    cache = SQLiteCache(cache_path)

    with cache._connect() as connection:
        mode = connection.execute(
            "PRAGMA journal_mode"
        ).fetchone()[0]

    assert mode.lower() == "wal"


def test_cache_uses_busy_timeout(cache_path):
    cache = SQLiteCache(cache_path)

    with cache._connect() as connection:
        timeout = connection.execute(
            "PRAGMA busy_timeout"
        ).fetchone()[0]

    assert timeout == 5000


def test_cache_cleans_expired_entries_on_initialization(cache_path):
    cache = SQLiteCache(cache_path, ttl_seconds=60)

    with cache._connect() as connection:
        connection.execute(
            """
            INSERT INTO cache(place_id, value, cached_at)
            VALUES (?, ?, ?)
            """,
            ("expired", "{}", time.time() - 120),
        )

    SQLiteCache(cache_path, ttl_seconds=60)

    with cache._connect() as connection:
        row = connection.execute(
            "SELECT place_id FROM cache WHERE place_id = ?",
            ("expired",),
        ).fetchone()

    assert row is None

@pytest.mark.parametrize("legacy_version", [2, 3])
def test_old_envelopes_miss_and_v4_envelope_can_be_read(cache_path, legacy_version):
    cache = SQLiteCache(cache_path)
    legacy = {
        "format_version": legacy_version,
        "fingerprint": "fingerprint-a",
        "response": {"decision_summary": "old", "decision_insights": []},
    }
    with cache._connect() as connection:
        connection.execute(
            "INSERT INTO cache (place_id, value, cached_at) VALUES (?, ?, ?)",
            ("p1", json.dumps(legacy), time.time()),
        )

    assert cache.get("p1", "fingerprint-a") is None

    response = {"decision_pros": "new", "decision_cons": "", "practical_visit_information": []}
    cache.set("p1", "fingerprint-a", response)
    assert cache.get("p1", "fingerprint-a") == response

    with cache._connect() as connection:
        row = connection.execute("SELECT value FROM cache WHERE place_id = ?", ("p1",)).fetchone()
    assert json.loads(row[0])["format_version"] == 4


@pytest.mark.parametrize("old", ["malformed", "expired", "invalid-response"])
def test_conditional_eviction_leaves_a_concurrent_new_write(cache_path, monkeypatch, old):
    cache = SQLiteCache(cache_path, ttl_seconds=60)
    with cache._connect() as connection:
        connection.execute("INSERT INTO cache(place_id, value, cached_at) VALUES (?, ?, ?)", (
            "p1", "{invalid" if old == "malformed" else json.dumps({
                "format_version": 4, "fingerprint": "old", "response": {},
            }), time.time() - (120 if old == "expired" else 0),
        ))

    ready, resume = Event(), Event()
    delete = cache._delete_if_unchanged

    def pause_before_delete(*args):
        ready.set()
        assert resume.wait(5)
        delete(*args)

    def read_invalid():
        entry = cache.get_entry("p1", "old")
        if old == "invalid-response":
            assert entry is not None and entry.response == {}
            cache.delete_entry(entry)
        else:
            assert entry is None

    monkeypatch.setattr(cache, "_delete_if_unchanged", pause_before_delete)
    with ThreadPoolExecutor(max_workers=1) as pool:
        stale_reader = pool.submit(read_invalid)
        try:
            assert ready.wait(5)
            cache.set("p1", "new", {"analyzed_count": 7})
        finally:
            resume.set()
        stale_reader.result(timeout=5)

    assert cache.get("p1", "old") is None
    assert cache.get("p1", "new") == {"analyzed_count": 7}


def test_write_and_startup_cleanup_delete_only_expired_cache_rows_and_keep_quota(cache_path, monkeypatch):
    cache = SQLiteCache(cache_path)
    quota = GeminiLimits(cache_path, daily_calls=1, concurrent_calls=1)
    monkeypatch.setattr("app.services.gemini_limits.utc_day", lambda: "2025-01-01")
    with quota.reserve():
        pass

    start = 1_000_000
    monkeypatch.setattr("app.cache.time.time", lambda: start)
    cache.set("expired-by-write", "a", {})
    monkeypatch.setattr("app.cache.time.time", lambda: start + cache.ttl_seconds)
    cache.set("expired-by-startup", "b", {})
    cache.set("current", "c", {"analyzed_count": 2})
    with cache._connect() as connection:
        places = {row[0] for row in connection.execute("SELECT place_id FROM cache")}
        assert places == {"expired-by-startup", "current"}
        connection.execute("UPDATE cache SET cached_at = ? WHERE place_id = ?", (start, "expired-by-startup"))

    SQLiteCache(cache_path)
    with cache._connect() as connection:
        places = {row[0] for row in connection.execute("SELECT place_id FROM cache")}
        assert places == {"current"}
    with pytest.raises(GeminiQuotaExceededError), quota.reserve():
        pytest.fail("Cache cleanup must not reset the daily quota")


def test_analyze_caches_derived_result_without_raw_input_fields(client, monkeypatch):
    monkeypatch.setattr(main, "analyze_reviews", lambda reviews, **settings: LLMABSAOutput(
        decision_pros="Synthetic summary", decision_cons="",
    ))
    request = AnalyzeRequest.model_validate({
        "place_id": "test-place", "scraped_at": "2025-01-01T00:00:00Z",
        "reviews": [{"review_id": "test-review", "rating": 5, "text": "Synthetic raw review"}],
    })
    main.analyze(request)
    with main.cache._connect() as connection:
        serialized, = connection.execute("SELECT value FROM cache WHERE place_id = ?", (request.place_id,)).fetchone()

    assert "Synthetic raw review" not in serialized
    assert "test-review" not in serialized
    row = json.loads(serialized)
    assert set(row) == {"format_version", "fingerprint", "analysis_key", "write_id", "response"}
    assert row["response"]["decision_pros"] == "Synthetic summary"
    assert row["response"]["analyzed_count"] == 1

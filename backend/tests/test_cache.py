
import json
import time

import pytest

from app.cache import SQLiteCache, create_fingerprint


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

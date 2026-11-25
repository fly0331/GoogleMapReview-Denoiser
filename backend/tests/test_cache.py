
import json
import time

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

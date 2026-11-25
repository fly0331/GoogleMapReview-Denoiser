
from app.rate_limit import InMemoryRateLimiter
from app.core.schemas import LLMABSAOutput


def test_allows_requests_within_limit():
    limiter = InMemoryRateLimiter(max_requests=3, window_seconds=60)

    assert limiter.is_allowed("client-1") is True
    assert limiter.is_allowed("client-1") is True
    assert limiter.is_allowed("client-1") is True
    assert limiter.is_allowed("client-1") is False


def test_clients_have_independent_limits():
    limiter = InMemoryRateLimiter(max_requests=1, window_seconds=60)

    assert limiter.is_allowed("client-1") is True
    assert limiter.is_allowed("client-1") is False
    assert limiter.is_allowed("client-2") is True


def test_expired_requests_are_removed(monkeypatch):
    import app.rate_limit as rate_limit

    current_time = [100.0]
    monkeypatch.setattr(
        rate_limit.time,
        "monotonic",
        lambda: current_time[0],
    )

    limiter = InMemoryRateLimiter(max_requests=1, window_seconds=60)

    assert limiter.is_allowed("client-1") is True
    assert limiter.is_allowed("client-1") is False

    current_time[0] = 161.0

    assert limiter.is_allowed("client-1") is True



from fastapi.testclient import TestClient
from app import main


def test_analyze_endpoint_returns_429_when_limit_exceeded(
    monkeypatch,
    tmp_path,
):
    main.cache = main.SQLiteCache(tmp_path / "rate-limit.sqlite3")
    main.rate_limiter = main.InMemoryRateLimiter(
        max_requests=1,
        window_seconds=60,
    )

    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews: LLMABSAOutput(),
    )

    client = TestClient(main.app)

    payload = {
        "place_id": "rate-limit-test",
        "scraped_at": "2026-11-25T00:00:00Z",
        "reviews": [],
    }

    first = client.post("/api/v1/analyze", json=payload)
    second = client.post("/api/v1/analyze", json=payload)

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["detail"]["code"] == "RATE_LIMIT_EXCEEDED"

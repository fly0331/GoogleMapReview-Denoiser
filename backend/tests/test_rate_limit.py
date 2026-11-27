
import asyncio
from concurrent.futures import ThreadPoolExecutor

import pytest
from app.rate_limit import InMemoryRateLimiter
from app.core.schemas import LLMABSAOutput
from app import serve
from app.serve import trusted_proxies
from starlette.requests import Request
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

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
    monkeypatch.setattr(main, "rate_limiter", main.InMemoryRateLimiter(
        max_requests=1,
        window_seconds=60,
    ))

    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews, **settings: LLMABSAOutput(decision_pros="", decision_cons=""),
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
    assert 1 <= int(second.headers["Retry-After"]) <= 60

def test_get_client_ip_ignores_client_supplied_forwarding_headers():
    request = Request({
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [
            (b"cf-connecting-ip", b"203.0.113.10"),
            (b"x-forwarded-for", b"203.0.113.11"),
        ],
        "client": ("10.0.0.1", 1234),
    })

    assert main.get_client_ip(request) == "10.0.0.1"


def test_get_client_ip_falls_back_when_header_is_invalid():
    request = Request({
        "type": "http",
        "method": "POST",
        "path": "/",
        "headers": [
            (b"cf-connecting-ip", b"invalid-ip"),
        ],
        "client": ("10.0.0.1", 1234),
    })

    assert main.get_client_ip(request) == "10.0.0.1"
    
def test_expired_client_entries_are_cleaned_up():
    limiter = type(main.rate_limiter)(
        max_requests=10,
        window_seconds=0,
    )

    for i in range(99):
        limiter.is_allowed(f"client-{i}")

    assert len(limiter.requests) == 99

    limiter.is_allowed("trigger-cleanup")

    assert list(limiter.requests.keys()) == ["trigger-cleanup"]


@pytest.mark.parametrize("proxy_setting, expected", [
    ("", "10.0.0.1"),
    ("10.0.0.2", "10.0.0.1"),
    ("10.0.0.0/24", "203.0.113.10"),
])
def test_uvicorn_only_resolves_forwarded_ip_from_a_configured_peer(proxy_setting, expected):
    async def app(scope, receive, send):
        assert main.get_client_ip(Request(scope)) == expected

    scope = {
        "type": "http", "client": ("10.0.0.1", 1234),
        "headers": [(b"x-forwarded-for", b"203.0.113.99, 203.0.113.10, 10.0.0.3"),
                    (b"cf-connecting-ip", b"203.0.113.12")],
    }
    middleware = ProxyHeadersMiddleware(app, trusted_hosts=trusted_proxies(proxy_setting))
    asyncio.run(middleware(scope, None, None))


@pytest.mark.parametrize("value", ["*", "0.0.0.0/0", "::/0"])
def test_unrestricted_proxy_settings_are_rejected(value):
    with pytest.raises(ValueError, match="FORWARDED_ALLOW_IPS"):
        trusted_proxies(value)


@pytest.mark.parametrize("value, expected", [("", []), ("10.0.0.4, 10.0.1.0/24", ["10.0.0.4", "10.0.1.0/24"])])
def test_launcher_requires_explicit_proxy_trust_and_pins_one_worker(monkeypatch, value, expected):
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", value)
    monkeypatch.setenv("WEB_CONCURRENCY", "5")

    def run(app, **kwargs):
        assert app == "app.main:app"
        assert kwargs["proxy_headers"] is bool(expected)
        assert kwargs["forwarded_allow_ips"] == expected
        assert kwargs["workers"] == 1

    monkeypatch.setattr(serve.uvicorn, "run", run)
    serve.main()


def test_parallel_limit_and_bounded_client_entries():
    limiter = InMemoryRateLimiter(max_requests=5, max_clients=2)
    with ThreadPoolExecutor(max_workers=8) as pool:
        decisions = list(pool.map(limiter.is_allowed, ["first"] * 32))
    assert sum(decisions) == 5
    assert limiter.is_allowed("second")
    assert not limiter.is_allowed("third")
    assert len(limiter.requests) == 2

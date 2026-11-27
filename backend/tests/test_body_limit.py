import asyncio
import json
from runpy import run_path

import httpx

from app import main


def test_analyze_checks_real_body_bytes_before_parsing(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "body.sqlite3"))
    monkeypatch.setenv("MOCK_LLM", "true")
    monkeypatch.setenv("RATE_LIMIT_REQUESTS", "20")
    payload = json.dumps({
        "place_id": "body-test", "scraped_at": "2026-11-25T00:00:00Z",
        "reviews": [{"review_id": "r1", "rating": 4, "text": "正常評論"}],
    }, ensure_ascii=False).encode()
    monkeypatch.setenv("MAX_REQUEST_BODY_BYTES", str(len(payload)))
    app = run_path(main.__file__)["app"]

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            async def stream(*chunks):
                for chunk in chunks:
                    yield chunk

            url = "/api/v1/analyze"
            json_headers = {"content-type": "application/json"}
            normal = await client.post(url, content=payload, headers=json_headers)
            assert normal.status_code == 200
            assert normal.json()["analyzed_count"] == 1

            chunked = await client.post(url, content=stream(payload[:43], payload[43:]), headers=json_headers)
            assert "content-length" not in chunked.request.headers
            assert chunked.status_code == 200

            for response in (
                await client.post(url, content=payload + b"x", headers=json_headers),
                await client.post(url, content=stream(payload[:43], payload[43:], b"x"), headers=json_headers),
                await client.post(url, content=stream(payload, b"x"), headers={**json_headers, "content-length": "1"}),
            ):
                assert response.status_code == 413
                assert response.json()["detail"]["code"] == "REQUEST_BODY_TOO_LARGE"

            assert (await client.get("/health")).json() == {"status": "ok"}

    asyncio.run(exercise())

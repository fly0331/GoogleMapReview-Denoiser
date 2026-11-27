from runpy import run_path

from fastapi.testclient import TestClient

from app import main


def preflight(client: TestClient, origin: str):
    return client.options(
        "/api/v1/analyze",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


def test_cors_allows_only_configured_origins(monkeypatch, tmp_path):
    extension_origin = "chrome-extension://" + "a" * 32
    other_extension_origin = "chrome-extension://" + "b" * 32
    web_origin = "https://app.example.test"
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "cors.sqlite3"))
    monkeypatch.setenv("CORS_ORIGINS", f" {extension_origin}, {web_origin} ")

    app = run_path(main.__file__)["app"]
    with TestClient(app) as client:
        for origin in (extension_origin, web_origin):
            response = preflight(client, origin)
            assert response.status_code == 200
            assert response.headers["Access-Control-Allow-Origin"] == origin

        for origin in (other_extension_origin, web_origin + ".invalid"):
            response = preflight(client, origin)
            assert response.status_code == 400
            assert "Access-Control-Allow-Origin" not in response.headers


def test_cors_default_does_not_allow_arbitrary_origins(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "cors.sqlite3"))
    monkeypatch.delenv("CORS_ORIGINS", raising=False)

    app = run_path(main.__file__)["app"]
    with TestClient(app) as client:
        response = preflight(client, "chrome-extension://" + "a" * 32)
        assert response.status_code == 400
        assert "Access-Control-Allow-Origin" not in response.headers

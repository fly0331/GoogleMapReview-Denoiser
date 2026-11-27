import subprocess
import sys
import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import httpx
from fastapi.testclient import TestClient

from app.core.schemas import AnalyzeRequest
from app.services import gemini_limits, llm_absa
from app.services.gemini_limits import GeminiBusyError, GeminiLimits, GeminiQuotaExceededError


def test_atomic_daily_reservation_across_connections(tmp_path):
    path = tmp_path / "quota.sqlite3"
    guards = [GeminiLimits(path, daily_calls=5, concurrent_calls=8) for _ in range(2)]

    def take_call(index):
        try:
            with guards[index % len(guards)].reserve():
                return True
        except GeminiQuotaExceededError:
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(take_call, range(32))) == 5


def test_concurrent_slots_recover_and_busy_does_not_spend_quota(tmp_path):
    guard = GeminiLimits(tmp_path / "quota.sqlite3", daily_calls=2, concurrent_calls=1)

    def observe_busy():
        with pytest.raises(GeminiBusyError), guard.reserve():
            pytest.fail("A concurrent reservation unexpectedly succeeded")

    with ThreadPoolExecutor() as pool:
        with pytest.raises(TimeoutError), guard.reserve():
            pool.submit(observe_busy).result()
            raise TimeoutError
    with guard.reserve():
        pass
    with pytest.raises(GeminiQuotaExceededError), guard.reserve():
        pytest.fail("A third daily reservation unexpectedly succeeded")


def test_quota_persists_across_process_and_resets_on_utc_day_change(tmp_path, monkeypatch):
    path = tmp_path / "quota.sqlite3"
    guard = GeminiLimits(path, daily_calls=1, concurrent_calls=1)
    with guard.reserve():
        pass

    worker = subprocess.run([sys.executable, "-c", """
import sys
from app.services.gemini_limits import GeminiLimits, GeminiQuotaExceededError
try:
    with GeminiLimits(sys.argv[1], daily_calls=1, concurrent_calls=1).reserve():
        raise SystemExit(1)
except GeminiQuotaExceededError:
    pass
""", str(path)], capture_output=True, text=True, timeout=15)
    assert worker.returncode == 0, worker.stderr

    monkeypatch.setattr(gemini_limits, "utc_day", lambda: "9999-12-31")
    with guard.reserve():
        pass


def payload(place_id: str):
    return {"place_id": place_id, "scraped_at": "2026-11-25T00:00:00Z", "reviews": [
        {"review_id": "r1", "rating": 5, "text": "咖啡很好喝。"},
    ]}


def test_api_cache_hit_and_mock_mode_leave_gemini_quota_available(client, tmp_path, monkeypatch):
    from app import main

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(main, "rate_limiter", main.InMemoryRateLimiter(max_requests=10))
    monkeypatch.setattr(llm_absa, "gemini_limits", GeminiLimits(tmp_path / "quota.sqlite3", 1, 1))
    create = Mock(return_value=SimpleNamespace(output_text='{"decision_pros":"","decision_cons":""}'))
    monkeypatch.setattr(llm_absa.genai, "Client", lambda **_: SimpleNamespace(interactions=SimpleNamespace(create=create)))
    with TestClient(client) as http:
        assert http.post("/api/v1/analyze", json=payload("mock")).json()["analysis_mode"] == "mock"
        monkeypatch.setenv("MOCK_LLM", "false")
        first = http.post("/api/v1/analyze", json=payload("gemini"))
        assert first.status_code == 200
        assert http.post("/api/v1/analyze", json=payload("gemini")).json()["cache_hit"] is True
        response = http.post("/api/v1/analyze", json=payload("different"))
        assert response.status_code == 429
        assert response.json()["detail"]["code"] == "LLM_DAILY_QUOTA_EXCEEDED"
    assert create.call_count == 1


def test_provider_failure_releases_capacity_without_refunding(tmp_path, monkeypatch):
    guard = GeminiLimits(tmp_path / "quota.sqlite3", daily_calls=3, concurrent_calls=1)
    monkeypatch.setattr(llm_absa, "gemini_limits", guard)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    create = Mock(side_effect=[TimeoutError(), RuntimeError("provider unavailable")])
    monkeypatch.setattr(llm_absa.genai, "Client", lambda **_: SimpleNamespace(interactions=SimpleNamespace(create=create)))
    reviews = AnalyzeRequest.model_validate(payload("gemini")).reviews
    with guard.reserve():
        with pytest.raises(llm_absa.LLMAnalysisError) as busy:
            llm_absa._analyze_with_gemini(reviews)
        assert busy.value.code == "LLM_BUSY"
        assert busy.value.status_code == 503
    with pytest.raises(llm_absa.LLMTimeoutError):
        llm_absa._analyze_with_gemini(reviews)
    with pytest.raises(llm_absa.LLMServiceUnavailableError):
        llm_absa._analyze_with_gemini(reviews)
    with pytest.raises(llm_absa.LLMAnalysisError) as exhausted:
        llm_absa._analyze_with_gemini(reviews)
    assert exhausted.value.code == "LLM_DAILY_QUOTA_EXCEEDED"
    assert create.call_count == 2


def test_serialized_request_budget_includes_fixed_prompt_and_schema(tmp_path, monkeypatch):
    guard = GeminiLimits(tmp_path / "quota.sqlite3", daily_calls=1, concurrent_calls=1)
    monkeypatch.setattr(llm_absa, "gemini_limits", guard)
    monkeypatch.setattr(llm_absa, "MAX_GEMINI_REQUEST_BYTES", 32)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    create_client = Mock()
    monkeypatch.setattr(llm_absa.genai, "Client", create_client)
    with pytest.raises(llm_absa.LLMInputLimitError):
        llm_absa._analyze_with_gemini(AnalyzeRequest.model_validate(payload("gemini")).reviews)
    create_client.assert_not_called()
    with guard.reserve():
        pass


@pytest.mark.parametrize("provider_status", [503, 200])
def test_sdk_body_and_attempt_count_with_retry_and_continuation_disabled(provider_status, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        if provider_status == 503:
            return httpx.Response(503, json={"error": {"message": "Busy", "code": 503}})
        return httpx.Response(200, json={
            "id": "test", "status": "requires_continuation", "continuation_token": "test-continuation", "steps": [],
        })

    create_client = llm_absa.genai.Client
    with httpx.Client(transport=httpx.MockTransport(respond)) as transport:
        monkeypatch.setattr(llm_absa.genai, "Client", lambda api_key, http_options: create_client(
            api_key=api_key, http_options=http_options.model_copy(update={"httpx_client": transport}),
        ))
        expected = llm_absa.LLMServiceUnavailableError if provider_status == 503 else llm_absa.LLMInvalidResponseError
        with pytest.raises(expected):
            llm_absa._analyze_with_gemini(AnalyzeRequest.model_validate(payload("gemini")).reviews)

    assert len(requests) == 1
    assert requests[0]["generation_config"]["max_output_tokens"] == 4096
    assert "咖啡很好喝" in requests[0]["input"]
    assert "schema" in requests[0]["response_format"]

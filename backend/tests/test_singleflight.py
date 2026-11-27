import asyncio
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from app import main
from app.cache import create_fingerprint
from app.core.schemas import AnalyzeRequest, LLMABSAOutput
from app.services import llm_absa
from app.services.gemini_limits import GeminiLimits
from app.singleflight import SingleFlight, logger


def payload(text="咖啡很好喝。"):
    return {"place_id": "singleflight", "scraped_at": "2026-11-25T00:00:00Z", "reviews": [
        {"review_id": "review-1", "rating": 5, "text": text},
    ]}


def request_fingerprint(request):
    return create_fingerprint({
        "place_id": request.place_id,
        "reviews": [review.model_dump(mode="json") for review in request.reviews],
    })


@pytest.fixture
def service(client, tmp_path, monkeypatch):
    path = tmp_path / "singleflight-quota.sqlite3"
    monkeypatch.setattr(main, "singleflight", SingleFlight(wait_seconds=10))
    monkeypatch.setattr(main, "rate_limiter", main.InMemoryRateLimiter(max_requests=30))
    monkeypatch.setattr(llm_absa, "gemini_limits", GeminiLimits(path, daily_calls=3, concurrent_calls=1))
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("MOCK_LLM", "false")
    return path


def observe_followers(monkeypatch, count):
    ready = Event()
    events = []
    lock = Lock()

    def record(event):
        with lock:
            events.append(event)
            if events.count("singleflight_follower") == count:
                ready.set()

    monkeypatch.setattr(logger, "info", record)
    return ready, events


def controlled_provider(monkeypatch, started, release, *, fail=False):
    def call(**settings):
        started.set()
        assert release.wait(8), "test did not release model"
        if fail:
            raise TimeoutError
        return SimpleNamespace(output_text=json.dumps({"decision_pros": "fixture", "decision_cons": ""}))

    create = Mock(side_effect=call)
    monkeypatch.setattr(llm_absa.genai, "Client", lambda **_: SimpleNamespace(interactions=SimpleNamespace(create=create)))
    return create


def test_identical_misses_share_one_model_slot_quota_and_result(service, monkeypatch):
    started, release = Event(), Event()
    monkeypatch.setattr(main, "singleflight", SingleFlight(wait_seconds=10, max_followers=3))
    ready, events = observe_followers(monkeypatch, 3)
    create = controlled_provider(monkeypatch, started, release)
    request = AnalyzeRequest.model_validate(payload())
    with ThreadPoolExecutor(max_workers=4) as pool:
        try:
            leader = pool.submit(main.analyze, request)
            assert started.wait(5)
            followers = [pool.submit(main.analyze, request) for _ in range(3)]
            assert ready.wait(5)
            with pytest.raises(llm_absa.LLMAnalysisError) as busy:
                main.analyze(request)
            assert busy.value.code == "LLM_BUSY"
        finally:
            release.set()
        result = leader.result(timeout=5)
        assert [job.result(timeout=5) for job in followers] == [result] * 3

    assert result.cache_hit is False
    assert main.analyze(request).cache_hit is True
    with sqlite3.connect(service) as connection:
        assert connection.execute("SELECT SUM(calls) FROM gemini_daily_quota").fetchone() == (1,)
    create.assert_called_once()
    assert events.count("singleflight_leader") == 1
    assert events.count("cache_miss") == 5
    assert events.count("cache_hit") == 1
    assert not main.singleflight._entries
    assert main.singleflight._followers == 0


def test_leader_rechecks_cache_after_registration(service, monkeypatch):
    request = AnalyzeRequest.model_validate(payload())
    monkeypatch.setenv("MOCK_LLM", "true")
    run = main.singleflight.run

    def insert_before_registration(key, work):
        main.cache.set(request.place_id, request_fingerprint(request), {
            "analysis_mode": "mock", "analyzed_count": 1, "aspect_scores": {},
            "pros": [], "cons": [], "decision_pros": "cached", "decision_cons": "",
            "practical_visit_information": [],
        }, analysis_key=key)
        return run(key, work)

    monkeypatch.setattr(main.singleflight, "run", insert_before_registration)
    analyze = Mock(side_effect=AssertionError("model must not run on the second cache hit"))
    monkeypatch.setattr(main, "analyze_reviews", analyze)
    result = main.analyze(request)
    assert result.cache_hit is True
    assert result.decision_pros == "cached"
    analyze.assert_not_called()


@pytest.mark.parametrize("difference", ["reviews", "model", "mode", "prompt", "cache_format"])
def test_different_inputs_can_run_concurrently_without_crossing_results(service, monkeypatch, difference):
    first_entered, release = Event(), Event()
    calls = []
    monkeypatch.setenv("GEMINI_MODEL", "original-model")

    def analyze(reviews, *, mode, model):
        with lock:
            calls.append((reviews[0].text, mode, model))
            position = len(calls)
        if position == 1:
            first_entered.set()
            assert release.wait(8)
        return LLMABSAOutput(decision_pros=f"result-{position}", decision_cons="", model_id=model)

    lock = Lock()
    monkeypatch.setattr(main, "analyze_reviews", analyze)
    first_request = AnalyzeRequest.model_validate(payload())
    second_request = AnalyzeRequest.model_validate(payload("不同的評論。") if difference == "reviews" else payload())
    with ThreadPoolExecutor(max_workers=2) as pool:
        try:
            first = pool.submit(main.analyze, first_request)
            assert first_entered.wait(5)
            if difference == "model":
                monkeypatch.setenv("GEMINI_MODEL", "different-model")
            elif difference == "mode":
                monkeypatch.setenv("MOCK_LLM", "true")
            elif difference == "prompt":
                monkeypatch.setattr(main, "GEMINI_PROMPT_VERSION", "different-prompt")
            elif difference == "cache_format":
                monkeypatch.setattr(main, "CACHE_FORMAT_VERSION", 5)
            second = pool.submit(main.analyze, second_request).result(timeout=5)
        finally:
            release.set()
        assert first.result(timeout=5).decision_pros == "result-1"
    assert second.decision_pros == "result-2"
    assert len(calls) == 2
    # The first input wrote last. The second input must miss even under the same place ID.
    assert main.analyze(second_request).decision_pros == "result-3"


def test_leader_failure_returns_same_http_error_and_allows_a_fresh_attempt(service, monkeypatch, caplog):
    started, release = Event(), Event()
    ready, _ = observe_followers(monkeypatch, 2)
    failing = controlled_provider(monkeypatch, started, release, fail=True)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            tasks = [asyncio.create_task(client.post(main.ANALYZE_PATH, json=payload()))]
            try:
                assert await asyncio.to_thread(started.wait, 5)
                tasks += [asyncio.create_task(client.post(main.ANALYZE_PATH, json=payload())) for _ in range(2)]
                assert await asyncio.to_thread(ready.wait, 5)
            finally:
                release.set()
            responses = await asyncio.gather(*tasks)
            assert all(response.status_code == 504 for response in responses)
            assert all(response.json() == responses[0].json() for response in responses)
            assert responses[0].json()["detail"]["code"] == "LLM_TIMEOUT"
            assert not main.singleflight._entries
            recovered = controlled_provider(monkeypatch, started, release)
            response = await client.post(main.ANALYZE_PATH, json=payload())
            assert response.status_code == 200 and response.json()["cache_hit"] is False
            recovered.assert_called_once()

    asyncio.run(exercise())
    failing.assert_called_once()
    assert any(record.message == "singleflight_failure" and record.error_code == "LLM_TIMEOUT"
               for record in caplog.records)


def test_unidentified_legacy_gemini_result_is_a_cache_miss(service, monkeypatch):
    request = AnalyzeRequest.model_validate(payload())
    main.cache.set(request.place_id, request_fingerprint(request), {
        "analysis_mode": "gemini", "analyzed_count": 1, "aspect_scores": {},
        "pros": [], "cons": [], "decision_pros": "legacy", "decision_cons": "",
        "practical_visit_information": [],
    })
    model = Mock(return_value=LLMABSAOutput(decision_pros="fresh", decision_cons=""))
    monkeypatch.setattr(main, "analyze_reviews", model)
    assert main.analyze(request).decision_pros == "fresh"
    assert main.analyze(request).cache_hit is True
    model.assert_called_once()


@pytest.mark.parametrize("cancel_leader", [True, False])
def test_http_cancellation_preserves_shared_model_work(service, monkeypatch, cancel_leader):
    started, release = Event(), Event()
    ready, events = observe_followers(monkeypatch, 2)
    create = controlled_provider(monkeypatch, started, release)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            def post():
                return asyncio.create_task(client.post(main.ANALYZE_PATH, json=payload()))

            leader = post()
            try:
                assert await asyncio.to_thread(started.wait, 5)
                cancelled = leader if cancel_leader else post()
                if not cancel_leader:
                    await asyncio.wait_for(asyncio.to_thread(wait_for_first_follower.wait, 5), timeout=6)
                    assert wait_for_first_follower.is_set()
                cancelled.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await cancelled
                remaining = [post()] if not cancel_leader else [post(), post()]
                assert await asyncio.to_thread(ready.wait, 5)
                assert create.call_count == 1
            finally:
                release.set()
            if not cancel_leader:
                remaining.append(leader)
            responses = await asyncio.gather(*remaining)
            assert all(response.status_code == 200 and response.json()["cache_hit"] is False for response in responses)

    wait_for_first_follower = Event()
    record = logger.info

    def record_first(event):
        record(event)
        if event == "singleflight_follower":
            wait_for_first_follower.set()

    monkeypatch.setattr(logger, "info", record_first)
    asyncio.run(exercise())
    assert events.count("singleflight_leader") == 1
    create.assert_called_once()
    assert not main.singleflight._entries


def test_follower_timeout_and_registry_cap_leave_the_leader_running(service, monkeypatch):
    started, release = Event(), Event()
    create = controlled_provider(monkeypatch, started, release)
    monkeypatch.setattr(main, "singleflight", SingleFlight(wait_seconds=0, max_entries=1))
    request = AnalyzeRequest.model_validate(payload())
    with ThreadPoolExecutor() as pool:
        try:
            leader = pool.submit(main.analyze, request)
            assert started.wait(5)
            with pytest.raises(llm_absa.LLMAnalysisError) as timeout:
                main.analyze(request)
            assert timeout.value.code == "SINGLEFLIGHT_WAIT_TIMEOUT"
            with pytest.raises(llm_absa.LLMAnalysisError) as busy:
                main.analyze(AnalyzeRequest.model_validate(payload("other")))
            assert busy.value.code == "LLM_BUSY"
            assert not leader.done()
        finally:
            release.set()
        assert leader.result(timeout=5).cache_hit is False
    create.assert_called_once()
    assert not main.singleflight._entries

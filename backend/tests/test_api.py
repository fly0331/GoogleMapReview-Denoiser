import json
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi.testclient import TestClient

import app.main as main
from app.cache import CACHE_FORMAT_VERSION, create_fingerprint
from app.core.schemas import LLMABSAOutput
from app.services import llm_absa
import pytest
from pydantic import ValidationError


def payload():
    return {
        "place_id": "p1",
        "scraped_at": "2026-11-25T00:00:00Z",
        "reviews": [
            {
                "review_id": "r1",
                "rating": 5,
                "text": "服務很好",
                "relative_time": "1 week ago",
            },
            {
                "review_id": "r2",
                "rating": 5,
                "text": "五星送小菜",
                "relative_time": "1 week ago",
            },
        ],
    }


from app.main import analyze
from app.core.schemas import AnalyzeRequest


def test_analyze_contract_and_cache(client):
    request = payload()
    request["reviews"][0]["text"] = "店員服務親切。週六傍晚候位30分鐘"
    with TestClient(client) as http:
        first = http.post("/api/v1/analyze", json=request)
        assert first.status_code == 200
        body = first.json()

        second = http.post("/api/v1/analyze", json=request)
        assert second.status_code == 200
        cached = second.json()
    assert {
        "cache_hit",
        "analysis_mode",
        "model_id",
        "analyzed_count",
        "aspect_scores",
        "pros",
        "cons",
        "practical_visit_information",
    } <= body.keys()
    assert body["cache_hit"] is False
    assert body["model_id"] is None
    assert body["analyzed_count"] == 2
    assert body["practical_visit_information"] == [
        {"category": "wait_time", "summary": "週六傍晚候位30分鐘", "evidence_review_ids": ["r1"]},
    ]
    assert {"metrics", "timeline", "anomaly_alert", "suspicious_reasons_breakdown"}.isdisjoint(body)
    assert body["decision_pros"] == "店員服務親切。"
    assert body["decision_cons"] == ""
    assert "decision_summary" not in body
    assert "decision_insights" not in body
    assert cached == {**body, "cache_hit": True}


def test_changed_reviews_for_same_place_trigger_reanalysis(client):
    first_request = AnalyzeRequest.model_validate(payload())
    first_response = analyze(first_request)

    changed_payload = payload()
    changed_payload["reviews"].append(
        {
            "review_id": "r3",
            "rating": 4,
            "text": "環境舒適，服務很好",
            "relative_time": "2 days ago",
        }
    )
    second_request = AnalyzeRequest.model_validate(changed_payload)
    second_response = analyze(second_request)

    assert first_response.cache_hit is False
    assert second_response.cache_hit is False
    assert second_response.analyzed_count == 3


def test_same_request_still_uses_cache(client):
    request = AnalyzeRequest.model_validate(payload())

    first_response = analyze(request)
    second_response = analyze(request)

    assert first_response.cache_hit is False
    assert second_response.cache_hit is True


def test_analyzed_count_excludes_empty_review_text(monkeypatch):
    cache = Mock()
    cache.get_entry.return_value = None
    monkeypatch.setattr(main, "cache", cache)

    # Keep the LLM isolated from external providers.
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews, **settings: LLMABSAOutput(decision_pros="", decision_cons=""),
    )

    test_payload = payload()
    test_payload["reviews"].append(
        {
            "review_id": "r3",
            "rating": 4,
            "text": "   ",
            "relative_time": "1 week ago",
        }
    )

    request = AnalyzeRequest.model_validate(test_payload)
    response = main.analyze(request)

    # Both nonblank reviews qualify, including the incentive mention in r2.
    assert response.analyzed_count == 2


def test_invalid_cached_response_is_treated_as_cache_miss(monkeypatch):
    cache = Mock()

    # Simulate a cache entry that is a dict but does not
    # satisfy the AnalyzeResponse schema.
    from app.cache import CacheEntry

    invalid = CacheEntry("place", "{}", 1.0, {}, None)
    cache.get_entry.side_effect = [invalid, None]

    monkeypatch.setattr(main, "cache", cache)
    monkeypatch.setenv("MOCK_LLM", "true")

    # Isolate the test from external LLM providers.
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews, **settings: LLMABSAOutput(decision_pros="", decision_cons=""),
    )

    request = AnalyzeRequest.model_validate(payload())

    response = main.analyze(request)

    # Invalid cache should be deleted.
    cache.delete_entry.assert_called_once_with(invalid)

    # The request should be recomputed instead of raising
    # a Pydantic ValidationError.
    assert response.cache_hit is False
    assert response.analyzed_count == 2
    assert response.analysis_mode == "mock"

    # The newly computed response should be saved.
    cache.set.assert_called_once()

def test_analysis_mode_mock(monkeypatch):
    cache = Mock()
    cache.get_entry.return_value = None
    monkeypatch.setattr(main, "cache", cache)
    monkeypatch.setenv("MOCK_LLM", "true")
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews, **settings: LLMABSAOutput(decision_pros="", decision_cons=""),
    )

    request = AnalyzeRequest.model_validate(payload())
    response = main.analyze(request)

    assert response.analysis_mode == "mock"


def test_analysis_mode_gemini(monkeypatch):
    cache = Mock()
    cache.get_entry.return_value = None
    monkeypatch.setattr(main, "cache", cache)
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews, **settings: LLMABSAOutput(decision_pros="", decision_cons=""),
    )

    request = AnalyzeRequest.model_validate(payload())
    response = main.analyze(request)

    assert response.analysis_mode == "gemini"


def test_cache_hits_require_the_same_analysis_mode(client, monkeypatch):
    monkeypatch.setenv("MOCK_LLM", "true")

    request = AnalyzeRequest.model_validate(payload())

    first_response = main.analyze(request)
    assert first_response.analysis_mode == "mock"
    assert main.analyze(request).cache_hit is True

    # Change environment after the first analysis.
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setattr(main, "analyze_reviews", Mock(return_value=LLMABSAOutput(decision_pros="", decision_cons="")))

    second_response = main.analyze(request)

    assert second_response.cache_hit is False
    assert second_response.analysis_mode == "gemini"
    assert second_response.model_id is None


@pytest.mark.parametrize(
    ("response_metadata", "expected"),
    [
        ({"model": "provider-model-a"}, "provider-model-a"),
        ({}, "requested-model-a"),
        ({"model": None}, "requested-model-a"),
        ({"model": "  "}, "requested-model-a"),
    ],
)
def test_gemini_model_metadata_is_cached_with_the_result(client, monkeypatch, response_metadata, expected):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("GEMINI_MODEL", "requested-model-a")
    interaction = SimpleNamespace(
        output_text=json.dumps({
            "decision_pros": "服務親切。",
            "decision_cons": "",
            "practical_visit_information": [],
            "model_id": "untrusted-output-value",
        }),
        **response_metadata,
    )
    create = Mock(return_value=interaction)
    monkeypatch.setattr(llm_absa.genai, "Client", lambda **kwargs: SimpleNamespace(
        interactions=SimpleNamespace(create=create),
    ))

    request = AnalyzeRequest.model_validate(payload())
    first = main.analyze(request)
    second = main.analyze(request)

    assert first.cache_hit is False
    assert first.analysis_mode == "gemini"
    assert first.model_id == expected
    assert second.cache_hit is True
    assert second.model_id == expected
    create.assert_called_once()
    assert create.call_args.kwargs["model"] == "requested-model-a"
    assert "model_id" not in create.call_args.kwargs["response_format"]["schema"]["properties"]

    monkeypatch.setenv("GEMINI_MODEL", "requested-model-b")
    third = main.analyze(request)
    assert third.cache_hit is False
    assert create.call_count == 2
    assert create.call_args.kwargs["model"] == "requested-model-b"


def test_legacy_v4_mock_cache_without_model_id_is_reused(client, monkeypatch):
    request = AnalyzeRequest.model_validate(payload())
    legacy_response = main.analyze(request).model_dump(mode="json")
    legacy_response.pop("model_id")
    fingerprint = create_fingerprint({
        "place_id": request.place_id,
        "reviews": [review.model_dump(mode="json") for review in request.reviews],
    })
    assert CACHE_FORMAT_VERSION == 4
    main.cache.set(request.place_id, fingerprint, legacy_response)
    analyze_reviews = Mock(side_effect=AssertionError("Legacy cache must stay valid"))
    monkeypatch.setattr(main, "analyze_reviews", analyze_reviews)

    response = main.analyze(request)

    assert response.cache_hit is True
    assert response.analysis_mode == "mock"
    assert response.model_id is None
    analyze_reviews.assert_not_called()


def test_empty_input_has_no_model_id_and_does_not_call_gemini(client, monkeypatch):
    monkeypatch.setenv("MOCK_LLM", "false")
    gemini_client = Mock(side_effect=AssertionError("Empty input should skip Gemini"))
    monkeypatch.setattr(llm_absa.genai, "Client", gemini_client)
    request = AnalyzeRequest.model_validate({**payload(), "reviews": []})

    response = main.analyze(request)

    assert response.analyzed_count == 0
    assert response.model_id is None
    gemini_client.assert_not_called()
    
def test_llm_error_returns_standard_error_response(monkeypatch):
    from fastapi.testclient import TestClient
    from app.services.llm_absa import LLMTimeoutError

    cache = Mock()
    cache.get_entry.return_value = None
    monkeypatch.setattr(main, "cache", cache)
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews, **settings: (_ for _ in ()).throw(LLMTimeoutError()),
    )

    response = TestClient(main.app).post(
        "/api/v1/analyze",
        json=payload(),
    )

    assert response.status_code == 504
    assert response.json() == {
        "detail": {
            "code": "LLM_TIMEOUT",
            "message": "AI 分析逾時，請稍後再試。",
        }
    }
    
@pytest.mark.parametrize(
    "field,value",
    [
        ("place_id", "p" * 513),
        ("reviews", [payload()["reviews"][0]] * 51),
    ],
)
def test_analyze_request_rejects_oversized_fields(field, value):
    test_payload = payload()
    test_payload[field] = value

    with pytest.raises(ValidationError):
        AnalyzeRequest.model_validate(test_payload)


def test_review_text_rejects_more_than_5000_characters():
    test_payload = payload()
    test_payload["reviews"][0]["text"] = "a" * 5001

    with pytest.raises(ValidationError):
        AnalyzeRequest.model_validate(test_payload)


@pytest.mark.parametrize("field,limit", [("review_id", 256), ("relative_time", 128), ("text", 5000)])
def test_review_input_limits_count_unicode_characters(field, limit):
    test_payload = payload()
    test_payload["reviews"][0][field] = "😀" * limit
    AnalyzeRequest.model_validate(test_payload)
    test_payload["reviews"][0][field] += "😀"
    with pytest.raises(ValidationError):
        AnalyzeRequest.model_validate(test_payload)

from unittest.mock import Mock

import app.main as main
from app.core.schemas import LLMABSAOutput
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
    request = AnalyzeRequest.model_validate(payload())
    first = analyze(request)
    body = first.model_dump()
    assert {
        "cache_hit",
        "analysis_mode",
        "analyzed_count",
        "metrics",
        "anomaly_alert",
        "timeline",
        "aspect_scores",
        "pros",
        "cons",
        "suspicious_reasons_breakdown",
    } <= body.keys()
    assert body["cache_hit"] is False
    assert body["analyzed_count"] == 1
    second = analyze(request)
    assert second.cache_hit is True


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
    assert second_response.metrics["total_reviews"] == 3
    assert second_response.analyzed_count == 2


def test_same_request_still_uses_cache(client):
    request = AnalyzeRequest.model_validate(payload())

    first_response = analyze(request)
    second_response = analyze(request)

    assert first_response.cache_hit is False
    assert second_response.cache_hit is True


def test_analyzed_count_excludes_empty_review_text(monkeypatch):
    cache = Mock()
    cache.get.return_value = None
    monkeypatch.setattr(main, "cache", cache)

    # Keep the LLM isolated from external providers.
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews: LLMABSAOutput(),
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

    # r1 is eligible, r2 is suspicious, and r3 has empty text.
    assert response.analyzed_count == 1

    # Empty-text reviews are still counted as clean reviews.
    assert response.metrics["clean_count"] == 2


def test_invalid_cached_response_is_treated_as_cache_miss(monkeypatch):
    cache = Mock()

    # Simulate a cache entry that is a dict but does not
    # satisfy the AnalyzeResponse schema.
    cache.get.return_value = {}

    monkeypatch.setattr(main, "cache", cache)
    monkeypatch.setenv("MOCK_LLM", "true")

    # Isolate the test from external LLM providers.
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews: LLMABSAOutput(),
    )

    request = AnalyzeRequest.model_validate(payload())

    response = main.analyze(request)

    # Invalid cache should be deleted.
    cache.delete.assert_called_once_with(request.place_id)

    # The request should be recomputed instead of raising
    # a Pydantic ValidationError.
    assert response.cache_hit is False
    assert response.analyzed_count == 1
    assert response.analysis_mode == "mock"

    # The newly computed response should be saved.
    cache.set.assert_called_once()

def test_analysis_mode_mock(monkeypatch):
    cache = Mock()
    cache.get.return_value = None
    monkeypatch.setattr(main, "cache", cache)
    monkeypatch.setenv("MOCK_LLM", "true")
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews: LLMABSAOutput(),
    )

    request = AnalyzeRequest.model_validate(payload())
    response = main.analyze(request)

    assert response.analysis_mode == "mock"


def test_analysis_mode_gemini(monkeypatch):
    cache = Mock()
    cache.get.return_value = None
    monkeypatch.setattr(main, "cache", cache)
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews: LLMABSAOutput(),
    )

    request = AnalyzeRequest.model_validate(payload())
    response = main.analyze(request)

    assert response.analysis_mode == "gemini"


def test_cache_hit_preserves_original_analysis_mode(client, monkeypatch):
    monkeypatch.setenv("MOCK_LLM", "true")

    request = AnalyzeRequest.model_validate(payload())

    first_response = main.analyze(request)
    assert first_response.analysis_mode == "mock"

    # Change environment after the first analysis.
    monkeypatch.setenv("MOCK_LLM", "false")

    second_response = main.analyze(request)

    assert second_response.cache_hit is True
    assert second_response.analysis_mode == "mock"
    
def test_llm_error_returns_standard_error_response(monkeypatch):
    from fastapi.testclient import TestClient
    from app.services.llm_absa import LLMTimeoutError

    cache = Mock()
    cache.get.return_value = None
    monkeypatch.setattr(main, "cache", cache)
    monkeypatch.setattr(
        main,
        "analyze_reviews",
        lambda reviews: (_ for _ in ()).throw(LLMTimeoutError()),
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
        ("place_id", "p" * 257),
        ("reviews", [{}] * 121),
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
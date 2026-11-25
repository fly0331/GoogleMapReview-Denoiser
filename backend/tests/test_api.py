def payload():
    return {"place_id": "p1", "scraped_at": "2026-11-25T00:00:00Z", "reviews": [{"review_id": "r1", "rating": 5, "text": "服務很好", "relative_time": "1 week ago"}, {"review_id": "r2", "rating": 5, "text": "五星送小菜", "relative_time": "1 week ago"}]}

from app.main import analyze
from app.core.schemas import AnalyzeRequest

def test_analyze_contract_and_cache(client):
    request = AnalyzeRequest.model_validate(payload())
    first = analyze(request)
    body = first.model_dump()
    assert {"cache_hit", "analyzed_count", "metrics", "anomaly_alert", "timeline", "aspect_scores", "pros", "cons", "suspicious_reasons_breakdown"} <= body.keys()
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


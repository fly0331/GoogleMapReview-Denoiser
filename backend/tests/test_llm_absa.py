
import json

import pytest
from pydantic import ValidationError

from app.core.schemas import LLMABSAOutput, ReviewInput
from app.services import llm_absa


@pytest.fixture
def reviews():
    return [
        ReviewInput(
            review_id="review-1",
            rating=5,
            text="餐點很好吃，服務也很親切。",
        ),
        ReviewInput(
            review_id="review-2",
            rating=2,
            text="價格太貴，服務態度不好。",
        ),
        ReviewInput(
            review_id="review-3",
            rating=4,
            text="環境乾淨舒適。",
        ),
    ]


def test_mock_provider_returns_pros_and_cons(
    reviews,
    monkeypatch,
):
    monkeypatch.setenv("MOCK_LLM", "true")

    result = llm_absa.analyze_reviews(reviews)

    assert len(result.pros) == 1
    assert len(result.cons) == 1
    assert result.pros[0].evidence_review_ids == [
        "review-1",
        "review-3",
    ]
    assert result.cons[0].evidence_review_ids == ["review-2"]


def test_mock_provider_does_not_call_gemini(
    reviews,
    monkeypatch,
):
    monkeypatch.setenv("MOCK_LLM", "true")

    def fail_if_called(*args, **kwargs):
        raise AssertionError("Gemini should not be called")

    monkeypatch.setattr(
        llm_absa.genai,
        "Client",
        fail_if_called,
    )

    llm_absa.analyze_reviews(reviews)


def test_missing_api_key_raises_error(
    reviews,
    monkeypatch,
):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        llm_absa.analyze_reviews(reviews)


def test_empty_reviews_do_not_call_gemini(monkeypatch):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    def fail_if_called(*args, **kwargs):
        raise AssertionError("Gemini should not be called")

    monkeypatch.setattr(
        llm_absa.genai,
        "Client",
        fail_if_called,
    )

    result = llm_absa.analyze_reviews([])

    assert result.pros == []
    assert result.cons == []


def test_gemini_provider_parses_structured_output(
    reviews,
    monkeypatch,
):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    payload = {
        "pros": [
            {
                "aspect": "food",
                "sentiment": "positive",
                "summary": "餐點美味",
                "evidence_review_ids": [
                    "review-1",
                    "invalid-id",
                ],
            }
        ],
        "cons": [
            {
                "aspect": "service",
                "sentiment": "negative",
                "summary": "服務態度不佳",
                "evidence_review_ids": ["review-2"],
            }
        ],
        "aspect_scores": {
            "food": 4.5,
            "service": 2.0,
        },
    }

    class FakeInteraction:
        output_text = json.dumps(
            payload,
            ensure_ascii=False,
        )

    class FakeInteractions:
        def create(self, **kwargs):
            assert kwargs["model"] == "gemini-3.5-flash-lite"
            assert kwargs["response_format"]["mime_type"] == (
                "application/json"
            )
            return FakeInteraction()

    class FakeClient:
        def __init__(self, api_key):
            assert api_key == "test-key"
            self.interactions = FakeInteractions()

    monkeypatch.setattr(
        llm_absa.genai,
        "Client",
        FakeClient,
    )

    result = llm_absa.analyze_reviews(reviews)

    assert isinstance(result, LLMABSAOutput)
    assert result.pros[0].evidence_review_ids == ["review-1"]
    assert result.cons[0].evidence_review_ids == ["review-2"]
    assert result.aspect_scores["food"] == 4.5


def test_invalid_gemini_output_raises_error(
    reviews,
    monkeypatch,
):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    class FakeInteraction:
        output_text = '{"pros": "invalid"}'

    class FakeInteractions:
        def create(self, **kwargs):
            return FakeInteraction()

    class FakeClient:
        def __init__(self, api_key):
            self.interactions = FakeInteractions()

    monkeypatch.setattr(
        llm_absa.genai,
        "Client",
        FakeClient,
    )

    with pytest.raises(
        RuntimeError,
        match="Gemini returned invalid ABSA output",
    ):
        llm_absa.analyze_reviews(reviews)

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

    with pytest.raises(llm_absa.LLMNotConfiguredError) as exc_info:
        llm_absa.analyze_reviews(reviews)
        
    assert exc_info.value.code == "LLM_NOT_CONFIGURED"


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
            assert kwargs["response_format"]["mime_type"] == ("application/json")
            return FakeInteraction()

    class FakeClient:
        def __init__(self, api_key, http_options=None):
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
        def __init__(self, api_key, http_options=None):
            self.interactions = FakeInteractions()

    monkeypatch.setattr(
        llm_absa.genai,
        "Client",
        FakeClient,
    )

    with pytest.raises(llm_absa.LLMInvalidResponseError) as exc_info:
        llm_absa.analyze_reviews(reviews)
        
    assert exc_info.value.code == "LLM_INVALID_RESPONSE"


def test_invalid_evidence_items_are_removed(reviews):
    output = LLMABSAOutput(
        pros=[
            {
                "aspect": "food",
                "sentiment": "positive",
                "summary": "餐點很好吃",
                "evidence_review_ids": ["invalid-id"],
            },
            {
                "aspect": "environment",
                "sentiment": "positive",
                "summary": "環境舒適",
                "evidence_review_ids": ["review-3"],
            },
            {
                "aspect": "price",
                "sentiment": "positive",
                "summary": "價格合理",
                "evidence_review_ids": [],
            },
        ]
    )

    result = llm_absa.validate_evidence_ids(output, reviews)

    assert len(result.pros) == 1
    assert result.pros[0].aspect == "environment"


def test_duplicate_aspects_are_removed(reviews):
    output = LLMABSAOutput(
        pros=[
            {
                "aspect": "food",
                "sentiment": "positive",
                "summary": "餐點很好吃",
                "evidence_review_ids": ["review-1"],
            },
            {
                "aspect": "FOOD",
                "sentiment": "positive",
                "summary": "餐點品質不錯",
                "evidence_review_ids": ["review-3"],
            },
        ]
    )

    result = llm_absa.validate_evidence_ids(output, reviews)

    assert len(result.pros) == 1


def test_inconsistent_sentiment_is_removed(reviews):
    output = LLMABSAOutput(
        pros=[
            {
                "aspect": "service",
                "sentiment": "negative",
                "summary": "服務不好",
                "evidence_review_ids": ["review-2"],
            }
        ],
        cons=[
            {
                "aspect": "food",
                "sentiment": "positive",
                "summary": "餐點很好吃",
                "evidence_review_ids": ["review-1"],
            }
        ],
    )

    result = llm_absa.validate_evidence_ids(output, reviews)

    assert result.pros == []
    assert result.cons == []


@pytest.mark.parametrize(
    "payload",
    [
        {
            "aspect": "",
            "sentiment": "positive",
            "summary": "餐點很好吃",
            "evidence_review_ids": ["review-1"],
        },
        {
            "aspect": "food",
            "sentiment": "positive",
            "summary": "   ",
            "evidence_review_ids": ["review-1"],
        },
        {
            "aspect": "food",
            "sentiment": "neutral",
            "summary": "餐點普通",
            "evidence_review_ids": ["review-1"],
        },
    ],
)
def test_invalid_review_analysis_is_rejected(payload):
    with pytest.raises(ValidationError):
        LLMABSAOutput(pros=[payload])


@pytest.mark.parametrize("score", [0.9, 5.1, -1])
def test_invalid_aspect_scores_are_rejected(score):
    with pytest.raises(ValidationError):
        LLMABSAOutput(aspect_scores={"food": score})


def test_duplicate_aspect_scores_are_rejected():
    with pytest.raises(ValidationError):
        LLMABSAOutput(
            aspect_scores={
                "food": 4.5,
                " food ": 3.5,
            }
        )


def test_evidence_ids_are_normalized():
    output = LLMABSAOutput(
        pros=[
            {
                "aspect": "food",
                "sentiment": "positive",
                "summary": "餐點很好吃",
                "evidence_review_ids": [
                    "review-1",
                    "review-1",
                    " ",
                ],
            }
        ]
    )

    assert output.pros[0].evidence_review_ids == ["review-1"]
    
def test_gemini_timeout_raises_timeout_error(
    reviews,
    monkeypatch,
):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    class FakeInteractions:
        def create(self, **kwargs):
            raise TimeoutError("request timed out")

    class FakeClient:
        def __init__(self, api_key, http_options=None):
            self.interactions = FakeInteractions()

    monkeypatch.setattr(
        llm_absa.genai,
        "Client",
        FakeClient,
    )

    with pytest.raises(llm_absa.LLMTimeoutError) as exc_info:
        llm_absa.analyze_reviews(reviews)

    assert exc_info.value.code == "LLM_TIMEOUT"


def test_gemini_service_error_raises_unavailable_error(
    reviews,
    monkeypatch,
):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    class FakeInteractions:
        def create(self, **kwargs):
            raise RuntimeError("provider unavailable")

    class FakeClient:
        def __init__(self, api_key, http_options=None):
            self.interactions = FakeInteractions()

    monkeypatch.setattr(
        llm_absa.genai,
        "Client",
        FakeClient,
    )

    with pytest.raises(
        llm_absa.LLMServiceUnavailableError
    ) as exc_info:
        llm_absa.analyze_reviews(reviews)

    assert exc_info.value.code == "LLM_SERVICE_UNAVAILABLE"
    
@pytest.mark.parametrize(
    "reviews",
    [
        [
            ReviewInput(
                review_id=f"review-{i}",
                rating=5,
                text="評論",
            )
            for i in range(51)
        ],
        [
            ReviewInput(
                review_id=f"review-{i}",
                rating=5,
                text="a" * 4001,
            )
            for i in range(5)
        ],
    ],
)
def test_gemini_input_limits_are_enforced(reviews):
    with pytest.raises(llm_absa.LLMInputLimitError):
        llm_absa.validate_gemini_input(reviews)


def test_gemini_input_at_limits_is_accepted():
    reviews = [
        ReviewInput(
            review_id=f"review-{i}",
            rating=5,
            text="a" * 400,
        )
        for i in range(50)
    ]

    llm_absa.validate_gemini_input(reviews)


@pytest.mark.parametrize("output_text", ["", "   "])
def test_empty_gemini_response_raises_invalid_response(
    reviews,
    monkeypatch,
    output_text,
):
    monkeypatch.setenv("MOCK_LLM", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    class FakeInteraction:
        def __init__(self):
            self.output_text = output_text

    class FakeInteractions:
        def create(self, **kwargs):
            return FakeInteraction()

    class FakeClient:
        def __init__(self, api_key, http_options=None):
            self.interactions = FakeInteractions()

    monkeypatch.setattr(
        llm_absa.genai,
        "Client",
        FakeClient,
    )

    with pytest.raises(llm_absa.LLMInvalidResponseError) as exc_info:
        llm_absa.analyze_reviews(reviews)

    assert exc_info.value.code == "LLM_INVALID_RESPONSE"

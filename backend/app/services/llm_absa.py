import json
import os

from google import genai
from pydantic import ValidationError

from app.core.schemas import LLMABSAOutput, ReviewInput


class LLMAnalysisError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class LLMNotConfiguredError(LLMAnalysisError):
    def __init__(self):
        super().__init__(
            code="LLM_NOT_CONFIGURED",
            message="AI 分析服務尚未完成設定。",
            status_code=503,
        )


class LLMTimeoutError(LLMAnalysisError):
    def __init__(self):
        super().__init__(
            code="LLM_TIMEOUT",
            message="AI 分析逾時，請稍後再試。",
            status_code=504,
        )


class LLMServiceUnavailableError(LLMAnalysisError):
    def __init__(self):
        super().__init__(
            code="LLM_SERVICE_UNAVAILABLE",
            message="AI 分析服務暫時無法使用，請稍後再試。",
            status_code=503,
        )


class LLMInvalidResponseError(LLMAnalysisError):
    def __init__(self):
        super().__init__(
            code="LLM_INVALID_RESPONSE",
            message="AI 分析結果格式異常，請稍後再試。",
            status_code=502,
        )

def validate_evidence_ids(
    output: LLMABSAOutput,
    reviews: list[ReviewInput],
) -> LLMABSAOutput:
    valid = {review.review_id for review in reviews}

    def filter_items(
        items: list,
        expected_sentiment: str,
    ) -> list:
        filtered = []
        seen_aspects = set()

        for item in items:
            if item.sentiment != expected_sentiment:
                continue

            evidence_ids = [rid for rid in item.evidence_review_ids if rid in valid]

            if not evidence_ids:
                continue

            aspect_key = item.aspect.strip().casefold()
            if aspect_key in seen_aspects:
                continue

            seen_aspects.add(aspect_key)

            filtered.append(
                item.model_copy(update={"evidence_review_ids": evidence_ids})
            )

        return filtered

    return output.model_copy(
        update={
            "pros": filter_items(output.pros, "positive"),
            "cons": filter_items(output.cons, "negative"),
        }
    )


def _analyze_with_mock(
    reviews: list[ReviewInput],
) -> LLMABSAOutput:
    pros = []
    cons = []

    positive_ids = [r.review_id for r in reviews if r.rating >= 4]
    negative_ids = [r.review_id for r in reviews if r.rating <= 3]

    if positive_ids:
        pros.append(
            {
                "aspect": "overall",
                "sentiment": "positive",
                "summary": "顧客回饋正面",
                "evidence_review_ids": positive_ids[:3],
            }
        )

    if negative_ids:
        cons.append(
            {
                "aspect": "overall",
                "sentiment": "negative",
                "summary": "顧客提出改善意見",
                "evidence_review_ids": negative_ids[:3],
            }
        )

    return LLMABSAOutput(pros=pros, cons=cons)


def _analyze_with_gemini(
    reviews: list[ReviewInput],
) -> LLMABSAOutput:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise LLMNotConfiguredError()

    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    client = genai.Client(api_key=api_key)

    review_data = [
        {
            "review_id": review.review_id,
            "rating": review.rating,
            "text": review.text,
        }
        for review in reviews
    ]

    prompt = f"""
你是一位專業的繁體中文顧客評論分析助手。

請根據提供的 Google Maps 評論進行 Aspect-Based Sentiment Analysis (ABSA)。

分析要求：
1. 識別評論中具體的面向，例如餐點、服務、價格、環境、交通。
2. 將正面發現放入 pros，負面發現放入 cons。
3. summary 使用精簡、自然的繁體中文。
4. sentiment 使用 positive 或 negative。
5. evidence_review_ids 只能使用輸入中實際存在的 review_id。
6. 不可捏造評論內容、面向或證據。
7. aspect_scores 為各面向的整體評分，範圍 1.0 至 5.0。
8. 沒有足夠證據的面向不要輸出。

以下是評論資料（JSON）：
{json.dumps(review_data, ensure_ascii=False)}
"""

    try:
        interaction = client.interactions.create(
            model=model,
            input=prompt,
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": LLMABSAOutput.model_json_schema(),
            },
        )

        if not interaction.output_text:
            raise RuntimeError("Gemini returned an empty response")

        output = LLMABSAOutput.model_validate_json(interaction.output_text)

    except ValidationError as exc:
        raise LLMInvalidResponseError() from exc
    except Exception as exc:
        if isinstance(exc, LLMAnalysisError):
            raise

        if isinstance(exc, TimeoutError) or "timeout" in str(exc).lower():
            raise LLMTimeoutError() from exc

        raise LLMServiceUnavailableError() from exc

    return validate_evidence_ids(output, reviews)

def get_analysis_mode() -> str:
    return (
        "mock"
        if os.getenv("MOCK_LLM", "false").lower() == "true"
        else "gemini"
    )


def analyze_reviews(
    reviews: list[ReviewInput],
) -> LLMABSAOutput:
    eligible = [review for review in reviews if review.text.strip()]

    if not eligible:
        return LLMABSAOutput()

    if os.getenv("MOCK_LLM", "false").lower() == "true":
        return validate_evidence_ids(
            _analyze_with_mock(eligible),
            eligible,
        )

    return _analyze_with_gemini(eligible)

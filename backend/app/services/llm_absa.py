import os
from app.core.schemas import LLMABSAOutput, ReviewInput

def validate_evidence_ids(output: LLMABSAOutput, reviews: list[ReviewInput]) -> LLMABSAOutput:
    valid = {review.review_id for review in reviews}
    output.pros = [item.model_copy(update={"evidence_review_ids": [rid for rid in item.evidence_review_ids if rid in valid]}) for item in output.pros]
    output.cons = [item.model_copy(update={"evidence_review_ids": [rid for rid in item.evidence_review_ids if rid in valid]}) for item in output.cons]
    return output

def analyze_reviews(reviews: list[ReviewInput]) -> LLMABSAOutput:
    eligible = [review for review in reviews if review.text.strip()]
    if os.getenv("MOCK_LLM", "false").lower() == "true":
        pros = []
        cons = []
        positive_ids = [r.review_id for r in eligible if r.rating >= 4]
        negative_ids = [r.review_id for r in eligible if r.rating <= 3]
        if positive_ids:
            pros.append({"aspect": "overall", "sentiment": "positive", "summary": "顧客回饋正面", "evidence_review_ids": positive_ids[:3]})
        if negative_ids:
            cons.append({"aspect": "overall", "sentiment": "negative", "summary": "顧客提出改善意見", "evidence_review_ids": negative_ids[:3]})
        return validate_evidence_ids(LLMABSAOutput(pros=pros, cons=cons), eligible)
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required when MOCK_LLM is disabled")
    # Gemini Structured Output integration point. Keep provider invocation isolated here.
    raise RuntimeError("Gemini client integration is not configured; install the gemini extra and implement provider call")

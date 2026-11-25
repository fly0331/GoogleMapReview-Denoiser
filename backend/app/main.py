
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from app.api.health import router as health_router
from app.cache import SQLiteCache, create_fingerprint
from app.core.schemas import AnalyzeRequest, AnalyzeResponse
from app.services.cleaner import clean_reviews
from app.services.llm_absa import (
    LLMAnalysisError,
    analyze_reviews,
    get_analysis_mode,
)
from app.services.timeline import build_timeline


app = FastAPI(title="Review Denoiser API", version="0.1.0")

@app.exception_handler(LLMAnalysisError)
async def llm_analysis_exception_handler(
    request: Request,
    exc: LLMAnalysisError,
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": {
                "code": exc.code,
                "message": exc.message,
            }
        },
    )

origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

cache = SQLiteCache(os.getenv("DATABASE_PATH", "./reviews.db"))
app.include_router(health_router)


@app.post("/api/v1/analyze", response_model=AnalyzeResponse)
def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    fingerprint = create_fingerprint(
    {
        "place_id": request.place_id,
        "reviews": [
            review.model_dump(mode="json")
            for review in request.reviews
        ],
    }
)

    # Check cache first.
    cached = cache.get(request.place_id, fingerprint)

    if cached is not None:
        try:
            return AnalyzeResponse.model_validate(
                {
                    **cached,
                    "cache_hit": True,
                }
            )
        except ValidationError:
            # Invalid cached response: remove it and continue analysis.
            cache.delete(request.place_id)

    # Clean reviews.
    cleaned = clean_reviews(request.reviews, request.scraped_at)

    # Reviews that pass the cleaner.
    clean_count = sum(
        not item.suspicious
        for item in cleaned
    )

    # Only non-suspicious reviews with non-empty text
    # are eligible for LLM analysis.
    eligible = [
        item.review
        for item in cleaned
        if not item.suspicious and item.review.text.strip()
    ]

    # Build monthly timeline and detect anomalies.
    timeline, anomaly, historical_negative_ratio = build_timeline(
        cleaned,
        request.scraped_at,
    )

    # Run LLM analysis.
    llm_output = analyze_reviews(eligible)

    # Count suspicious reasons.
    breakdown: dict[str, int] = {}

    for item in cleaned:
        for reason in item.reasons:
            breakdown[reason] = breakdown.get(reason, 0) + 1

    # Build response.
    response = AnalyzeResponse(
        cache_hit=False,
        analysis_mode=get_analysis_mode(),
        analyzed_count=len(eligible),
        metrics={
            "total_reviews": len(request.reviews),
            "suspicious_count": sum(
                item.suspicious for item in cleaned
            ),
            "clean_count": clean_count,
            "historical_negative_ratio": historical_negative_ratio,
        },
        anomaly_alert=anomaly,
        timeline=timeline,
        aspect_scores=llm_output.aspect_scores,
        pros=llm_output.pros,
        cons=llm_output.cons,
        suspicious_reasons_breakdown=breakdown,
    )

    # Save response to cache.
    cache.set(
        request.place_id,
        fingerprint,
        response.model_dump(mode="json"),
    )

    return response


import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.cache import SQLiteCache, create_fingerprint
from app.core.schemas import AnalyzeRequest, AnalyzeResponse
from app.services.cleaner import clean_reviews
from app.services.llm_absa import analyze_reviews
from app.services.timeline import build_timeline


app = FastAPI(title="Review Denoiser API", version="0.1.0")

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
    request_payload = request.model_dump(mode="json")
    fingerprint = create_fingerprint(request_payload)

    cached = cache.get(request.place_id, fingerprint)
    if cached is not None:
        cached["cache_hit"] = True
        return AnalyzeResponse(**cached)

    cleaned = clean_reviews(request.reviews, request.scraped_at)
    eligible = [item.review for item in cleaned if not item.suspicious]

    timeline, anomaly = build_timeline(cleaned, request.scraped_at)
    llm_output = analyze_reviews(eligible)

    breakdown: dict[str, int] = {}
    for item in cleaned:
        for reason in item.reasons:
            breakdown[reason] = breakdown.get(reason, 0) + 1

    response = AnalyzeResponse(
        cache_hit=False,
        analyzed_count=len(eligible),
        metrics={
            "total_reviews": len(request.reviews),
            "suspicious_count": sum(item.suspicious for item in cleaned),
            "clean_count": len(eligible),
        },
        anomaly_alert=anomaly,
        timeline=timeline,
        aspect_scores=llm_output.aspect_scores,
        pros=llm_output.pros,
        cons=llm_output.cons,
        suspicious_reasons_breakdown=breakdown,
    )

    cache.set(
        request.place_id,
        fingerprint,
        response.model_dump(mode="json"),
    )

    return response

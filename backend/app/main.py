import os
import ipaddress
from fastapi import FastAPI, Request, HTTPException
from app.rate_limit import InMemoryRateLimiter
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError


from app.api.health import router as health_router
from app.cache import SQLiteCache, create_fingerprint
from app.core.schemas import AnalyzeRequest, AnalyzeResponse
from app.services.llm_absa import (
    LLMAnalysisError,
    analyze_reviews,
    get_analysis_mode,
)
from app.services.review_selection import select_llm_reviews

app = FastAPI(title="Review Denoiser API", version="0.1.0")

rate_limiter = InMemoryRateLimiter(
    max_requests=int(os.getenv("RATE_LIMIT_REQUESTS", "10")),
    window_seconds=int(os.getenv("RATE_LIMIT_WINDOW", "60")),
)

def get_client_ip(request: Request) -> str:
    forwarded_ip = request.headers.get("cf-connecting-ip")

    if forwarded_ip:
        try:
            return str(ipaddress.ip_address(forwarded_ip.strip()))
        except ValueError:
            pass

    if request.client:
        return request.client.host

    return "unknown"

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if (
        request.method == "POST"
        and request.url.path == "/api/v1/analyze"
    ):
        client_ip = get_client_ip(request)

        if not rate_limiter.is_allowed(client_ip):
            return JSONResponse(
                status_code=429,
                content={
                    "detail": {
                        "code": "RATE_LIMIT_EXCEEDED",
                        "message": "Too many requests. Please try again later.",
                    }
                },
            )

    return await call_next(request)


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
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
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
            "reviews": [review.model_dump(mode="json") for review in request.reviews],
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

    eligible = select_llm_reviews(request.reviews)
    llm_output = analyze_reviews(eligible)

    # Build response.
    response = AnalyzeResponse(
        cache_hit=False,
        analysis_mode=get_analysis_mode(),
        model_id=llm_output.model_id,
        analyzed_count=len(eligible),
        aspect_scores=llm_output.aspect_scores,
        recommended_dishes=llm_output.recommended_dishes,
        pros=llm_output.pros,
        cons=llm_output.cons,
        practical_visit_information=llm_output.practical_visit_information,
        decision_pros=llm_output.decision_pros,
        decision_cons=llm_output.decision_cons,
    )

    # Save response to cache.
    cache.set(
        request.place_id,
        fingerprint,
        response.model_dump(mode="json"),
    )

    return response

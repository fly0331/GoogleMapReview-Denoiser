import os
import ipaddress
from fastapi import FastAPI, Request
from anyio import to_thread
from app.rate_limit import InMemoryRateLimiter
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError


from app.api.health import router as health_router
from app.body_limit import RequestBodyLimit
from app.cache import CACHE_FORMAT_VERSION, SQLiteCache, create_fingerprint
from app.core.schemas import AnalyzeRequest, AnalyzeResponse
from app.core.settings import positive_int
from app.services.llm_absa import (
    GEMINI_PROMPT_VERSION,
    LLMAnalysisError,
    MAX_GEMINI_OUTPUT_TOKENS,
    MAX_GEMINI_REQUEST_BYTES,
    analyze_reviews,
    get_analysis_mode,
    get_analysis_model,
)
from app.services.review_selection import select_llm_reviews
from app.singleflight import SingleFlight, logger

app = FastAPI(title="Review Denoiser API", version="0.1.0")
ANALYZE_PATH = "/api/v1/analyze"
app.add_middleware(RequestBodyLimit, path=ANALYZE_PATH, limit=positive_int("MAX_REQUEST_BODY_BYTES", 512 * 1024))

rate_limiter = InMemoryRateLimiter(
    max_requests=positive_int("RATE_LIMIT_REQUESTS", 5),
    window_seconds=positive_int("RATE_LIMIT_WINDOW", 60),
    max_clients=positive_int("RATE_LIMIT_MAX_CLIENTS", 10_000),
)

def get_client_ip(request: Request) -> str:
    # Uvicorn resolves trusted proxy headers before the request reaches ASGI.
    host = request.client.host if request.client else ""
    try:
        address = ipaddress.ip_address(host)
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            return str(address.ipv4_mapped)
        return str(address)
    except ValueError:
        return "unknown"

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if (
        request.method == "POST"
        and request.url.path == ANALYZE_PATH
    ):
        client_ip = get_client_ip(request)

        retry_after = rate_limiter.retry_after(client_ip)
        if retry_after is not None:
            return JSONResponse(
                status_code=429,
                headers={"Retry-After": str(retry_after)},
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
singleflight = SingleFlight()
app.include_router(health_router)


@app.post(ANALYZE_PATH, response_model=AnalyzeResponse, name="analyze")
async def analyze_http(request: AnalyzeRequest) -> AnalyzeResponse:
    # A disconnected HTTP client may stop waiting. A running analysis retains its
    # thread, registry entry, and Gemini slot until the synchronous work returns.
    return await to_thread.run_sync(analyze, request, abandon_on_cancel=True)


def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    mode = get_analysis_mode()
    model = get_analysis_model() if mode == "gemini" else None
    fingerprint = create_fingerprint(
        {
            "place_id": request.place_id,
            "reviews": [review.model_dump(mode="json") for review in request.reviews],
        }
    )

    key = create_fingerprint({
        "input": fingerprint, "mode": mode, "model": model,
        "prompt": GEMINI_PROMPT_VERSION, "cache_format": CACHE_FORMAT_VERSION,
        "output_tokens": MAX_GEMINI_OUTPUT_TOKENS, "request_bytes": MAX_GEMINI_REQUEST_BYTES,
    })

    def read_cache() -> AnalyzeResponse | None:
        entry = cache.get_entry(request.place_id, fingerprint)
        if entry is None or (entry.analysis_key is not None and entry.analysis_key != key):
            return None
        try:
            result = AnalyzeResponse.model_validate({**entry.response, "cache_hit": True})
        except ValidationError:
            cache.delete_entry(entry)
            return None
        if entry.analysis_key is None and (result.analysis_mode != mode or result.model_id != model):
            return None
        logger.info("cache_hit")
        return result

    def run_analysis() -> AnalyzeResponse:
        cached = read_cache()
        if cached is not None:
            return cached

        eligible = select_llm_reviews(request.reviews)
        llm_output = analyze_reviews(eligible, mode=mode, model=model)
        response = AnalyzeResponse(
            cache_hit=False,
            analysis_mode=mode,
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
        cache.set(request.place_id, fingerprint, response.model_dump(mode="json"), analysis_key=key)
        return response

    cached = read_cache()
    if cached is not None:
        return cached
    logger.info("cache_miss")
    return singleflight.run(key, run_analysis)

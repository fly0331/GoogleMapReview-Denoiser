
from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_validator


def normalize_aware_datetime(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Datetime must include a timezone")

    return value.astimezone(timezone.utc)


class ReviewInput(BaseModel):
    review_id: str
    rating: int = Field(ge=1, le=5)
    text: str = ""
    relative_time: str | None = None
    author_reviews_count: int | None = Field(default=None, ge=0)
    review_date: datetime | None = None

    @field_validator("review_date")
    @classmethod
    def validate_review_date(
        cls,
        value: datetime | None,
    ) -> datetime | None:
        if value is None:
            return None
        return normalize_aware_datetime(value)


class AnalyzeRequest(BaseModel):
    place_id: str = Field(min_length=1)
    reviews: list[ReviewInput]
    scraped_at: datetime

    @field_validator("scraped_at")
    @classmethod
    def validate_scraped_at(cls, value: datetime) -> datetime:
        return normalize_aware_datetime(value)


class ReviewAnalysis(BaseModel):
    aspect: str
    sentiment: str
    summary: str
    evidence_review_ids: list[str]


class LLMABSAOutput(BaseModel):
    pros: list[ReviewAnalysis] = Field(default_factory=list)
    cons: list[ReviewAnalysis] = Field(default_factory=list)
    aspect_scores: dict[str, float] = Field(default_factory=dict)


class TimelineBucket(BaseModel):
    month: str
    review_count: int
    negative_count: int
    negative_ratio: float


class AnalyzeResponse(BaseModel):
    cache_hit: bool
    analyzed_count: int
    metrics: dict[str, int | float | None]
    anomaly_alert: bool
    timeline: list[TimelineBucket]
    aspect_scores: dict[str, float]
    pros: list[ReviewAnalysis]
    cons: list[ReviewAnalysis]
    suspicious_reasons_breakdown: dict[str, int]

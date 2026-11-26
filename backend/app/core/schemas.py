
from typing import Literal
from datetime import datetime, timezone

from pydantic import BaseModel, Field, field_validator


def normalize_aware_datetime(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Datetime must include a timezone")

    return value.astimezone(timezone.utc)


class ReviewInput(BaseModel):
    review_id: str
    rating: int = Field(ge=1, le=5)
    text: str = Field(default="", max_length=5000)
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
    place_id: str = Field(min_length=1, max_length=256)
    reviews: list[ReviewInput] = Field(max_length=120)
    scraped_at: datetime

    @field_validator("scraped_at")
    @classmethod
    def validate_scraped_at(cls, value: datetime) -> datetime:
        return normalize_aware_datetime(value)


class ReviewAnalysis(BaseModel):
    aspect: str
    sentiment: Literal["positive", "negative"]
    summary: str
    evidence_review_ids: list[str]

    @field_validator("aspect", "summary")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field must not be empty")
        return value

    @field_validator("evidence_review_ids")
    @classmethod
    def normalize_evidence_ids(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(
            rid.strip() for rid in value if rid.strip()
        ))


class RecommendedDish(BaseModel):
    name: str
    summary: str
    evidence_review_ids: list[str]

    @field_validator("name", "summary")
    @classmethod
    def validate_non_empty_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Field must not be empty")
        return value

    @field_validator("evidence_review_ids")
    @classmethod
    def normalize_evidence_ids(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(
            rid.strip() for rid in value if rid.strip()
        ))

VisitInformationCategory = Literal[
    "budget", "wait_time", "reservation", "parking", "dining_time_limit", "payment", "other",
]


class PracticalVisitInformation(BaseModel):
    category: VisitInformationCategory
    summary: str = Field(min_length=1)
    evidence_review_ids: list[str] = Field(min_length=1)


class VisitInformationSource(BaseModel):
    review_id: str
    quote: str = Field(min_length=1)


class GeminiVisitInformation(BaseModel):
    category: VisitInformationCategory
    summary: str = Field(min_length=1)
    sources: list[VisitInformationSource] = Field(min_length=1)


class ABSAInsights(BaseModel):
    decision_pros: str
    decision_cons: str
    pros: list[ReviewAnalysis] = Field(default_factory=list)
    cons: list[ReviewAnalysis] = Field(default_factory=list)
    aspect_scores: dict[str, float] = Field(default_factory=dict)
    recommended_dishes: list[RecommendedDish] = Field(
        default_factory=list,
    )

    @field_validator("aspect_scores")
    @classmethod
    def validate_aspect_scores(
        cls,
        value: dict[str, float],
    ) -> dict[str, float]:
        normalized = {}

        for aspect, score in value.items():
            aspect = aspect.strip()

            if not aspect:
                raise ValueError("Aspect name must not be empty")

            if aspect in normalized:
                raise ValueError(f"Duplicate aspect: {aspect}")

            if not 1.0 <= score <= 5.0:
                raise ValueError("Aspect scores must be between 1 and 5")

            normalized[aspect] = score

        return normalized


class LLMABSAOutput(ABSAInsights):
    practical_visit_information: list[PracticalVisitInformation] = Field(default_factory=list)
    model_id: str | None = None


class GeminiABSAOutput(ABSAInsights):
    practical_visit_information: list[GeminiVisitInformation]


class TimelineBucket(BaseModel):
    month: str
    review_count: int
    negative_count: int
    negative_ratio: float


class AnalyzeResponse(BaseModel):
    cache_hit: bool
    analysis_mode: Literal["mock", "gemini"]
    model_id: str | None = None
    analyzed_count: int
    aspect_scores: dict[str, float]
    pros: list[ReviewAnalysis]
    cons: list[ReviewAnalysis]
    decision_pros: str
    decision_cons: str
    recommended_dishes: list[RecommendedDish] = Field(
        default_factory=list,
    )
    practical_visit_information: list[PracticalVisitInformation]

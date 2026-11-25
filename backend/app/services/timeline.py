
from datetime import datetime, timedelta, timezone

from app.core.schemas import TimelineBucket
from app.services.cleaner import CleanedReview


def build_timeline(
    reviews: list[CleanedReview],
    scraped_at: datetime,
) -> tuple[list[TimelineBucket], bool, float | None]:
    if scraped_at.tzinfo is None or scraped_at.utcoffset() is None:
        raise ValueError("scraped_at must include a timezone")

    scraped_at_utc = scraped_at.astimezone(timezone.utc)
    cutoff = scraped_at_utc - timedelta(days=60)

    accepted = [item for item in reviews if not item.suspicious]

    # Monthly display includes all accepted reviews, including reviews
    # whose exact date could not be resolved.
    grouped: dict[str, list[CleanedReview]] = {}

    for item in accepted:
        grouped.setdefault(item.month, []).append(item)

    timeline = []

    for month, rows in sorted(grouped.items()):
        negatives = sum(row.review.rating <= 3 for row in rows)

        timeline.append(
            TimelineBucket(
                month=month,
                review_count=len(rows),
                negative_count=negatives,
                negative_ratio=negatives / len(rows),
            )
        )

    # Anomaly detection only uses reviews with a known, valid timestamp.
    dated_reviews = [
        item
        for item in accepted
        if item.review_datetime is not None
        and item.review_datetime <= scraped_at_utc
    ]

    recent = [
        item
        for item in dated_reviews
        if item.review_datetime >= cutoff
    ]

    historical = [
        item
        for item in dated_reviews
        if item.review_datetime < cutoff
    ]

    recent_negative_count = sum(
        item.review.rating <= 3 for item in recent
    )
    recent_ratio = (
        recent_negative_count / len(recent)
        if recent
        else 0.0
    )

    historical_negative_count = sum(
        item.review.rating <= 3 for item in historical
    )

    historical_ratio = (
        historical_negative_count / len(historical)
        if historical
        else None
    )

    alert = (
        len(recent) >= 5
        and historical_ratio is not None
        and recent_ratio > historical_ratio * 1.5
    )

    return timeline, alert, historical_ratio

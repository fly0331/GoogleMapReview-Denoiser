
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.core.schemas import ReviewInput


INDUCEMENT_KEYWORDS = ("送小菜", "打卡", "五星", "招待", "抽獎", "活動", "贈送", "老闆請")
INDUCEMENT_SCORE = 2
FRESH_ACCOUNT_SCORE = 2
SHORT_PRAISE_SCORE = 1
SUSPICIOUS_THRESHOLD = 2
SHORT_PRAISES = {"讚", "好吃", "推"}

RELATIVE_TIME_PATTERN = re.compile(
    r"(\d+)\s*(秒|分鐘|小時|天|週|星期|個月|月|年|second|minute|hour|day|week|month|year)s?\s*(前|ago)",
    re.IGNORECASE,
)


@dataclass
class CleanedReview:
    review: ReviewInput
    month: str
    suspicious: bool
    score: int
    reasons: list[str]
    review_datetime: datetime | None


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Datetime must include a timezone")
    return value.astimezone(timezone.utc)


def resolve_review_datetime(
    review: ReviewInput,
    scraped_at: datetime,
) -> datetime | None:
    scraped_at_utc = _to_utc(scraped_at)

    if review.review_date is not None:
        return _to_utc(review.review_date)

    relative = (review.relative_time or "").strip().lower()
    match = RELATIVE_TIME_PATTERN.search(relative)

    if match is None:
        return None

    amount = int(match.group(1))
    unit = match.group(2)

    if unit in {"秒", "second"}:
        delta = timedelta(seconds=amount)
    elif unit in {"分鐘", "minute"}:
        delta = timedelta(minutes=amount)
    elif unit in {"小時", "hour"}:
        delta = timedelta(hours=amount)
    elif unit in {"天", "day"}:
        delta = timedelta(days=amount)
    elif unit in {"週", "星期", "week"}:
        delta = timedelta(weeks=amount)
    elif unit in {"個月", "月", "month"}:
        delta = timedelta(days=30 * amount)
    else:
        delta = timedelta(days=365 * amount)

    return scraped_at_utc - delta


def review_month(review: ReviewInput, scraped_at: datetime) -> str:
    moment = resolve_review_datetime(review, scraped_at)

    if moment is None:
        moment = _to_utc(scraped_at)

    return moment.strftime("%Y-%m")


def clean_reviews(
    reviews: list[ReviewInput],
    scraped_at: datetime,
) -> list[CleanedReview]:
    scraped_at_utc = _to_utc(scraped_at)
    result = []

    for review in reviews:
        reasons: list[str] = []
        score = 0

        if any(word in review.text for word in INDUCEMENT_KEYWORDS):
            score += INDUCEMENT_SCORE
            reasons.append("inducement_keyword")

        if (
            review.rating == 5
            and review.author_reviews_count is not None
            and review.author_reviews_count <= 2
            and len(review.text.strip()) < 15
        ):
            score += FRESH_ACCOUNT_SCORE
            reasons.append("fresh_account_five_star")

        if review.rating == 5 and review.text.strip() in SHORT_PRAISES:
            score += SHORT_PRAISE_SCORE
            reasons.append("short_praise")

        review_datetime = resolve_review_datetime(review, scraped_at_utc)
        month = (
            review_datetime.strftime("%Y-%m")
            if review_datetime is not None
            else scraped_at_utc.strftime("%Y-%m")
        )

        result.append(
            CleanedReview(
                review=review,
                month=month,
                suspicious=score >= SUSPICIOUS_THRESHOLD,
                score=score,
                reasons=reasons,
                review_datetime=review_datetime,
            )
        )

    return result

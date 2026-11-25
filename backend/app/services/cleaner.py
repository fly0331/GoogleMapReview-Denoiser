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

@dataclass
class CleanedReview:
    review: ReviewInput
    month: str
    suspicious: bool
    score: int
    reasons: list[str]

def review_month(review: ReviewInput, scraped_at: datetime) -> str:
    if review.review_date:
        moment = review.review_date
    else:
        relative = (review.relative_time or "").strip().lower()
        match = re.search(r"(\d+)\s*(秒|分鐘|小時|天|週|星期|個月|月|年|second|minute|hour|day|week|month|year)s?\s*(前|ago)", relative)
        if match:
            amount, unit = int(match.group(1)), match.group(2)
            if unit in {"秒", "second"}: delta = timedelta(seconds=amount)
            elif unit in {"分鐘", "minute"}: delta = timedelta(minutes=amount)
            elif unit in {"小時", "hour"}: delta = timedelta(hours=amount)
            elif unit in {"天", "day"}: delta = timedelta(days=amount)
            elif unit in {"週", "星期", "week"}: delta = timedelta(weeks=amount)
            elif unit in {"個月", "月", "month"}: delta = timedelta(days=30 * amount)
            else: delta = timedelta(days=365 * amount)
            moment = scraped_at - delta
        else:
            moment = scraped_at
    return moment.strftime("%Y-%m")

def clean_reviews(reviews: list[ReviewInput], scraped_at: datetime) -> list[CleanedReview]:
    result = []
    for review in reviews:
        reasons: list[str] = []
        score = 0
        if any(word in review.text for word in INDUCEMENT_KEYWORDS):
            score += INDUCEMENT_SCORE
            reasons.append("inducement_keyword")
        if review.rating == 5 and review.author_reviews_count is not None and review.author_reviews_count <= 2 and len(review.text.strip()) < 15:
            score += FRESH_ACCOUNT_SCORE
            reasons.append("fresh_account_five_star")
        if review.rating == 5 and review.text.strip() in SHORT_PRAISES:
            score += SHORT_PRAISE_SCORE
            reasons.append("short_praise")
        result.append(CleanedReview(review, review_month(review, scraped_at), score >= SUSPICIOUS_THRESHOLD, score, reasons))
    return result

from datetime import timedelta
from app.services.cleaner import CleanedReview
from app.core.schemas import TimelineBucket

def build_timeline(reviews: list[CleanedReview], scraped_at) -> tuple[list[TimelineBucket], bool]:
    accepted = [item for item in reviews if not item.suspicious]
    grouped: dict[str, list[CleanedReview]] = {}
    for item in accepted:
        grouped.setdefault(item.month, []).append(item)
    timeline = []
    for month, rows in sorted(grouped.items()):
        negatives = sum(row.review.rating <= 3 for row in rows)
        timeline.append(TimelineBucket(month=month, review_count=len(rows), negative_count=negatives, negative_ratio=negatives / len(rows)))
    cutoff_month = (scraped_at - timedelta(days=60)).strftime("%Y-%m")
    recent = [row for row in accepted if row.month >= cutoff_month]
    recent_neg = sum(row.review.rating <= 3 for row in recent)
    recent_ratio = recent_neg / len(recent) if recent else 0.0
    historical = [row for row in accepted if row.month < cutoff_month]
    historical_ratio = (sum(row.review.rating <= 3 for row in historical) / len(historical)) if historical else 0.0
    alert = len(recent) >= 5 and recent_ratio > historical_ratio * 1.5
    return timeline, alert

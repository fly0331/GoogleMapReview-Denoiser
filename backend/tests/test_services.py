from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.core.schemas import AnalyzeRequest
from app.core.schemas import ReviewInput
from app.services.cleaner import clean_reviews, review_month
from app.services.timeline import build_timeline
from app.services.llm_absa import analyze_reviews, validate_evidence_ids
from app.core.schemas import LLMABSAOutput, ReviewAnalysis


def test_cleaner_flags_inducement_and_fresh_account(scraped_at):
    rows = [
        ReviewInput(review_id="normal", rating=5, text="服務很好"),
        ReviewInput(
            review_id="promo", rating=5, text="五星送小菜", author_reviews_count=20
        ),
        ReviewInput(review_id="new", rating=5, text="真的好吃", author_reviews_count=1),
    ]
    cleaned = clean_reviews(rows, scraped_at)
    assert [item.suspicious for item in cleaned] == [False, True, True]


def test_relative_month_supports_zh_and_en(scraped_at):
    assert (
        review_month(
            ReviewInput(review_id="a", rating=4, relative_time="2 週前"), scraped_at
        )
        == "2026-11"
    )
    assert (
        review_month(
            ReviewInput(review_id="b", rating=4, relative_time="3 個月前"), scraped_at
        )
        == "2026-08"
    )
    assert (
        review_month(
            ReviewInput(review_id="c", rating=4, relative_time="2 weeks ago"),
            scraped_at,
        )
        == "2026-11"
    )


def test_timeline_uses_only_clean_reviews_and_detects_recent_spike(scraped_at):
    rows = [
        ReviewInput(
            review_id=f"old{i}", rating=5, text="good", relative_time="6 months ago"
        )
        for i in range(10)
    ]
    rows += [
        ReviewInput(
            review_id=f"new{i}", rating=2, text="bad", relative_time="1 week ago"
        )
        for i in range(5)
    ]
    rows += [
        ReviewInput(
            review_id="spam", rating=5, text="五星送小菜", relative_time="1 week ago"
        )
    ]
    timeline, alert, historical_ratio = build_timeline(
        clean_reviews(rows, scraped_at),
        scraped_at,
    )
    assert historical_ratio == 0.0
    assert alert is True
    assert sum(bucket.review_count for bucket in timeline) == 15


def test_llm_mock_and_evidence_validation(monkeypatch):
    monkeypatch.setenv("MOCK_LLM", "true")
    rows = [ReviewInput(review_id="real", rating=5, text="nice")]
    out = analyze_reviews(rows)
    assert out.pros[0].evidence_review_ids == ["real"]
    bad = LLMABSAOutput(
        pros=[
            ReviewAnalysis(
                aspect="x",
                sentiment="positive",
                summary="x",
                evidence_review_ids=["real", "hallucinated"],
            )
        ]
    )
    assert validate_evidence_ids(bad, rows).pros[0].evidence_review_ids == ["real"]
    

def test_naive_timestamps_are_rejected():
    with pytest.raises(ValidationError):
        AnalyzeRequest.model_validate(
            {
                "place_id": "p1",
                "scraped_at": "2026-11-25T00:00:00",
                "reviews": [],
            }
        )

    with pytest.raises(ValidationError):
        ReviewInput(
            review_id="r1",
            rating=5,
            review_date="2026-11-20T12:00:00",
        )


def test_equivalent_offsets_are_normalized_to_utc():
    first = AnalyzeRequest.model_validate(
        {
            "place_id": "p1",
            "scraped_at": "2026-11-25T08:00:00+08:00",
            "reviews": [],
        }
    )
    second = AnalyzeRequest.model_validate(
        {
            "place_id": "p1",
            "scraped_at": "2026-11-25T00:00:00Z",
            "reviews": [],
        }
    )

    assert first.scraped_at == second.scraped_at
    assert first.scraped_at.utcoffset() == timedelta(0)


def test_review_date_is_normalized_to_utc():
    review = ReviewInput(
        review_id="r1",
        rating=5,
        review_date="2026-11-01T00:30:00+02:00",
    )

    assert review.review_date == datetime(
        2026, 10, 31, 22, 30, tzinfo=timezone.utc
    )


def test_exact_60_day_cutoff_is_included_in_recent_window(scraped_at):
    cutoff = scraped_at - timedelta(days=60)

    rows = [
        ReviewInput(
            review_id=f"recent{i}",
            rating=2,
            text="bad",
            review_date=cutoff,
        )
        for i in range(5)
    ]

    cleaned = clean_reviews(rows, scraped_at)
    timeline, alert, historical_ratio = build_timeline(cleaned, scraped_at)

    assert alert is False
    assert historical_ratio is None
    assert sum(bucket.review_count for bucket in timeline) == 5


def test_same_month_review_older_than_60_days_is_historical(scraped_at):
    old_date = datetime(2026, 9, 1, tzinfo=timezone.utc)
    cutoff = scraped_at - timedelta(days=60)

    assert old_date.strftime("%Y-%m") == cutoff.strftime("%Y-%m")
    assert old_date < cutoff

    rows = [
        ReviewInput(
            review_id="old",
            rating=5,
            text="good",
            review_date=old_date,
        )
    ]

    cleaned = clean_reviews(rows, scraped_at)
    _, _, historical_ratio = build_timeline(cleaned, scraped_at)

    assert historical_ratio == 0.0


def test_utc_month_boundary_is_used_for_month_grouping():
    scraped_at = datetime(2026, 11, 25, tzinfo=timezone.utc)

    review = ReviewInput(
        review_id="r1",
        rating=5,
        text="good",
        review_date="2026-11-01T00:30:00+02:00",
    )

    cleaned = clean_reviews([review], scraped_at)

    assert cleaned[0].month == "2026-10"


def test_historical_negative_ratio_is_weighted(scraped_at):
    old_date = scraped_at - timedelta(days=90)
    recent_date = scraped_at - timedelta(days=7)

    rows = [
        ReviewInput(
            review_id=f"old-negative-{i}",
            rating=2,
            text="bad",
            review_date=old_date,
        )
        for i in range(2)
    ]

    rows += [
        ReviewInput(
            review_id=f"old-positive-{i}",
            rating=5,
            text="good",
            review_date=old_date,
        )
        for i in range(8)
    ]

    rows += [
        ReviewInput(
            review_id=f"recent-negative-{i}",
            rating=2,
            text="bad",
            review_date=recent_date,
        )
        for i in range(5)
    ]

    cleaned = clean_reviews(rows, scraped_at)
    _, alert, historical_ratio = build_timeline(cleaned, scraped_at)

    assert historical_ratio == pytest.approx(0.2)
    assert alert is True


def test_no_historical_baseline_does_not_trigger_alert(scraped_at):
    rows = [
        ReviewInput(
            review_id=f"recent-{i}",
            rating=2,
            text="bad",
            relative_time="1 week ago",
        )
        for i in range(5)
    ]

    cleaned = clean_reviews(rows, scraped_at)
    _, alert, historical_ratio = build_timeline(cleaned, scraped_at)

    assert historical_ratio is None
    assert alert is False


def test_unknown_and_future_dates_do_not_affect_anomaly_statistics(scraped_at):
    future_date = scraped_at + timedelta(days=1)

    rows = [
        ReviewInput(
            review_id=f"recent-{i}",
            rating=2,
            text="bad",
            relative_time="1 week ago",
        )
        for i in range(4)
    ]

    rows.append(
        ReviewInput(
            review_id="future",
            rating=2,
            text="bad",
            review_date=future_date,
        )
    )

    rows.append(
        ReviewInput(
            review_id="unknown",
            rating=2,
            text="bad",
            relative_time="unknown",
        )
    )

    cleaned = clean_reviews(rows, scraped_at)
    _, alert, historical_ratio = build_timeline(cleaned, scraped_at)

    assert alert is False
    assert historical_ratio is None


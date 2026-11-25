from app.core.schemas import ReviewInput
from app.services.cleaner import clean_reviews, review_month
from app.services.timeline import build_timeline
from app.services.llm_absa import analyze_reviews, validate_evidence_ids
from app.core.schemas import LLMABSAOutput, ReviewAnalysis

def test_cleaner_flags_inducement_and_fresh_account(scraped_at):
    rows = [ReviewInput(review_id="normal", rating=5, text="服務很好"), ReviewInput(review_id="promo", rating=5, text="五星送小菜", author_reviews_count=20), ReviewInput(review_id="new", rating=5, text="真的好吃", author_reviews_count=1)]
    cleaned = clean_reviews(rows, scraped_at)
    assert [item.suspicious for item in cleaned] == [False, True, True]

def test_relative_month_supports_zh_and_en(scraped_at):
    assert review_month(ReviewInput(review_id="a", rating=4, relative_time="2 週前"), scraped_at) == "2026-11"
    assert review_month(ReviewInput(review_id="b", rating=4, relative_time="3 個月前"), scraped_at) == "2026-08"
    assert review_month(ReviewInput(review_id="c", rating=4, relative_time="2 weeks ago"), scraped_at) == "2026-11"

def test_timeline_uses_only_clean_reviews_and_detects_recent_spike(scraped_at):
    rows = [ReviewInput(review_id=f"old{i}", rating=5, text="good", relative_time="6 months ago") for i in range(10)]
    rows += [ReviewInput(review_id=f"new{i}", rating=2, text="bad", relative_time="1 week ago") for i in range(5)]
    rows += [ReviewInput(review_id="spam", rating=5, text="五星送小菜", relative_time="1 week ago")]
    timeline, alert = build_timeline(clean_reviews(rows, scraped_at), scraped_at)
    assert alert is True
    assert sum(bucket.review_count for bucket in timeline) == 15

def test_llm_mock_and_evidence_validation(monkeypatch):
    monkeypatch.setenv("MOCK_LLM", "true")
    rows = [ReviewInput(review_id="real", rating=5, text="nice")]
    out = analyze_reviews(rows)
    assert out.pros[0].evidence_review_ids == ["real"]
    bad = LLMABSAOutput(pros=[ReviewAnalysis(aspect="x", sentiment="positive", summary="x", evidence_review_ids=["real", "hallucinated"])])
    assert validate_evidence_ids(bad, rows).pros[0].evidence_review_ids == ["real"]

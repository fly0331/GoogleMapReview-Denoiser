from collections import Counter
from dataclasses import replace

import pytest

from app.core.schemas import ReviewInput
from app.services.cleaner_features import compare_with_legacy, extract_cleaner_features
from app.services.llm_absa import LLMInputLimitError, validate_gemini_input
from app.services.review_selection import select_reviews
from app.services.timeline import build_timeline


@pytest.fixture
def comparison_reviews():
    repeated_text = "牛肉麵湯頭濃郁，桌上有自助取用的餐具與開水。"
    history = [
        ("history-1", 1, "先點的餐漏單，店員找不到點餐記錄。"),
        ("history-2", 2, repeated_text),
        ("history-3", 3, "晚餐等了40分鐘，主菜上桌時已經冷了。"),
        ("history-4", 4, "Counter seating was quiet and the staff refilled my water."),
        ("history-5a", 5, repeated_text),
        ("history-5b", 5, repeated_text),
    ]
    recent = [
        ("recent-1", 1, "桌面很髒，要求換位後還是沒有擦拭。", None),
        ("near-a", 2, "牛肉麵的湯頭太鹹，牛腱燉得軟爛，中午來要排隊。", None),
        ("near-b", 3, "牛肉麵的湯頭太鹹，牛腱燉得軟嫩，中午來要排隊。", None),
        ("star-only", 1, "　 ", None),
        ("recent-5", 5, "窓際の席で抹茶ラテを飲みました。", None),
        ("incentivized", 5, "五星好評就送小菜，我就給了五星。", None),
        ("low-activity", 5, "好吃", 1),
        ("promotion", 4, "週年活動，消費滿五百元贈送甜點。", None),
        ("reported", 1, "店家要求五星好評才送飲料，我拒絕了。", None),
    ]
    return [
        ReviewInput(review_id=review_id, rating=rating, text=text, relative_time="4 個月前")
        for review_id, rating, text in history
    ] + [
        ReviewInput(
            review_id=review_id, rating=rating, text=text,
            relative_time="2 天前", author_reviews_count=author_count,
        )
        for review_id, rating, text, author_count in recent
    ]


def test_compare_legacy_and_candidate_on_same_batch(comparison_reviews, scraped_at):
    originals = [item.model_dump() for item in comparison_reviews]
    legacy, features = compare_with_legacy(comparison_reviews, scraped_at)
    keep_all = select_reviews(comparison_reviews, features)
    representative = select_reviews(comparison_reviews, features, exact_duplicates="representative")

    old_timeline = [row.review for row in legacy if not row.suspicious]
    old_llm = [review for review in old_timeline if review.text.strip()]
    new_timeline = [row.review for row in keep_all if row.timeline.included]
    new_llm = [row.review for row in keep_all if row.llm.included]
    deduped_llm = [row.review for row in representative if row.llm.included]

    # Fixed per-star numerators and denominators for both retention measures.
    for selected, expected in (
        (comparison_reviews, (4, 2, 2, 2, 5)),
        (old_timeline, (3, 2, 2, 1, 3)),
        (old_llm, (2, 2, 2, 1, 3)),
        (new_timeline, (4, 2, 2, 2, 5)),
        (new_llm, (3, 2, 2, 2, 5)),
        (deduped_llm, (3, 2, 2, 2, 4)),
    ):
        counts = Counter(row.rating for row in selected)
        assert tuple(counts[rating] for rating in range(1, 6)) == expected

    assert {review.review_id for review in new_llm} - {review.review_id for review in old_llm} == {
        "incentivized", "low-activity", "promotion", "reported",
    }
    assert any(set(pair.review_ids) == {"near-a", "near-b"} for pair in features.near_duplicate_pairs)
    assert [row.timeline for row in keep_all] == [row.timeline for row in representative]
    (removed,) = [row for row in representative if row.llm.reason == "same_text_and_rating"]
    kept_id = {"history-5a", "history-5b"} - {removed.review.review_id}
    assert removed.llm.representative_id in kept_id
    assert any(row.review_id == "history-2" for row in deduped_llm)
    # The representative variant preserves every raw text/rating combination in this batch.
    assert {(row.text, row.rating) for row in new_llm} == {(row.text, row.rating) for row in deduped_llm}

    old_timeline_buckets, old_alert, old_history = build_timeline(legacy, scraped_at)
    # For offline evaluation only, pass the selected rows to the existing date and alert policy.
    candidate_rows = [
        replace(cleaned, suspicious=False)
        for cleaned, selection in zip(legacy, keep_all, strict=True)
        if selection.timeline.included
    ]
    new_timeline_buckets, new_alert, new_history = build_timeline(candidate_rows, scraped_at)
    assert old_history == new_history == 0.5
    assert old_timeline_buckets[-1].negative_ratio == 4 / 5
    assert new_timeline_buckets[-1].negative_ratio == 5 / 9
    assert (old_alert, new_alert) == (True, False)
    assert [item.model_dump() for item in comparison_reviews] == originals


def test_timeline_does_not_consider_dates_and_selects_each_valid_id_once():
    reviews = [
        ReviewInput(review_id="unknown-date", rating=1, text="　 "),
        ReviewInput(review_id="unknown-date", rating=5, text="A conflicting second occurrence"),
        ReviewInput(review_id="future-date", rating=4, text="A legible English review", review_date="2030-01-01T00:00:00Z"),
        ReviewInput(review_id=" \t", rating=5, text="Missing ID"),
    ]
    selection = select_reviews(reviews, extract_cleaner_features(reviews))
    assert [row.timeline.reason for row in selection] == [
        "valid_unique_review", "repeated_review_id", "valid_unique_review", "blank_review_id",
    ]
    assert [row.llm.reason for row in selection] == [
        "blank_text", "repeated_review_id", "nonblank_text_within_budget", "blank_review_id",
    ]
    assert [row.review.rating for row in selection if row.timeline.included] == [1, 4]
    assert select_reviews([], extract_cleaner_features([])) == ()


def test_representatives_do_not_collapse_punctuation_or_rating_differences():
    texts = [
        "原本電話告知需要等候1.5小時才能安排窗邊座位",
        "原本電話告知需要等候15小時才能安排窗邊座位",
        "原本電話告知需要等候1.5小時才能安排窗邊座位",
    ]
    reviews = [
        ReviewInput(review_id=str(index), text=text, rating=rating)
        for index, (text, rating) in enumerate(zip(texts, (4, 4, 2), strict=True))
    ]
    features = extract_cleaner_features(reviews)
    assert len(features.duplicate_groups) == 1
    assert all(
        row.llm.included
        for row in select_reviews(reviews, features, exact_duplicates="representative")
    )


@pytest.mark.parametrize(
    ("lengths", "expected_count", "expected_chars", "excluded_reason"),
    [
        ([300] * 60, 50, 15_000, "review_count_limit"),
        ([4900] * 6 + [300], 5, 19_900, "text_character_limit"),
        ([400] * 50, 50, 20_000, None),
    ],
)
def test_candidate_uses_gemini_budget_without_rating_based_priority(
    lengths, expected_count, expected_chars, excluded_reason,
):
    reviews = [
        ReviewInput(review_id=f"review-{index}", rating=index % 5 + 1, text="文" * length)
        for index, length in enumerate(lengths)
    ]
    decisions = select_reviews(reviews, extract_cleaner_features(reviews))
    selected = [row.review for row in decisions if row.llm.included]
    assert all(row.timeline.included for row in decisions)
    assert len(selected) == expected_count
    assert sum(len(review.text) for review in selected) == expected_chars
    assert {row.llm.reason for row in decisions if not row.llm.included} == (
        {excluded_reason} if excluded_reason else set()
    )
    validate_gemini_input(selected)
    if excluded_reason:
        with pytest.raises(LLMInputLimitError):
            validate_gemini_input(reviews)

    reversed_and_mirrored = [
        row.model_copy(update={"rating": 6 - row.rating}) for row in reversed(reviews)
    ]
    mirrored = select_reviews(reversed_and_mirrored, extract_cleaner_features(reversed_and_mirrored))
    assert {row.review.review_id for row in mirrored if row.llm.included} == {
        row.review_id for row in selected
    }

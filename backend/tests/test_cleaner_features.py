import pytest
from fastapi.testclient import TestClient

from app import main
from app.core.schemas import LLMABSAOutput, ReviewInput
from app.services.cleaner_features import (
    DuplicateGroup,
    classify_information,
    compare_with_legacy,
    detect_incentive_signals,
    extract_cleaner_features,
)


@pytest.fixture
def sample_reviews():
    rows = [
        ("accepted", 5, "店員說五星好評就送小菜，我就給了五星", None),
        ("promotion", 5, "週年活動，消費滿５００元贈送甜點", None),
        ("five-star-service", 5, "五星級的服務品質", None),
        ("reported", 1, "店家要求五星好評才送飲料，我拒絕了", None),
        ("empty", 4, "　 ", None),
        ("generic", 5, "好吃", None),
        ("specific", 2, "等了半小時", None),
        ("low-activity", 5, "等了半小時", 1),
        ("duplicate-a", 4, "牛肉麵湯頭很濃郁，桌上附 Ａ５ 號餐具盒！", None),
        ("duplicate-b", 2, "牛肉麵湯頭很濃郁。桌上附A5號餐具盒。", None),
        ("generic-copy", 2, "好 吃！", 0),
        ("social", 5, "IG打卡就送飲料", None),
        ("uncertain", 3, "評論提到週年活動", None),
    ]
    return [
        ReviewInput(
            review_id=review_id,
            rating=rating,
            text=text,
            author_reviews_count=author_count,
            relative_time="2 天前",
        )
        for review_id, rating, text, author_count in rows
    ]


def test_feature_comparison_against_legacy(sample_reviews, scraped_at):
    originals = [review.model_dump() for review in sample_reviews]
    legacy, extracted = compare_with_legacy(sample_reviews, scraped_at)
    new = {review.review_id: review for review in extracted.reviews}

    assert [row.review.review_id for row in legacy if row.suspicious] == [
        "accepted", "promotion", "five-star-service", "reported",
        "low-activity", "social", "uncertain",
    ]
    assert {
        review_id: [signal.kind for signal in row.incentive_signals]
        for review_id, row in new.items()
        if row.incentive_signals
    } == {
        "accepted": ["accepted_exchange"],
        "promotion": ["general_promotion"],
        "reported": ["reported_exchange"],
        "social": ["social_check_in"],
        "uncertain": ["uncertain"],
    }
    assert new["accepted"].incentive_signals[0].action == "five_star_rating"
    assert new["reported"].incentive_signals[0].reason == "review_reward_declined"
    assert new["empty"].information_quality.kind == "no_text"
    assert new["generic"].information_quality.kind == "generic"
    assert new["generic-copy"].information_quality.kind == "generic"
    assert new["five-star-service"].information_quality.kind == "uncertain"
    assert new["specific"].information_quality == new["low-activity"].information_quality
    assert new["specific"].information_quality.reason == "wait_duration"
    assert new["low-activity"].author_reviews_count == 1
    assert new["low-activity"].incentive_signals == ()
    assert extracted.duplicate_groups == (DuplicateGroup(("duplicate-a", "duplicate-b")),)
    assert [review.model_dump() for review in sample_reviews] == originals
    assert extract_cleaner_features(sample_reviews) == extracted


@pytest.mark.parametrize(
    ("text", "kind", "action"),
    [
        ("我寫了評論換到甜點", "accepted_exchange", "review"),
        ("店員說寫評論就送飲料", "reported_exchange", "review"),
        ("店員告訴我寫評論就送飲料", "personal_offer", "review"),
        ("店員說給五星就送小菜，我就寫了負評", "reported_exchange", "five_star_rating"),
        ("五星送小菜", "explicit_exchange", "five_star_rating"),
        ("留下５顆星評論即可領小菜", "explicit_exchange", "five_star_rating"),
        ("沒有要求五星才送小菜", "uncertain", "five_star_rating"),
        ("如果五星送小菜，我就給了五星", "uncertain", "five_star_rating"),
        ("這則評論介紹店家的折扣活動", "uncertain", "review"),
        ("五星飯店周年活動", "general_promotion", None),
        ("普通招待", "general_promotion", None),
        ("贈送", "general_promotion", None),
        ("我們拍照打卡", "social_check_in", "social_check_in"),
    ],
)
def test_incentive_context(text, kind, action):
    (signal,) = detect_incentive_signals(text)
    assert (signal.kind, signal.action) == (kind, action)
    assert signal.reason and signal.excerpt


@pytest.mark.parametrize("text", ["", "五星", "五星級的服務", "用餐之後才回家"])
def test_no_incentive_signal_for_standalone_rating(text):
    assert detect_incentive_signals(text) == ()


@pytest.mark.parametrize(
    ("text", "kind", "reason"),
    [
        (" \t　", "no_text", "blank_or_whitespace"),
        ("很棒！", "generic", "generic_evaluation_phrase"),
        ("很差！", "generic", "generic_evaluation_phrase"),
        ("等３５分鐘", "specific", "wait_duration"),
        ("湯頭濃郁", "specific", "specific_experience"),
        ("漏單", "specific", "specific_experience"),
        ("一碗１５０元", "specific", "price_or_spending"),
        ("這是我和朋友一起來的一次經驗，印象有點模糊", "uncertain", "no_recognized_detail_or_generic_phrase"),
    ],
)
def test_information_quality(text, kind, reason):
    quality = classify_information(text)
    assert (quality.kind, quality.reason) == (kind, reason)


def test_duplicate_groups_require_distinct_ids_and_exact_normalized_text(sample_reviews):
    duplicate = sample_reviews[8]
    similar = duplicate.model_copy(update={"review_id": "similar", "text": duplicate.text.replace("號", "個")})
    assert extract_cleaner_features([duplicate, duplicate, similar]).duplicate_groups == ()
    assert extract_cleaner_features([]).duplicate_groups == ()


def test_api_selection_is_independent_of_shadow_comparison(client, sample_reviews, scraped_at, monkeypatch):
    payload = {
        "place_id": "feature-extraction-test",
        "scraped_at": scraped_at.isoformat(),
        "reviews": [review.model_dump(mode="json") for review in sample_reviews],
    }
    llm_inputs = []

    def fake_analyze(reviews):
        llm_inputs.append([review.review_id for review in reviews])
        return LLMABSAOutput(decision_pros="", decision_cons="")

    monkeypatch.setattr(main, "analyze_reviews", fake_analyze)
    with TestClient(client) as http:
        before = http.post("/api/v1/analyze", json=payload)
        assert before.status_code == 200

        compare_with_legacy(sample_reviews, scraped_at)

        main.cache.delete(payload["place_id"])
        after = http.post("/api/v1/analyze", json=payload)
        assert after.status_code == 200

    assert after.json() == before.json()
    body = after.json()
    assert body["cache_hit"] is False
    assert body["analyzed_count"] == 12
    assert {"metrics", "timeline", "anomaly_alert", "suspicious_reasons_breakdown"}.isdisjoint(body)
    assert llm_inputs == [
        [
            "accepted", "promotion", "five-star-service", "reported", "generic", "specific",
            "low-activity", "duplicate-a", "duplicate-b", "generic-copy", "social", "uncertain",
        ],
    ] * 2

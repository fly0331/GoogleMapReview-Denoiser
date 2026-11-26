from collections import Counter
from math import inf, nextafter
from unittest.mock import patch

import pytest

from app.core.schemas import ReviewInput
from app.services import review_similarity
from app.services.cleaner_features import extract_cleaner_features
from app.services.review_similarity import (
    SimilarityConfig,
    character_ngrams,
    cosine_similarity,
    normalize_comparison_text,
)


SAMPLE_PAIRS = [
    (
        "minor_edit",
        "牛肉麵的湯頭濃郁，牛腱燉得軟嫩，下午來不用排隊。",
        "牛肉麵的湯頭濃郁，牛腱燉得軟爛，下午來不用排隊。",
    ),
    (
        "promotion_template",
        "店員介紹今日限定套餐，留下五星評論就送一杯飲料，餐點美味服務親切。",
        "店員介紹本日限定套餐，留下五星評價就送一份飲料，餐點美味服務親切。",
    ),
    (
        "opposite_experience",
        "牛肉麵的湯頭濃郁，牛腱燉得軟嫩，下午來不用排隊。",
        "牛肉麵的湯頭不濃郁，牛腱燉得不軟嫩，下午來要排隊。",
    ),
    (
        "shared_dish_only",
        "牛肉麵的湯頭濃郁，牛腱燉得軟嫩，下午來不用排隊。",
        "牛肉麵有點涼，外帶時忘了附筷子，回家才發現。",
    ),
    (
        "common_wording",
        "用餐環境乾淨整潔，服務人員親切有禮，下次還會再來。",
        "用餐環境乾淨整潔，服務人員親切有禮，下次願意再來。",
    ),
    (
        "unrelated",
        "咖啡奶泡細密，靠窗桌面採光明亮，適合讀書。",
        "地下停車必須登記車牌，出口窄，附近巷弄有施工。",
    ),
]

EXPECTED_SCORES = {
    "minor_edit": (0.9000, 0.8421),
    "promotion_template": (0.7931, 0.6786),
    "opposite_experience": (0.7319, 0.5643),
    "shared_dish_only": (0.1054, 0.0556),
    "common_wording": (0.8571, 0.8000),
    "unrelated": (0.0000, 0.0000),
}


def test_character_ngram_frequencies_and_short_input():
    assert character_ngrams("好吃好吃", 2) == Counter({"好吃": 2, "吃好": 1})
    assert character_ngrams("好吃好吃", 3) == Counter({"好吃好": 1, "吃好吃": 1})
    assert character_ngrams("好吃", 2) == Counter({"好吃": 1})
    assert character_ngrams("好吃", 3) == Counter()
    assert character_ngrams("", 2) == Counter()


def test_cosine_similarity_of_frequency_vectors():
    first = Counter({"牛肉": 2, "肉麵": 1})
    second = Counter({"牛肉": 1})
    assert cosine_similarity(first, second) == pytest.approx(2 / 5**0.5)
    assert cosine_similarity(first, second) == cosine_similarity(second, first)
    assert cosine_similarity(first, first) == 1
    assert cosine_similarity(first, Counter({"甜點": 1})) == 0
    assert cosine_similarity(first, Counter()) == 0
    assert cosine_similarity(Counter(), Counter()) == 0


@pytest.mark.parametrize(
    "options",
    [{"ngram_size": 1}, {"threshold": -0.1}, {"threshold": 1.1},
     {"threshold": float("nan")}, {"min_text_length": 0}],
)
def test_similarity_config_rejects_invalid_values(options):
    with pytest.raises(ValueError):
        SimilarityConfig(**options)


@pytest.mark.parametrize(("name", "first", "second"), SAMPLE_PAIRS)
def test_similarity_thresholds_on_fixed_chinese_pairs(name, first, second):
    reviews = [
        ReviewInput(review_id="a", rating=5, text=first),
        ReviewInput(review_id="b", rating=2, text=second),
    ]
    for size in (2, 3):
        vectors = [character_ngrams(normalize_comparison_text(review.text), size) for review in reviews]
        score = cosine_similarity(*vectors)
        assert score == pytest.approx(EXPECTED_SCORES[name][size - 2], abs=0.00005)
        for threshold in (0.70, 0.80, 0.90):
            extracted = extract_cleaner_features(
                reviews, similarity_config=SimilarityConfig(ngram_size=size, threshold=threshold),
            )
            assert not extracted.duplicate_groups, name
            if score < threshold:
                assert not extracted.near_duplicate_pairs, name
            else:
                (pair,) = extracted.near_duplicate_pairs
                assert pair.review_ids == ("a", "b")
                assert pair.similarity == score
                assert pair.ngram_size == size
                assert pair.reason == "character_ngram_cosine"


def test_exact_matches_are_not_reported_twice_and_raw_text_is_preserved():
    original = "今日在窗邊吃牛肉麵，外帶附 Ａ５ 號餐具盒。"
    reviews = [
        ReviewInput(review_id="a", rating=4, text=original),
        ReviewInput(review_id="b", rating=5, text=original),
        ReviewInput(review_id="c", rating=2, text="今日在窗邊吃牛肉麵！外帶附A5號餐具盒"),
        ReviewInput(review_id="d", rating=5, text=original.replace("牛肉", "羊肉")),
        ReviewInput(review_id="empty", rating=5, text=""),
        ReviewInput(review_id="generic", rating=4, text="好吃"),
        ReviewInput(review_id="generic-copy", rating=2, text="好 吃！"),
        ReviewInput(review_id="short", rating=2, text="漏單"),
    ]
    result = extract_cleaner_features(reviews, similarity_config=SimilarityConfig(threshold=0))
    assert [group.review_ids for group in result.duplicate_groups] == [("a", "b", "c")]
    assert [pair.review_ids for pair in result.near_duplicate_pairs] == [("a", "d"), ("b", "d"), ("c", "d")]
    assert reviews[0].text == original
    assert reviews[2].text == "今日在窗邊吃牛肉麵！外帶附A5號餐具盒"


def test_similarity_threshold_is_inclusive_and_minimum_length_is_configurable():
    reviews = [
        ReviewInput(review_id="a", rating=5, text="餐廳服務真好"),
        ReviewInput(review_id="b", rating=2, text="餐廳服務真差"),
    ]
    assert len(extract_cleaner_features(
        reviews, similarity_config=SimilarityConfig(threshold=0.80, min_text_length=6),
    ).near_duplicate_pairs) == 1
    assert not extract_cleaner_features(
        reviews, similarity_config=SimilarityConfig(threshold=nextafter(0.80, inf), min_text_length=6),
    ).near_duplicate_pairs
    assert not extract_cleaner_features(
        reviews, similarity_config=SimilarityConfig(threshold=0.80, min_text_length=7),
    ).near_duplicate_pairs


def test_generic_and_empty_reviews_are_excluded_even_with_a_low_length_floor():
    reviews = [
        ReviewInput(review_id="a", rating=5, text="真的好吃"),
        ReviewInput(review_id="b", rating=2, text="真的難吃"),
        ReviewInput(review_id="c", rating=2, text="真的好吃！"),
        ReviewInput(review_id="empty", rating=4, text="　\t"),
    ]
    result = extract_cleaner_features(
        reviews, similarity_config=SimilarityConfig(threshold=0, min_text_length=2),
    )
    assert not result.duplicate_groups
    assert not result.near_duplicate_pairs


def test_different_text_can_have_identical_ngram_frequency_vectors():
    reviews = [
        ReviewInput(review_id="a", rating=4, text="abaca"),
        ReviewInput(review_id="b", rating=3, text="acaba"),
    ]
    result = extract_cleaner_features(
        reviews, similarity_config=SimilarityConfig(threshold=1, min_text_length=5),
    )
    assert not result.duplicate_groups
    (pair,) = result.near_duplicate_pairs
    assert pair.similarity == 1


def test_direct_pairs_are_not_transitively_grouped():
    texts = ("甲乙丙丁戊己庚辛壬癸子丑", "甲乙丙丁戊己庚辛壬癸子寅", "申乙丙丁戊己庚辛壬癸子寅")
    result = extract_cleaner_features(
        [ReviewInput(review_id=letter, rating=3, text=text) for letter, text in zip("abc", texts)],
        similarity_config=SimilarityConfig(threshold=0.90),
    )
    assert [pair.review_ids for pair in result.near_duplicate_pairs] == [("a", "b"), ("b", "c")]


@pytest.mark.parametrize(
    ("first", "second", "normalized", "equivalent"),
    [
        (
            "The café had warm lighting and a quiet corner.",
            "The café had warm lighting and a quiet counter.",
            "Thecaféhadwarmlightingandaquietcorner",
            "Ｔｈｅ cafe\u0301 had warm lighting — and a quiet corner!",
        ),
        (
            "窓際の席で抹茶ラテを飲みました。",
            "窓際の席で抹茶ラテを頼みました。",
            "窓際の席で抹茶ラテを飲みました",
            "「窓際の席で」抹茶ﾗﾃを 飲みました！",
        ),
    ],
    ids=["english", "japanese"],
)
def test_similarity_and_normalization_are_language_agnostic(first, second, normalized, equivalent):
    assert normalize_comparison_text(first) == normalize_comparison_text(equivalent) == normalized
    reviews = [
        ReviewInput(review_id="a", rating=5, text=first),
        ReviewInput(review_id="b", rating=3, text=second),
    ]
    result = extract_cleaner_features(
        reviews, similarity_config=SimilarityConfig(ngram_size=3, threshold=0.75),
    )
    assert [review.information_quality.kind for review in result.reviews] == ["uncertain", "uncertain"]
    (pair,) = result.near_duplicate_pairs
    assert pair.review_ids == ("a", "b")
    assert 0.75 <= pair.similarity < 1


def test_repeated_and_conflicting_ids_do_not_produce_extra_pairs():
    first = ReviewInput(review_id="a", rating=5, text=SAMPLE_PAIRS[0][1])
    second = ReviewInput(review_id="b", rating=3, text=SAMPLE_PAIRS[0][2])
    conflict = first.model_copy(update={"text": second.text})
    assert [pair.review_ids for pair in extract_cleaner_features([first, first, second]).near_duplicate_pairs] == [
        ("a", "b"),
    ]
    assert not extract_cleaner_features([first, second, conflict]).near_duplicate_pairs


def test_50_reviews_reuse_vectors_and_compare_each_unordered_pair_once():
    reviews = [
        ReviewInput(review_id=str(index), rating=3, text=f"牛肉麵湯頭濃郁這是第{index}次到訪")
        for index in range(50)
    ]
    with (
        patch.object(review_similarity, "character_ngrams", wraps=character_ngrams) as vectors,
        patch.object(review_similarity, "_cosine", wraps=review_similarity._cosine) as comparisons,
    ):
        result = extract_cleaner_features(reviews, similarity_config=SimilarityConfig(threshold=0.01))
    assert vectors.call_count == 50
    assert comparisons.call_count == 1225
    assert len(result.near_duplicate_pairs) == len({
        frozenset(pair.review_ids) for pair in result.near_duplicate_pairs
    }) == 1225

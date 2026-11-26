import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.core.schemas import ReviewInput
from app.services.cleaner import CleanedReview, clean_reviews
from app.services.review_similarity import (
    DuplicateGroup,
    NearDuplicatePair,
    SimilarityConfig,
    find_exact_duplicates,
    find_near_duplicates,
    normalize_comparison_text,
)


IncentiveKind = Literal[
    "accepted_exchange",
    "personal_offer",
    "reported_exchange",
    "explicit_exchange",
    "general_promotion",
    "social_check_in",
    "uncertain",
]
ReviewAction = Literal["review", "five_star_rating", "social_check_in"]
QualityKind = Literal["no_text", "generic", "specific", "uncertain"]


@dataclass(frozen=True)
class IncentiveSignal:
    kind: IncentiveKind
    action: ReviewAction | None
    reason: str
    excerpt: str


@dataclass(frozen=True)
class InformationQuality:
    kind: QualityKind
    reason: str


@dataclass(frozen=True)
class ReviewFeatures:
    review_id: str
    author_reviews_count: int | None
    incentive_signals: tuple[IncentiveSignal, ...]
    information_quality: InformationQuality


@dataclass(frozen=True)
class CleanerFeatures:
    reviews: tuple[ReviewFeatures, ...]
    duplicate_groups: tuple[DuplicateGroup, ...]
    near_duplicate_pairs: tuple[NearDuplicatePair, ...] = ()


FIVE_STAR = r"(?:五星|5\s*(?:顆)?星)(?!級|飯店|酒店|旅館)(?:好評|評價|評論)?"
REVIEW = r"(?:[寫留給發貼改刪](?:了|個|一則)?(?:Google\s*)?(?:評論|評價|好評|負評)|評論|評價|好評)"
SOCIAL_CHECK_IN = r"打卡"
REWARD = r"(?:送|贈|招待|請客|折扣|優惠|折抵|免費|抽獎|回饋|小菜|甜點|飲料|贈品|餐點)"
EXCHANGE = re.compile(
    rf"(?:(?P<five_star>{FIVE_STAR})|(?P<review>{REVIEW})|(?P<check_in>{SOCIAL_CHECK_IN}))"
    rf"[，、:\s]*(?:(?:即可|才能|才會|就可以|就能|就會|就|才|可以|可|能|會|換取|換到|換|兌換)"
    rf"(?:得到|拿到|領到|有|領|拿)?\s*{REWARD}|(?:送|贈送|贈)(?:一份|一杯)?(?:小菜|甜點|飲料|贈品|餐點))",
    re.IGNORECASE,
)
REVIEW_MENTION = re.compile(rf"{FIVE_STAR}|{REVIEW}", re.IGNORECASE)
PROMOTION = re.compile(r"促銷|活動|優惠|贈送|招待|抽獎|送小菜|老闆請|折扣")
DENIAL = re.compile(
    r"沒有(?:要求|規定)|沒要求|並非|不是.{0,12}(?:才|就)|取消.{0,5}(?:活動|優惠)"
    r"|(?:不必|不需要|不用)\s*(?:五星|給|留|寫|評|打卡)"
)
HYPOTHETICAL = re.compile(r"^(?:如果|假如|要是|假設)")
REPORT = re.compile(r"(?:店家|店員|老闆|櫃台|服務生).{0,8}(?:說|告知|要求|規定|表示)")
DECLINED = re.compile(r"拒絕|沒答應|沒有答應|我沒(?:給|留|寫|打|評)")
PERSONAL_OFFER = re.compile(r"我(?:被要求|被告知)|(?:問|跟|對)我說|要求我|告訴我")
FIRST_PERSON_ACTION = r"我(?:也)?(?:就|才|因此|於是|只好)[給留寫打評](?:了)?"
COMPLETED_ACTION = r"我[給留寫打評]了"
RECEIVED_REWARD = r".{0,20}(?:換到|拿到|領到)"
FOLLOWED_CONDITION = r"我(?:就)?照做"
ACCEPTANCE = {
    "five_star_rating": re.compile(
        rf"{FOLLOWED_CONDITION}|{FIRST_PERSON_ACTION}{FIVE_STAR}|"
        rf"{COMPLETED_ACTION}{FIVE_STAR}{RECEIVED_REWARD}"
    ),
    "review": re.compile(
        rf"{FOLLOWED_CONDITION}|{FIRST_PERSON_ACTION}(?:評論|評價|好評)|"
        rf"{COMPLETED_ACTION}(?:評論|評價|好評){RECEIVED_REWARD}"
    ),
}
SENTENCES = re.compile(r"[。.!！?？;；\r\n]+")
GENERIC_QUALITY = re.compile(
    r"(?:真的|非常|超|很|太)?"
    r"(?:好吃|難吃|不好吃|好喝|難喝|好|差|棒|讚|推|推薦|不推薦|喜歡|不喜歡|不錯|"
    r"還可以|普通|一般|還好|不滿意|失望|服務(?:很)?[好差]|[好差]評)"
    r"(?:了|喔|唷|啊|啦|耶)?"
)
DETAIL_PATTERNS = (
    ("wait_duration", re.compile(r"(?:等候|等待|等|排隊).{0,5}(?:半小時|[0-9一二兩三四五六七八九十百]+(?:多|個)?\s*(?:分鐘|小時))")),
    ("price_or_spending", re.compile(r"(?:\bNT\$?\s*|[$＄]\s*)\d+|[0-9一二兩三四五六七八九十百千]+\s*(?:元|塊錢)", re.IGNORECASE)),
    ("specific_experience", re.compile(
        r"(?:湯頭|外皮|麵條|肉質|份量|座位|桌面|廁所|出餐|上菜).{0,8}"
        r"(?:濃郁|清淡|酥脆|軟爛|紮實|乾柴|夠|太少|太多|擁擠|寬敞|油膩|乾淨|髒|很快|很慢|太慢)"
        r"|漏單|送錯餐|沒有找零|主動加水|換了一道菜"
    )),
)
# Short identical phrases are common. This is a candidate cutoff for review, not a risk score.
MIN_DUPLICATE_TEXT_LENGTH = 12


def classify_information(text: str) -> InformationQuality:
    """Classify the text itself, without using rating or author metadata."""
    normalized = unicodedata.normalize("NFKC", text)
    if not normalized.strip():
        return InformationQuality("no_text", "blank_or_whitespace")
    for reason, pattern in DETAIL_PATTERNS:
        if pattern.search(normalized):
            return InformationQuality("specific", reason)
    if GENERIC_QUALITY.fullmatch(normalize_comparison_text(normalized)):
        return InformationQuality("generic", "generic_evaluation_phrase")
    return InformationQuality("uncertain", "no_recognized_detail_or_generic_phrase")


def detect_incentive_signals(text: str) -> tuple[IncentiveSignal, ...]:
    """Identify statements about incentives, without inferring review authenticity."""
    signals = []
    normalized = unicodedata.normalize("NFKC", text)
    for sentence in SENTENCES.split(normalized):
        sentence = sentence.strip()
        matches = list(EXCHANGE.finditer(sentence))
        for match in matches:
            action: ReviewAction
            if match.group("five_star"):
                action = "five_star_rating"
            elif match.group("review"):
                action = "review"
            else:
                action = "social_check_in"

            if DENIAL.search(sentence) or HYPOTHETICAL.search(sentence):
                signal = IncentiveSignal("uncertain", action, "exchange_in_negated_or_hypothetical_context", sentence)
            elif action == "social_check_in":
                signal = IncentiveSignal("social_check_in", action, "check_in_linked_to_reward", match[0])
            elif DECLINED.search(sentence):
                signal = IncentiveSignal("reported_exchange", action, "review_reward_declined", sentence)
            elif ACCEPTANCE[action].search(sentence):
                signal = IncentiveSignal("accepted_exchange", action, "first_person_compliance_with_exchange", sentence)
            elif PERSONAL_OFFER.search(sentence):
                signal = IncentiveSignal("personal_offer", action, "review_reward_addressed_to_author", sentence)
            elif REPORT.search(sentence):
                signal = IncentiveSignal("reported_exchange", action, "review_reward_attributed_to_business", sentence)
            else:
                signal = IncentiveSignal("explicit_exchange", action, "review_action_linked_to_reward_role_unknown", match[0])
            if signal not in signals:
                signals.append(signal)

        if matches:
            continue
        promotion = PROMOTION.search(sentence)
        mention = REVIEW_MENTION.search(sentence)
        if promotion and mention:
            action = "five_star_rating" if re.match(FIVE_STAR, mention[0]) else "review"
            signals.append(IncentiveSignal("uncertain", action, "review_and_promotion_without_clear_link", sentence))
        elif "打卡" in sentence:
            signals.append(IncentiveSignal("social_check_in", "social_check_in", "social_check_in_mention", sentence))
        elif promotion:
            signals.append(IncentiveSignal("general_promotion", None, "promotion_without_review_condition", promotion[0]))
    return tuple(signals)


def extract_cleaner_features(
    reviews: list[ReviewInput],
    *,
    similarity_config: SimilarityConfig = SimilarityConfig(),
) -> CleanerFeatures:
    """Extract batch features without changing input reviews or selecting any for exclusion."""
    features = []
    candidate_groups: dict[str, dict[str, None]] = {}
    for review in reviews:
        quality = classify_information(review.text)
        features.append(ReviewFeatures(
            review_id=review.review_id,
            author_reviews_count=review.author_reviews_count,
            incentive_signals=detect_incentive_signals(review.text),
            information_quality=quality,
        ))
        key = normalize_comparison_text(review.text)
        if key and quality.kind != "generic":
            candidate_groups.setdefault(key, {})[review.review_id] = None

    return CleanerFeatures(
        reviews=tuple(features),
        duplicate_groups=find_exact_duplicates(candidate_groups, MIN_DUPLICATE_TEXT_LENGTH),
        near_duplicate_pairs=find_near_duplicates(candidate_groups, similarity_config),
    )


def compare_with_legacy(
    reviews: list[ReviewInput],
    scraped_at: datetime,
    *,
    similarity_config: SimilarityConfig = SimilarityConfig(),
) -> tuple[list[CleanedReview], CleanerFeatures]:
    """Compare legacy decisions and feature annotations on the same ordered batch."""
    return clean_reviews(reviews, scraped_at), extract_cleaner_features(
        reviews, similarity_config=similarity_config,
    )

from dataclasses import dataclass
from hashlib import sha256
from typing import TYPE_CHECKING, Literal

from app.core.schemas import ReviewInput
from app.services.llm_absa import MAX_GEMINI_INPUT_CHARS, MAX_GEMINI_REVIEWS

if TYPE_CHECKING:
    from app.services.cleaner_features import CleanerFeatures


ExactDuplicateMode = Literal["keep_all", "representative"]
SelectionReason = Literal[
    "valid_unique_review",
    "nonblank_text_within_budget",
    "blank_review_id",
    "repeated_review_id",
    "blank_text",
    "same_text_and_rating",
    "review_count_limit",
    "text_character_limit",
]


@dataclass(frozen=True)
class Inclusion:
    included: bool
    reason: SelectionReason
    representative_id: str | None = None


@dataclass(frozen=True)
class ReviewSelection:
    review: ReviewInput
    timeline: Inclusion
    llm: Inclusion


def select_reviews(
    reviews: list[ReviewInput],
    features: "CleanerFeatures",
    *,
    exact_duplicates: ExactDuplicateMode = "keep_all",
) -> tuple[ReviewSelection, ...]:
    """Evaluate a candidate policy. Features must come from the same batch."""
    duplicate_ids = set()
    if exact_duplicates == "representative":
        duplicate_ids = {
            review_id for group in features.duplicate_groups for review_id in group.review_ids
        }
    return tuple(
        ReviewSelection(
            review,
            decision if decision.reason in ("blank_review_id", "repeated_review_id")
            else Inclusion(True, "valid_unique_review"),
            decision,
        )
        for review, decision in zip(reviews, _select_llm_inclusions(reviews, duplicate_ids), strict=True)
    )


def select_llm_reviews(reviews: list[ReviewInput]) -> list[ReviewInput]:
    """Apply keep_all using only identifiers, text presence and the Gemini budget."""
    return [
        review
        for review, decision in zip(reviews, _select_llm_inclusions(reviews, set()), strict=True)
        if decision.included
    ]


def _select_llm_inclusions(reviews: list[ReviewInput], duplicate_ids: set[str]) -> list[Inclusion]:
    seen_ids = set()
    llm: dict[int, Inclusion] = {}
    candidates = []

    for index, review in enumerate(reviews):
        if not review.review_id.strip():
            rejected = Inclusion(False, "blank_review_id")
        elif review.review_id in seen_ids:
            rejected = Inclusion(False, "repeated_review_id")
        else:
            rejected = None

        if rejected:
            llm[index] = rejected
            continue

        # The first row for an ID is authoritative.
        seen_ids.add(review.review_id)
        if review.text.strip():
            candidates.append(index)
        else:
            llm[index] = Inclusion(False, "blank_text")

    representatives: dict[tuple[int, str], str] = {}
    remaining_reviews = MAX_GEMINI_REVIEWS
    remaining_chars = MAX_GEMINI_INPUT_CHARS

    # Use ID-only priority when allocating budget. Decisions are returned in input order.
    for index in sorted(candidates, key=lambda index: sha256(reviews[index].review_id.encode()).digest()):
        review = reviews[index]
        # Normalization can erase punctuation that changes meaning. Require identical raw text
        # and rating before treating a Phase 1 exact match as redundant for the LLM.
        key = (review.rating, review.text) if review.review_id in duplicate_ids else None
        representative = representatives.get(key) if key is not None else None

        if representative is not None:
            llm[index] = Inclusion(False, "same_text_and_rating", representative)
        elif remaining_reviews == 0:
            llm[index] = Inclusion(False, "review_count_limit")
        elif len(review.text) > remaining_chars:
            llm[index] = Inclusion(False, "text_character_limit")
        else:
            llm[index] = Inclusion(True, "nonblank_text_within_budget")
            remaining_reviews -= 1
            remaining_chars -= len(review.text)
            if key is not None:
                representatives[key] = review.review_id

    return [llm[index] for index in range(len(reviews))]

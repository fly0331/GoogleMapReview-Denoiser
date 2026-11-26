import unicodedata
from collections import Counter
from dataclasses import dataclass
from itertools import combinations, product
from math import sqrt
from typing import Literal


@dataclass(frozen=True)
class SimilarityConfig:
    """Candidate settings for evaluation. These thresholds are not calibrated."""

    ngram_size: int = 2
    threshold: float = 0.80
    min_text_length: int = 12

    def __post_init__(self) -> None:
        if self.ngram_size < 2:
            raise ValueError("ngram_size must be at least 2")
        if not 0 <= self.threshold <= 1:
            raise ValueError("threshold must be between 0 and 1")
        if self.min_text_length < 1:
            raise ValueError("min_text_length must be positive")


@dataclass(frozen=True)
class DuplicateGroup:
    review_ids: tuple[str, ...]
    reason: Literal["same_normalized_text"] = "same_normalized_text"


@dataclass(frozen=True)
class NearDuplicatePair:
    review_ids: tuple[str, str]
    similarity: float
    ngram_size: int
    reason: Literal["character_ngram_cosine"] = "character_ngram_cosine"


def normalize_comparison_text(text: str) -> str:
    """Apply NFKC and remove Unicode whitespace and punctuation."""
    return "".join(
        char for char in unicodedata.normalize("NFKC", text)
        if not char.isspace() and not unicodedata.category(char).startswith("P")
    )


def character_ngrams(text: str, size: int) -> Counter[str]:
    """Count overlapping character N-grams in comparison text."""
    if size < 2:
        raise ValueError("N-gram size must be at least 2")
    return Counter(text[index:index + size] for index in range(len(text) - size + 1))


def _squared_norm(vector: Counter[str]) -> int:
    return sum(count * count for count in vector.values())


def _cosine(first: Counter[str], second: Counter[str], squared_norm_product: int) -> float:
    if not squared_norm_product:
        return 0.0
    if len(first) > len(second):
        first, second = second, first
    dot_product = sum(count * second[gram] for gram, count in first.items())
    return min(1.0, max(0.0, dot_product / sqrt(squared_norm_product)))


def cosine_similarity(first: Counter[str], second: Counter[str]) -> float:
    """Compare frequency vectors. A zero vector has similarity zero."""
    return _cosine(first, second, _squared_norm(first) * _squared_norm(second))


def find_exact_duplicates(
    ids_by_text: dict[str, dict[str, None]],
    min_text_length: int,
) -> tuple[DuplicateGroup, ...]:
    return tuple(
        DuplicateGroup(tuple(review_ids))
        for text, review_ids in ids_by_text.items()
        if len(text) >= min_text_length and len(review_ids) > 1
    )


def find_near_duplicates(
    ids_by_text: dict[str, dict[str, None]],
    config: SimilarityConfig,
) -> tuple[NearDuplicatePair, ...]:
    """Compare distinct normalized texts and emit only directly matching ID pairs."""
    # A conflicting ID cannot reliably identify one side of a near-duplicate pair.
    text_count_by_id = Counter(review_id for ids in ids_by_text.values() for review_id in ids)
    candidates = []
    for text, ids in ids_by_text.items():
        if len(text) < max(config.min_text_length, config.ngram_size):
            continue
        unique_ids = tuple(review_id for review_id in ids if text_count_by_id[review_id] == 1)
        if unique_ids:
            vector = character_ngrams(text, config.ngram_size)
            candidates.append((unique_ids, vector, _squared_norm(vector)))

    pairs = []
    for first, second in combinations(candidates, 2):
        first_ids, first_vector, first_squared_norm = first
        second_ids, second_vector, second_squared_norm = second
        similarity = _cosine(first_vector, second_vector, first_squared_norm * second_squared_norm)
        if similarity >= config.threshold:
            pairs.extend(
                NearDuplicatePair(review_ids, similarity, config.ngram_size)
                for review_ids in product(first_ids, second_ids)
            )
    return tuple(pairs)

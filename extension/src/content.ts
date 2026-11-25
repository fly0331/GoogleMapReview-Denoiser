
interface ReviewData {
  review_id: string;
  rating: number;
  text: string;
  relative_time: string | null;
  author_reviews_count: number | null;
  review_date: string | null;
}

interface CollectionResult {
  place_id: string;
  scraped_at: string;
  reviews: ReviewData[];
}

const CARD_SELECTOR = 'div.jftiEf[data-review-id][aria-label]';
const MAX_REVIEWS = 50;
const SCROLL_DELAY = 700;
const MAX_IDLE_ROUNDS = 4;

function getPlaceId(): string | null {
  return (
    location.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1] ?? null
  );
}

function parseAuthorReviewsCount(card: Element): number | null {
  const text = card.querySelector(".RfnDt")?.textContent ?? "";

  const patterns = [
    /(\d[\d,]*)\s*(?:則評論|則評論|篇評論)/i,
    /(\d[\d,]*)\s*reviews?/i,
    /(\d[\d,]*)\s*条评价/i,
    /(\d[\d,]*)\s*件のクチコミ/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const count = Number(match[1].replace(/,/g, ""));
      return Number.isSafeInteger(count) ? count : null;
    }
  }

  return null;
}

function parseRating(card: Element): number | null {
  const ratingElement = card.querySelector(
    'span[role="img"][aria-label]'
  );

  const label = ratingElement?.getAttribute("aria-label") ?? "";
  const match = label.match(/([1-5])\s*(?:顆星|星|stars?)/i);

  return match ? Number(match[1]) : null;
}

function extractReview(card: Element): ReviewData | null {
  const reviewId = card.getAttribute("data-review-id");

  if (!reviewId) return null;

  const rating = parseRating(card);
  if (rating === null) return null;

  const text =
    card.querySelector(".wiI7pd")?.textContent?.trim() ?? "";

  const relativeTime =
    card.querySelector(".rsqaWe")?.textContent?.trim() ?? null;

  return {
    review_id: reviewId,
    rating,
    text,
    relative_time: relativeTime || null,
    author_reviews_count: parseAuthorReviewsCount(card),
    review_date: null,
  };
}

function getReviewCards(): Element[] {
  const cards = document.querySelectorAll(CARD_SELECTOR);
  const unique = new Map<string, Element>();

  cards.forEach((card) => {
    const id = card.getAttribute("data-review-id");
    if (id && !unique.has(id)) {
      unique.set(id, card);
    }
  });

  return [...unique.values()];
}

function getScrollContainer(card: Element): HTMLElement | null {
  let node = card.parentElement;
  const candidates: HTMLElement[] = [];

  while (node && node !== document.body) {
    if (
      node.scrollHeight > node.clientHeight + 20 &&
      node.scrollHeight > node.clientHeight * 1.2
    ) {
      candidates.push(node);
    }

    node = node.parentElement;
  }

  // The inner review list has the largest scroll height.
  candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);

  return candidates[0] ?? null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectReviews(): Promise<CollectionResult> {
  const placeId = getPlaceId();

  if (!placeId) {
    throw new Error("Cannot identify Google Maps place ID.");
  }

  const firstCard = document.querySelector(CARD_SELECTOR);

  if (!firstCard) {
    throw new Error("No Google Maps review cards found.");
  }

  const scrollContainer = getScrollContainer(firstCard);

  if (!scrollContainer) {
    throw new Error("Cannot find the review scroll container.");
  }

  const collected = new Map<string, ReviewData>();
  let idleRounds = 0;

  while (
    collected.size < MAX_REVIEWS &&
    idleRounds < MAX_IDLE_ROUNDS
  ) {
    const previousCount = collected.size;

    for (const card of getReviewCards()) {
      const review = extractReview(card);

      if (review && !collected.has(review.review_id)) {
        collected.set(review.review_id, review);
      }

      if (collected.size >= MAX_REVIEWS) break;
    }

    if (collected.size >= MAX_REVIEWS) break;

    if (collected.size === previousCount) {
      idleRounds += 1;
    } else {
      idleRounds = 0;
    }

    const previousScrollTop = scrollContainer.scrollTop;

    scrollContainer.scrollTop = scrollContainer.scrollHeight;

    await wait(SCROLL_DELAY);

    if (scrollContainer.scrollTop === previousScrollTop) {
      idleRounds += 1;
    }
  }

  console.log("Collected reviews:", [...collected.values()]);

  return {
    place_id: placeId,
    scraped_at: new Date().toISOString(),
    reviews: [...collected.values()].slice(0, MAX_REVIEWS),
  };
}

// Listen for requests from the Side Panel.
chrome.runtime.onMessage.addListener(
  (
    message: { type?: string },
    _sender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message?.type !== "COLLECT_REVIEWS") {
      return;
    }

    collectReviews()
      .then((result) => {
        sendResponse({
          success: true,
          data: result,
        });
      })
      .catch((error: unknown) => {
        sendResponse({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown collection error.",
        });
      });

    return true;
  }
);

import {
  findPlaceAnchor, getMapsPlaceId, logReviewTrace, normalizePlaceTitle,
  type AnchorDiagnostics, type PlaceAnchor,
} from "./maps-context";

let lastBound: (PlaceAnchor & { placeId: string }) | undefined;
const reviewOwner = new WeakMap<Element, { placeId: string; reviewId: string }>();
let currentReviewIds: { placeId: string; ids: Set<string> } | undefined;
let previousReviewIds: typeof currentReviewIds;

export function bindReviewCards(root: HTMLElement, placeId: string) {
  if (currentReviewIds?.placeId !== placeId) {
    previousReviewIds = currentReviewIds;
    currentReviewIds = { placeId, ids: new Set() };
  }
  for (const card of root.querySelectorAll("[data-review-id]")) {
    const reviewId = card.getAttribute("data-review-id");
    if (!reviewId || isForeignReview(card, placeId)) continue;
    currentReviewIds.ids.add(reviewId);
    reviewOwner.set(card, { placeId, reviewId });
  }
}

export function isForeignReview(card: Element, placeId: string): boolean {
  const reviewId = card.getAttribute("data-review-id");
  if (!reviewId) return false;
  const owner = reviewOwner.get(card);
  if (owner?.reviewId === reviewId && owner.placeId !== placeId) return true;
  return (currentReviewIds?.placeId !== placeId && currentReviewIds?.ids.has(reviewId) === true) ||
    (previousReviewIds?.placeId !== placeId && previousReviewIds?.ids.has(reviewId) === true);
}

function readPlaceBinding(placeId: string, expectedTitle?: string, diagnostics?: AnchorDiagnostics) {
  const currentPlaceId = getMapsPlaceId(location.href);
  const urlMatches = currentPlaceId === placeId;
  const bound = lastBound?.placeId === placeId ? lastBound : undefined;
  const anchor = findPlaceAnchor(diagnostics) ??
    (urlMatches && bound ? findPlaceAnchor(diagnostics, bound.title) : null);
  const title = anchor && normalizePlaceTitle(anchor.title);
  const titleMatches = !!title && (!bound || title === normalizePlaceTitle(bound.title)) &&
    (expectedTitle === undefined || title === normalizePlaceTitle(expectedTitle));
  // The URL can advance while the previous place's root and title remain visible.
  const previousDom = !bound && !!lastBound && anchor?.root === lastBound.root &&
    title === normalizePlaceTitle(lastBound.title);
  let failure;
  if (!urlMatches) failure = "PLACE_ID_MISMATCH";
  else if (!anchor) failure = "REVIEW_ANCHOR_UNAVAILABLE";
  else if (previousDom) failure = "PLACE_BINDING_MISMATCH";
  else if (!titleMatches) failure = "PLACE_TITLE_MISMATCH";
  return {
    anchor, failure, currentPlaceId, urlMatches, bindingMatches: !!bound, titleMatches,
    boundRootConnected: bound?.root.isConnected ?? false,
    boundTablistConnected: bound?.tabs.isConnected ?? false,
    sameRootAsBound: !!anchor && anchor.root === bound?.root,
    sameTablistAsBound: !!anchor && anchor.tabs === bound?.tabs,
  };
}

export function confirmedPlaceAnchor(placeId: string, expectedTitle?: string): PlaceAnchor | null {
  const { anchor, failure } = readPlaceBinding(placeId, expectedTitle);
  if (failure || !anchor) return null;
  lastBound = { ...anchor, placeId };
  bindReviewCards(anchor.root, placeId);
  return anchor;
}

export function trackPlaceNavigation(onPlaceChanged: (placeId: string | null) => void): void {
  let currentPlace = getMapsPlaceId(location.href);
  const capture = () => {
    const placeId = getMapsPlaceId(location.href);
    if (placeId) confirmedPlaceAnchor(placeId);
  };
  const notify = () => {
    const nextPlace = getMapsPlaceId(location.href);
    if (nextPlace === currentPlace) return;
    currentPlace = nextPlace;
    onPlaceChanged(nextPlace);
  };
  capture();
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  // Capture the outgoing place before a same-document navigation updates the URL.
  navigation?.addEventListener("navigate", capture);
  navigation?.addEventListener("currententrychange", notify);
  window.addEventListener("popstate", notify);
}

export function tracePlaceContext(
  event: string, requestId: string, placeId: string, expectedTitle?: string, errorCode?: string,
): void {
  const diagnostics: AnchorDiagnostics = { mainCount: 0, tablistCount: 0, validAnchorCount: 0, tablists: [] };
  const { anchor, failure, ...checks } = readPlaceBinding(placeId, expectedTitle, diagnostics);
  logReviewTrace(event, {
    requestId, expectedPlaceId: placeId, ...checks,
    contextFound: !!anchor && !failure,
    reviewTabFound: !!anchor || diagnostics.tablists.some((tablist) => tablist.reviewTabFound),
    reviewTabSelected: anchor?.reviewTab.getAttribute("aria-selected") === "true" ||
      diagnostics.tablists.some((tablist) => tablist.reviewTabFound && tablist.tabs.some(
        (tab) => tab.selected && (tab.reviewText || tab.labelTitleMatches === true),
      )),
    bindingErrorCode: failure ?? null, errorCode: errorCode ?? failure ?? null, ...diagnostics,
  });
}

export function placeBindingFailure(placeId: string, expectedTitle?: string): string | undefined {
  return readPlaceBinding(placeId, expectedTitle).failure;
}

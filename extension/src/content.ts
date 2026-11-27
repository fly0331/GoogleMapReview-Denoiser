
import {
    bindReviewCards, confirmedPlaceAnchor, isForeignReview, placeBindingFailure, tracePlaceContext, trackPlaceNavigation,
} from "./review-ownership";
import {
    findBoundReviewAnchor, findPlaceAnchor, findTablessReviewMain, getMapsPlaceId, isVisible, logReviewTrace, mapsDebugEnabled,
    type AnchorDiagnostics, type PlaceAnchor,
} from "./maps-context";
import {
    REVIEW_COLLECTION_LIMIT as MAX_REVIEWS, toAnalyzeRequest,
    type CollectionProgress, type CollectionRequest, type CollectionResponse, type CollectionStarted, type MerchantVerified,
} from "./analysis-task";

import type { CollectedReview, CollectedReviews } from "./types";

const CARD_SELECTOR = '[data-review-id]';
const SCROLL_DELAY = 700;
const MAX_IDLE_ROUNDS = 4;
const MAX_REVIEW_TEXT_CHARS = 5_000;
const MAX_REVIEW_ID_CHARS = 256;
const MAX_RELATIVE_TIME_CHARS = 128;
const MAX_PLACE_ID_CHARS = 512;
const MAX_REQUEST_BODY_BYTES = 512 * 1024;

function truncateText(text: string, limit: number): string {
    return text.length <= limit ? text : Array.from(text).slice(0, limit).join("").trimEnd();
}

function exceedsCharacterLimit(text: string, limit: number): boolean {
    return text.length > limit && Array.from(text).length > limit;
}

function parseRating(card: Element): number | null {
    const ratingElement = card.querySelector(
        'span[role="img"][aria-label]'
    );

    const label = ratingElement?.getAttribute("aria-label") ?? "";
    const match = label.match(/([1-5])\s*(?:顆星|星|stars?)/i);

    return match ? Number(match[1]) : null;
}

function extractReview(card: Element): CollectedReview | null {
    const reviewId = card.getAttribute("data-review-id");

    if (!reviewId || exceedsCharacterLimit(reviewId, MAX_REVIEW_ID_CHARS)) return null;

    const rating = parseRating(card);
    if (rating === null) return null;

    const text =
        card.querySelector(".wiI7pd")?.textContent?.trim() ?? "";

    const relativeTime =
        card.querySelector(".rsqaWe")?.textContent?.trim() ?? null;

    return {
        review_id: reviewId,
        rating,
        text: truncateText(text, MAX_REVIEW_TEXT_CHARS),
        relative_time: relativeTime ? truncateText(relativeTime, MAX_RELATIVE_TIME_CHARS) : null,
    };
}

function fitRequestBody(request: CollectedReviews): CollectedReviews {
    const encoder = new TextEncoder();
    const fits = (data: CollectedReviews) => encoder.encode(JSON.stringify(toAnalyzeRequest(data))).byteLength <= MAX_REQUEST_BODY_BYTES;
    if (fits(request)) return request;

    // Apply the largest uniform text cap that fits without reordering or dropping review IDs.
    let low = 0;
    let high = MAX_REVIEW_TEXT_CHARS - 1;
    const withTextCap = (limit: number): CollectedReviews => ({
        ...request,
        reviews: request.reviews.map((review) => ({ ...review, text: truncateText(review.text, limit) })),
    });
    let result = withTextCap(0);
    if (!fits(result)) throw new CollectionFailure("REQUEST_BODY_TOO_LARGE", "評論資料超過傳輸上限。");
    while (low <= high) {
        const limit = Math.floor((low + high) / 2);
        const candidate = withTextCap(limit);
        if (fits(candidate)) {
            result = candidate;
            low = limit + 1;
        } else {
            high = limit - 1;
        }
    }
    return result;
}

function getReviewCards(root: HTMLElement): Element[] {
    const cards = root.querySelectorAll<HTMLElement>(CARD_SELECTOR);
    const unique = new Map<string, Element>();

    cards.forEach((card) => {
        const id = card.getAttribute("data-review-id");
        if (!id || !isVisible(card)) return;
        const previous = unique.get(id);
        if (!previous || (parseRating(previous) === null && parseRating(card) !== null)) {
            unique.set(id, card);
        }
    });

    return [...unique.values()];
}

function getScrollContainer(card: Element, root: HTMLElement): HTMLElement | null {
    let node = card.parentElement;
    const candidates: HTMLElement[] = [];

    while (node && root.contains(node)) {
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

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        }, ms);
        signal.addEventListener("abort", abort, { once: true });
    });
}

function expandReviewTexts(cards: Element[]): boolean {
    let expanded = false;

    for (const card of cards) {
        const button = [...card.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
            /^(?:顯示更多|更多|more|read more)$/iu.test(candidate.getAttribute("aria-label")?.trim() ?? "") ||
            /^(?:顯示更多|更多|more|read more)$/iu.test(candidate.textContent?.trim() ?? ""),
        );

        if (button) {
            button.click();
            expanded = true;
        }
    }

    return expanded;
}

interface ReviewBinding {
    root: HTMLElement;
    pane: HTMLElement;
    navigation: PlaceAnchor | null;
    scrollContainer?: HTMLElement;
    verifyWholeRoot?: boolean;
}

function findReviewScroller(root: HTMLElement): HTMLElement | undefined {
    const cards = getReviewCards(root);
    const first = cards.find((card) => parseRating(card) !== null);
    if (!first) return;

    // Resolve the nearest scroller containing the whole visible review list, inside this main.
    for (let node = first.parentElement; node && node !== root && root.contains(node); node = node.parentElement) {
        const scrollable = node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 20;
        if (scrollable && isVisible(node) && cards.every((card) => node.contains(card))) {
            return node;
        }
    }
}

function resolveTablessBinding(placeId: string, title: string): ReviewBinding | undefined {
    const root = findTablessReviewMain(placeId, title);
    const pane = root && findReviewScroller(root);
    if (root && pane) return { root, pane, navigation: null, scrollContainer: pane, verifyWholeRoot: true };
}

async function collectReviews(
    placeId: string, binding: ReviewBinding, rebind: () => Promise<ReviewBinding>, signal: AbortSignal,
    onProgress: (count: number) => void,
): Promise<CollectedReviews> {
    const collected = new Map<string, CollectedReview>();
    let idleRounds = 0;

    while (
        collected.size < MAX_REVIEWS &&
        idleRounds < MAX_IDLE_ROUNDS
    ) {
        signal.throwIfAborted();
        if (getMapsPlaceId(location.href) !== placeId) {
            throw new CollectionFailure("PLACE_ID_MISMATCH", "地標已變更，已停止擷取。");
        }
        const initialCards = getReviewCards(binding.pane);
        const expandedAny = expandReviewTexts(initialCards);

        if (expandedAny) {
            await wait(150, signal);
            binding = await rebind();
        }

        const previousCount = collected.size;

        const cards = getReviewCards(binding.pane);
        for (const card of cards) {
            if (isForeignReview(card, placeId)) {
                throw new CollectionFailure("FOREIGN_REVIEW_CARD", "評論與目前地標不符，已停止擷取。");
            }
            const review = extractReview(card);

            if (review && !collected.has(review.review_id)) {
                collected.set(review.review_id, review);
            }

            if (collected.size >= MAX_REVIEWS) break;
        }

        if (collected.size > previousCount) onProgress(collected.size);
        if (collected.size >= MAX_REVIEWS) break;
        const scrollContainer = binding.scrollContainer ??
            (cards.length ? getScrollContainer(cards[0], binding.root) : null);
        if (!scrollContainer) break;

        if (collected.size === previousCount) {
            idleRounds += 1;
        } else {
            idleRounds = 0;
        }

        const previousScrollTop = scrollContainer.scrollTop;

        scrollContainer.scrollTop = scrollContainer.scrollHeight;

        await wait(SCROLL_DELAY, signal);
        binding = await rebind();

        if (scrollContainer.isConnected && scrollContainer.scrollTop === previousScrollTop) {
            idleRounds += 1;
        }
    }

    signal.throwIfAborted();
    if (getMapsPlaceId(location.href) !== placeId) {
        throw new CollectionFailure("PLACE_ID_MISMATCH", "地標已變更，已停止擷取。");
    }

    return fitRequestBody({
        place_id: placeId,
        scraped_at: new Date().toISOString(),
        reviews: [...collected.values()].slice(0, MAX_REVIEWS),
    });
}

function observeUntil<T>(
    read: () => T | undefined, timeout: number, signal: AbortSignal,
): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        const observer = new MutationObserver(check);
        const timer = setTimeout(() => finish(), timeout);
        const abort = () => { finish(); };
        function finish(value?: T, error?: unknown) {
            observer.disconnect();
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            if (error) reject(error);
            else resolve(value);
        }
        function check() {
            try {
                const value = read();
                if (value !== undefined) finish(value);
            } catch (error) {
                finish(undefined, error);
            }
        }
        if (signal.aborted) { finish(); return; }
        signal.addEventListener("abort", abort, { once: true });
        observer.observe(document.body, {
            childList: true, subtree: true, characterData: true, attributes: true,
            attributeFilter: ["aria-selected", "aria-checked", "aria-pressed", "aria-label", "aria-controls", "aria-labelledby", "id", "hidden", "aria-hidden"],
        });
        check();
    });
}

const SORT = /^(?:排序(?:方式|評論)?|評論排序|sort(?: by)?)(?:\s|[:：]|$)/iu;
const NEWEST = /^(?:最新(?:評論)?|newest|most recent)$/iu;
const reviewLabel = (element: Element) => (element.getAttribute("aria-label") || element.textContent || "").trim();
const NO_REVIEWS = /^(?:沒有評論|沒有任何評論|目前沒有評論|no reviews(?: yet)?|there are no reviews yet)[。.]?$/iu;

function selectedReviewRoot(anchor: PlaceAnchor): ReviewBinding | undefined {
    if (anchor.reviewTab.getAttribute("aria-selected") !== "true") return;
    const root = anchor.root;
    const controlled = anchor.reviewTab.getAttribute("aria-controls");
    if (controlled) {
        const pane = document.getElementById(controlled);
        if (pane && !root.contains(pane)) return;
        if (pane && isVisible(pane)) return { root, pane, navigation: anchor };
    }
    const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter(isVisible);
    if (panels.length) {
        const matching = panels.filter((panel) =>
            anchor.reviewTab.id && panel.getAttribute("aria-labelledby") === anchor.reviewTab.id,
        );
        if (matching.length === 1) return { root, pane: matching[0], navigation: anchor, verifyWholeRoot: !!controlled };
        if (!controlled && panels.length === 1 && !panels[0].hasAttribute("aria-labelledby")) {
            return { root, pane: panels[0], navigation: anchor };
        }
        return;
    }
    if (!controlled) return { root, pane: root, navigation: anchor };
    // With a stale control, require a scoped review list inside the verified selected tab's main.
    const pane = findReviewScroller(root);
    if (pane) return { root, pane, navigation: anchor, scrollContainer: pane, verifyWholeRoot: true };
}

async function tryNewest(
    root: HTMLElement, assertCurrent: () => void, signal: AbortSignal, sortScope = root,
): Promise<boolean> {
    const buttons = [...sortScope.querySelectorAll<HTMLElement>('button, [role="button"]')].filter(isVisible);
    const sort = buttons.find((button) => SORT.test(reviewLabel(button)));
    if (!sort) return false;
    const reflectsNewest = () => /^(?:排序(?:方式|評論)?|評論排序|sort(?: by)?)\s*[:：]?\s*(?:最新(?:評論)?|newest|most recent)$/iu.test(reviewLabel(sort));
    if (reflectsNewest()) return true;
    const visibleOptions = () => [...document.querySelectorAll<HTMLElement>(
        '[role="menuitemradio"], [role="menuitem"], [role="option"], [role="radio"]',
    )].filter((item) => isVisible(item) && NEWEST.test(reviewLabel(item)));
    if (visibleOptions().length) return false;
    sort.click();
    const option = await observeUntil(() => {
        assertCurrent();
        const options = visibleOptions();
        return options.length === 1 ? options[0] : undefined;
    }, 1500, signal);
    if (signal.aborted || !root.isConnected || !sort.isConnected) return false;
    assertCurrent();
    if (!option) {
        if (sort.getAttribute("aria-expanded") === "true") sort.click();
        return false;
    }
    if (["aria-checked", "aria-selected"].some((attribute) => option.getAttribute(attribute) === "true")) {
        option.click();
        return true;
    }
    const firstReview = getReviewCards(root)[0];
    option.click();
    return !!await observeUntil(() => {
        assertCurrent();
        const currentFirst = getReviewCards(root)[0];
        return reflectsNewest() && currentFirst && currentFirst !== firstReview ? true : undefined;
    }, 2000, signal);
}

class CollectionFailure extends Error {
    constructor(readonly code: string, message: string) { super(message); }
}

let verifiedReviewView: { placeId: string; title: string; root: HTMLElement } | undefined;

async function prepareAndCollect(
    request: CollectionRequest, signal: AbortSignal, debug: boolean, onVerified: (title: string) => void,
): Promise<CollectionResponse> {
    const { placeId, requestId } = request;
    if (exceedsCharacterLimit(placeId, MAX_PLACE_ID_CHARS)) {
        throw new CollectionFailure("PLACE_ID_TOO_LONG", "這間商家的識別資料超出分析上限。");
    }
    const ensureRequestedPlace = () => {
        signal.throwIfAborted();
        if (getMapsPlaceId(location.href) !== placeId) {
            throw new CollectionFailure("PLACE_ID_MISMATCH", "地標已變更，請重新分析。");
        }
    };
    ensureRequestedPlace();
    const resumeTabless = () => {
        const remembered = verifiedReviewView;
        if (remembered?.placeId !== placeId) return;
        const binding = resolveTablessBinding(placeId, remembered.title);
        if (binding?.root === remembered.root) return remembered;
    };
    const observedAnchor = await observeUntil(() => {
        ensureRequestedPlace();
        return confirmedPlaceAnchor(placeId) ?? resumeTabless();
    }, 2500, signal);
    ensureRequestedPlace();
    // Recheck the live DOM before using a node found before an asynchronous redraw.
    const anchor = confirmedPlaceAnchor(placeId, observedAnchor?.title);
    const resumed = !anchor ? resumeTabless() : undefined;
    const verified = anchor ?? resumed;
    if (!verified) {
        const code = placeBindingFailure(placeId, observedAnchor?.title) ?? "REVIEW_ANCHOR_UNAVAILABLE";
        throw new CollectionFailure(code, "找不到目前地標的評論分頁。");
    }
    const verifiedTitle = verified.title;
    onVerified(verifiedTitle);
    const initialRoot = verified.root;
    if (debug) tracePlaceContext("content.review_tab.resolved", requestId, placeId, verifiedTitle);
    const alreadySelected = !!resumed || anchor?.reviewTab.getAttribute("aria-selected") === "true";
    const previousCards = new Set(alreadySelected ? [] : getReviewCards(initialRoot));
    if (!alreadySelected) {
        verifiedReviewView = undefined;
        anchor?.reviewTab.click();
    }
    if (debug) tracePlaceContext("content.review_tab.after_click", requestId, placeId, verifiedTitle);
    let enteredReviews = alreadySelected;
    let lastBinding: ReviewBinding | undefined;
    const trace = (event: string, fields: Record<string, unknown> = {}) => {
        if (debug) logReviewTrace(event, { requestId, expectedPlaceId: placeId, ...fields });
    };

    async function waitForBinding(phase: string, timeout: number): Promise<ReviewBinding> {
        let reportedWait = false;
        const binding = await observeUntil(() => {
            ensureRequestedPlace();
            const liveAnchor = findBoundReviewAnchor(placeId, verifiedTitle);
            if (liveAnchor?.reviewTab.getAttribute("aria-selected") === "true") enteredReviews = true;
            const candidate = liveAnchor ? selectedReviewRoot(liveAnchor)
                : enteredReviews ? resolveTablessBinding(placeId, verifiedTitle) : undefined;
            const pane = candidate?.pane;
            const cards = pane ? getReviewCards(pane) : [];
            const owned = cards.length > 0 && cards.every(
                (card) => !previousCards.has(card) && !isForeignReview(card, placeId),
            ) && (!candidate?.verifyWholeRoot || (
                [...candidate.root.querySelectorAll(CARD_SELECTOR)]
                    .every((card) => !isForeignReview(card, placeId))
            ));
            if (candidate && owned) {
                const priorNavigation = lastBinding ? lastBinding.navigation : anchor;
                if ((lastBinding?.root ?? initialRoot) !== candidate.root ||
                    (lastBinding && lastBinding.pane !== candidate.pane) ||
                    priorNavigation?.tabs !== candidate.navigation?.tabs ||
                    priorNavigation?.reviewTab !== candidate.navigation?.reviewTab) {
                    trace("content.review_binding.rebound", {
                        phase, titleSource: candidate.navigation?.titleSource ?? "main_label",
                        mode: candidate.navigation ? "tabbed" : "tabless",
                        oldTablistConnected: priorNavigation?.tabs.isConnected ?? false,
                    });
                }
                lastBinding = candidate;
                bindReviewCards(candidate.pane, placeId);
                verifiedReviewView = { placeId, title: verifiedTitle, root: candidate.root };
                return candidate;
            }
            if (pane && !cards.length && [...pane.querySelectorAll<HTMLElement>('p, [role="status"]')].some(
                (item) => isVisible(item) && NO_REVIEWS.test(item.textContent?.trim() ?? ""),
            )) throw new CollectionFailure("NO_REVIEWS", "這個地標目前沒有評論。");
            if (!reportedWait) {
                trace("content.review_binding.wait", {
                    phase, anchorFound: !!liveAnchor, paneFound: !!pane, enteredReviews, visibleUniqueCards: cards.length,
                });
                reportedWait = true;
            }
            return undefined;
        }, timeout, signal);
        ensureRequestedPlace();
        if (binding) return binding;

        const diagnostics: AnchorDiagnostics = { mainCount: 0, tablistCount: 0, validAnchorCount: 0, tablists: [] };
        const verifiedAnchor = findPlaceAnchor(diagnostics, verifiedTitle);
        const showsReviewTab = diagnostics.tablists.some((list) => list.visible && list.tabs.some(
            (tab) => tab.selected && (tab.reviewText || tab.hasNamedLabel),
        ));
        const verifiedBinding = verifiedAnchor && selectedReviewRoot(verifiedAnchor);
        const hasForeignCards = !!verifiedBinding &&
            [...(verifiedBinding.verifyWholeRoot ? verifiedBinding.root : verifiedBinding.pane).querySelectorAll(CARD_SELECTOR)]
                .some((card) => isForeignReview(card, placeId));
        const unverifiedTabless = !diagnostics.tablistCount &&
            [...document.querySelectorAll('[role="main"]')]
                .some((main) => main.querySelectorAll(CARD_SELECTOR).length > 0);
        const errorCode = (showsReviewTab && !verifiedAnchor) || hasForeignCards || unverifiedTabless
            ? "REVIEW_PLACE_UNVERIFIED" : "REVIEW_DOM_TIMEOUT";
        trace("content.review_binding.failed", { phase, errorCode, ...diagnostics });
        throw new CollectionFailure(
            errorCode,
            errorCode === "REVIEW_PLACE_UNVERIFIED" ? "無法確認評論屬於目前地標。" : "評論載入逾時，請再試一次。",
        );
    }

    const initialBinding = await waitForBinding("after_click", 12_000);
    ensureRequestedPlace();
    // In the verified tabbed fallback, Maps can place the sort control above the review scroller.
    const sortScope = initialBinding.navigation && initialBinding.scrollContainer ? initialBinding.root : initialBinding.pane;
    const newest = await tryNewest(initialBinding.pane, ensureRequestedPlace, signal, sortScope);
    const binding = await waitForBinding("after_sort", 3000);
    void chrome.runtime.sendMessage({ type: "COLLECTION_STARTED", requestId, verifiedTitle } satisfies CollectionStarted).catch(() => {});
    let lastProgressAt = -Infinity;
    const reportProgress = (count: number) => {
        const now = performance.now();
        if (now - lastProgressAt < 400 || signal.aborted) return;
        lastProgressAt = now;
        void chrome.runtime.sendMessage({
            type: "COLLECTION_PROGRESS", requestId, placeId, count,
        } satisfies CollectionProgress).catch(() => {});
    };
    const data = await collectReviews(placeId, binding, () => waitForBinding("collecting", 3000), signal, reportProgress);
    return { ok: true, data, newest, verifiedTitle };
}

let current: { requestId: string; placeId: string; controller: AbortController } | undefined;
trackPlaceNavigation((placeId) => {
    if (verifiedReviewView?.placeId !== placeId) verifiedReviewView = undefined;
    if (current && current.placeId !== placeId) {
        current.controller.abort(new CollectionFailure("PLACE_ID_MISMATCH", "地標已變更，已停止擷取。"));
    }
    void chrome.runtime.sendMessage({ type: "MAPS_PLACE_CHANGED" }).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return;
    if (message.type === "CANCEL_COLLECTION" && current && current.requestId === message.requestId) {
        const reason = message.errorCode;
        const failure = reason === "PLACE_ID_MISMATCH" ? new CollectionFailure(reason, "地標已變更，已停止擷取。")
            : reason === "COLLECTION_TIMEOUT" ? new CollectionFailure(reason, "評論擷取逾時，請再試一次。")
                : reason === "COLLECTION_SUPERSEDED" ? new CollectionFailure(reason, "已有新的分析任務。")
                    : new CollectionFailure("COLLECTION_CANCELLED", "已取消評論擷取。");
        current.controller.abort(failure);
        return;
    }
    if (message.type !== "COLLECT_FOR_ANALYSIS") return;
    current?.controller.abort(new CollectionFailure("COLLECTION_SUPERSEDED", "已有新的分析任務。"));
    const request = message as CollectionRequest;
    const task = { requestId: request.requestId, placeId: request.placeId, controller: new AbortController() };
    current = task;
    const debug = request.debug === true || mapsDebugEnabled();
    if (debug) tracePlaceContext("content.collect.received", request.requestId, request.placeId);
    let verifiedTitle: string | undefined;
    void prepareAndCollect(request, task.controller.signal, debug, (title) => {
        verifiedTitle = title;
        void chrome.runtime.sendMessage({
            type: "MERCHANT_VERIFIED", requestId: request.requestId, placeId: request.placeId, verifiedTitle: title,
        } satisfies MerchantVerified).catch(() => {});
    }).then(reply, (error: unknown) => {
        const errorCode = error instanceof CollectionFailure ? error.code : "COLLECTION_FAILED";
        if (debug) tracePlaceContext("content.collect.failed", request.requestId, request.placeId, undefined, errorCode);
        reply({ ok: false, error: error instanceof Error ? error.message : "無法擷取評論。", errorCode, verifiedTitle } satisfies CollectionResponse);
    }).finally(() => { if (current === task) current = undefined; });
    return true;
});

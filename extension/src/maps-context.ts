export function mapsDebugEnabled(): boolean {
  try {
    return window.sessionStorage?.getItem("review-denoiser:debug") === "1";
  } catch {
    return false;
  }
}

export function logReviewTrace(event: string, fields: Record<string, unknown>): void {
  console.debug("[Review Denoiser] " + event, fields);
}

const MAIN = 'main, [role="main"]';
const TAB_LIST = '[role="tablist"]';
const NAMED_REVIEW_LABEL = /^對「(.+)」的評論$/u;

export interface PlaceAnchor {
  root: HTMLElement;
  title: string;
  tabs: HTMLElement;
  reviewTab: HTMLElement;
  titleSource: "heading" | "review_label" | "main_label";
}

export interface AnchorDiagnostics {
  mainCount: number;
  tablistCount: number;
  validAnchorCount: number;
  tablists: Array<{
    nested: boolean;
    hasMain: boolean;
    hasTitle: boolean;
    hasMainLabel: boolean;
    titleSource: PlaceAnchor["titleSource"] | undefined;
    nameCheck: "matched" | "missing_reference" | "ambiguous_main" | "main_label_mismatch" | "selected_named_tab_unverified";
    visible: boolean;
    parentMainMatches: boolean;
    reviewTabFound: boolean;
    tabs: Array<{
      index: number;
      reviewText: boolean;
      hasNamedLabel: boolean;
      labelTitleMatches: boolean | null;
      selected: boolean;
    }>;
  }>;
}

export const normalizePlaceTitle = (title: string) => title.trim().replace(/\s+/gu, " ").toLowerCase();

export function isVisible(element: HTMLElement): boolean {
  return !element.closest('[hidden], [aria-hidden="true"]') && element.getClientRects().length > 0;
}

function readTabs(tablist: HTMLElement, title: string) {
  return [...tablist.querySelectorAll<HTMLElement>('[role="tab"]')]
    .filter((tab) => tab.closest(TAB_LIST) === tablist)
    .map((tab) => {
      const text = tab.textContent?.trim();
      const ariaLabel = tab.getAttribute("aria-label")?.trim() ?? "";
      const namedTitle = NAMED_REVIEW_LABEL.exec(ariaLabel)?.[1];
      return {
        tab,
        reviewText: text === "評論" || text === "Reviews",
        hasNamedLabel: namedTitle !== undefined,
        namedTitle,
        labelTitleMatches: namedTitle === undefined ? null : normalizePlaceTitle(namedTitle) === normalizePlaceTitle(title),
      };
    });
}

function findReviewTab(tabs: ReturnType<typeof readTabs>): HTMLElement | null {
  const candidates = tabs.filter(({ labelTitleMatches }) => labelTitleMatches !== false);
  const byText = candidates.filter(({ reviewText }) => reviewText);
  if (byText.length > 0) return byText.length === 1 ? byText[0].tab : null;

  // Only the named Traditional Chinese label format is verified in the live DOM.
  const byLabel = candidates.filter(({ hasNamedLabel }) => hasNamedLabel);
  return byLabel.length === 1 ? byLabel[0].tab : null;
}

export function findPlaceAnchor(diagnostics?: AnchorDiagnostics, verifiedReviewTitle?: string): PlaceAnchor | null {
  const anchors: PlaceAnchor[] = [];
  let visibleScopes = 0;
  let visibleMains: HTMLElement[] | undefined;
  const tablists = document.querySelectorAll<HTMLElement>(TAB_LIST);
  if (diagnostics) {
    diagnostics.tablists.length = 0;
    diagnostics.mainCount = document.querySelectorAll(MAIN).length;
    diagnostics.tablistCount = tablists.length;
  }
  for (const tabs of tablists) {
    const nested = !!tabs.parentElement?.closest(TAB_LIST);
    if (nested && !diagnostics) continue;
    const root = tabs.closest<HTMLElement>(MAIN);
    const title = root?.querySelector("h1, [role='heading'][aria-level='1']")?.textContent?.trim();
    const visible = isVisible(tabs);
    const parentMainMatches = !!root && tabs.parentElement?.closest(MAIN) === root;
    const eligible = !nested && !!root && visible && parentMainMatches;
    if (eligible) visibleScopes++;
    const mainLabel = root?.getAttribute("aria-label")?.trim() || undefined;
    const referenceTitle = title || verifiedReviewTitle || mainLabel;
    if ((!eligible || !referenceTitle) && !diagnostics) continue;
    const tabDetails = readTabs(tabs, referenceTitle ?? "");
    const reviewTab = findReviewTab(tabDetails);
    const review = tabDetails.find(({ tab }) => tab === reviewTab);
    const titleSource = title ? "heading" : verifiedReviewTitle ? "review_label" : mainLabel ? "main_label" : undefined;
    let nameCheck: AnchorDiagnostics["tablists"][number]["nameCheck"] = "matched";
    // A headingless first visit needs independent agreement from the unique visible main and its selected named tab.
    // A known title can still corroborate a redrawn tab when Maps omits the main label.
    if (!referenceTitle) nameCheck = "missing_reference";
    else if (!title) {
      if (mainLabel && normalizePlaceTitle(mainLabel) !== normalizePlaceTitle(referenceTitle)) {
        nameCheck = "main_label_mismatch";
      } else if (review?.labelTitleMatches !== true || !reviewTab ||
          reviewTab.getAttribute("aria-selected") !== "true" || !isVisible(reviewTab)) {
        nameCheck = "selected_named_tab_unverified";
      } else {
        visibleMains ??= [...document.querySelectorAll<HTMLElement>(MAIN)].filter(isVisible);
        if (visibleMains.length !== 1 || visibleMains[0] !== root) nameCheck = "ambiguous_main";
      }
    }
    if (diagnostics) diagnostics.tablists.push({
      nested, hasMain: !!root, hasTitle: !!title, visible, parentMainMatches, reviewTabFound: !!reviewTab,
      hasMainLabel: !!mainLabel, titleSource, nameCheck,
      tabs: tabDetails.map(({ tab, reviewText, hasNamedLabel, labelTitleMatches }, index) => ({
        index, reviewText, hasNamedLabel, labelTitleMatches, selected: tab.getAttribute("aria-selected") === "true",
      })),
    });
    if (!eligible || !root || !reviewTab || !referenceTitle || !titleSource || nameCheck !== "matched") continue;
    const anchorTitle = titleSource === "main_label" ? review?.namedTitle?.trim() : referenceTitle;
    if (anchorTitle) anchors.push({ root, title: anchorTitle, tabs, reviewTab, titleSource });
  }
  const verified = anchors.filter((anchor) =>
    (verifiedReviewTitle === undefined || normalizePlaceTitle(anchor.title) === normalizePlaceTitle(verifiedReviewTitle)) &&
    (anchor.titleSource === "heading" || visibleScopes === 1),
  );
  if (diagnostics) diagnostics.validAnchorCount = verified.length;
  return verified.length === 1 ? verified[0] : null;
}

export function findBoundReviewAnchor(placeId: string, title: string): PlaceAnchor | null {
  return getMapsPlaceId(location.href) === placeId ? findPlaceAnchor(undefined, title) : null;
}

export function findTablessReviewMain(placeId: string, title: string): HTMLElement | null {
  if (getMapsPlaceId(location.href) !== placeId || document.querySelectorAll(TAB_LIST).length) return null;
  const mains = [...document.querySelectorAll<HTMLElement>('[role="main"]')].filter(isVisible);
  if (mains.length !== 1) return null;
  const main = mains[0];
  const label = main.getAttribute("aria-label")?.trim();
  return label && normalizePlaceTitle(label) === normalizePlaceTitle(title) ? main : null;
}

export function getMapsPlaceId(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    !["www.google.com", "maps.google.com"].includes(url.host) ||
    !url.pathname.startsWith("/maps/place/")
  ) {
    return null;
  }

  const dataSegments = url.pathname.split("/").filter((segment) => segment.startsWith("data="));
  if (dataSegments.length !== 1) return null;

  const [prefix, ...fields] = dataSegments[0].slice("data=".length).split("!");
  if (prefix !== "") return null;

  type DataGroup = { field: string; end: number };
  const groups: DataGroup[] = [];
  let selected: { id: string; scope: DataGroup | undefined } | undefined;
  let previousScope: DataGroup | undefined;

  for (const [index, token] of fields.entries()) {
    while (groups.at(-1)?.end === index) groups.pop();
    const parts = /^(\d+)([a-z])(.*)$/u.exec(token);
    if (!parts) return null;
    const [, field, type, value] = parts;
    if (type === "m") {
      // The span counts following tokens, including all nested group headers.
      const length = Number(value);
      const end = index + 1 + length;
      if (!/^\d+$/u.test(value) || !Number.isSafeInteger(length) || end > (groups.at(-1)?.end ?? fields.length)) {
        return null;
      }
      groups.push({ field, end });
      continue;
    }

    if (field !== "1" || type !== "s" || !/^0x[0-9a-f]+:0x[0-9a-f]+$/iu.test(value)) continue;
    const [scope, branch, nested] = groups;
    // In the observed layout, 4 > 3 holds the selection and 4 > 1 > 3
    // holds the previous place. Both must belong to the same field-4 group.
    if (groups.length === 3 && scope.field === "4" && branch.field === "1" && nested.field === "3") {
      if (previousScope) return null;
      previousScope = scope;
    } else if (!selected && (groups.length === 0 || (groups.length === 2 && scope.field === "4" && branch.field === "3"))) {
      selected = { id: value.toLowerCase(), scope };
    } else {
      return null;
    }
  }

  return selected && (!previousScope || selected.scope === previousScope) ? selected.id : null;
}

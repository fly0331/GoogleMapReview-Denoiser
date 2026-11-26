const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const {
  previousPlace, selectedPlace, observedDualPlaceUrl, placePath, dualPlaceUrl,
  hotpotPlace, hotpotTitle, hotpotOverviewUrl, hotpotReviewsUrl,
} = require("./maps-url-fixtures.cjs");

const title = "雞白湯專門 拉麵一貴 らーめん一貴";
const placeId = "0x3442a7b35f10f613:0xff3e7c5152b3aec2";
const fixtureTabs = [
  { text: "總覽", ariaLabel: "「雞白湯專門 拉麵一貴 らーめん一貴」總覽", selected: "true" },
  { text: "菜單", ariaLabel: "菜單", selected: "false" },
  { text: "評論", ariaLabel: "對「雞白湯專門 拉麵一貴 らーめん一貴」的評論", selected: "false" },
  { text: "簡介", ariaLabel: "雞白湯專門 拉麵一貴 らーめん一貴簡介", selected: "false" },
];
const compiled = new Map(["content", "review-ownership", "maps-context"].map((name) => [
  "./" + name,
  ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
]));

function setup(tabs, heading = title, {
  cardCount = 0, sortLabel, debug = false, fixturePlaceId = placeId, deferReviewDom = false,
  scrollReviews = false,
} = {}) {
  class ElementFixture {
    constructor(role) {
      this.role = role;
      this.attributes = {};
      this.children = [];
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getClientRects() {
      return this.getAttribute("hidden") === null ? [{}] : [];
    }
    append(...children) { this.children.push(...children); }
    closest(selector) {
      if (selector === "main, [role=\"main\"]") return this.role === "main" ? this : this.parentElement?.closest(selector);
      if (selector === '[role="tablist"]') return this.role === "tablist" ? this : this.parentElement?.closest(selector);
      return null;
    }
    contains(node) { return this === node || this.children.some((child) => child instanceof ElementFixture && child.contains(node)); }
    remove() {
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
    }
    get isConnected() {
      return this.role === "main" ? this === liveMain || this === extraMain
        : !!this.parentElement?.children.includes(this) && this.parentElement.isConnected;
    }
    querySelector(selector) {
      if (this.role === "card" && selector.startsWith("span[role")) return { getAttribute: () => "5 顆星" };
      if (this.role === "card" && selector === ".wiI7pd") return { textContent: "Review " + this.getAttribute("data-review-id") };
      return selector.startsWith("h1,") ? { textContent: heading } : null;
    }
    querySelectorAll(selector) {
      if (selector === '[role="tab"]') return this.children;
      if (selector === "[data-review-id]") return this.children.flatMap((child) =>
        child instanceof ElementFixture ? [
          ...(child.getAttribute("data-review-id") !== null ? [child] : []),
          ...child.querySelectorAll(selector),
        ] : [],
      );
      if (selector.startsWith("button,")) return this.children.filter((child) => child.role === "button");
      return [];
    }
  }
  const main = new ElementFixture("main");
  let liveMain = main;
  let extraMain;
  let activePlace = fixturePlaceId;
  let onScroll;
  let scrollCalls = 0;
  let menuOption;
  let tablist = new ElementFixture("tablist");
  tablist.parentElement = main;
  main.append(tablist);
  const nestedTablists = [];
  for (const { text, ariaLabel, selected, nested } of tabs) {
    const tab = new ElementFixture("tab");
    tab.parentElement = nested ? new ElementFixture("tablist") : tablist;
    if (nested) {
      tab.parentElement.parentElement = tablist;
      tab.parentElement.append(tab);
      nestedTablists.push(tab.parentElement);
    }
    tab.textContent = text;
    tab.setAttribute("aria-label", ariaLabel);
    tab.setAttribute("aria-selected", selected);
    tablist.append(tab);
  }
  if (sortLabel) {
    const control = new ElementFixture("button");
    control.textContent = sortLabel;
    control.parentElement = main;
    main.append(control);
  }
  let reviewTabClicks = 0;
  const reviewTab = tablist.children.find((tab) => tab.textContent === "評論" || tab.textContent === "Reviews") ??
    tablist.children.find((tab) => /^對「.+」的評論$/u.test(tab.getAttribute("aria-label")));
  const reviewId = (index, owner = activePlace) => "review-" + owner + "-" + index;
  const appendCards = (parent, ids) => {
    for (const id of ids) {
      const card = new ElementFixture("card");
      card.setAttribute("data-review-id", id);
      card.parentElement = parent;
      parent.append(card);
    }
  };
  function appendScroller(ids) {
    const scroller = new ElementFixture("scroller");
    scroller.parentElement = liveMain;
    scroller.scrollHeight = 17577;
    scroller.clientHeight = 815;
    let top = 0;
    Object.defineProperty(scroller, "scrollTop", {
      get: () => top,
      set: (value) => {
        top = value;
        scrollCalls++;
        const next = onScroll;
        onScroll = undefined;
        next?.();
      },
    });
    liveMain.append(scroller);
    const list = new ElementFixture("review-list");
    list.parentElement = scroller;
    scroller.append(list);
    appendCards(list, ids);
    return list;
  }
  const loadCards = () => {
    const ids = Array.from({ length: cardCount }, (_, index) => reviewId(index));
    if (scrollReviews) appendScroller(ids);
    else appendCards(liveMain, ids);
  };
  if (reviewTab) {
    reviewTab.click = () => {
      reviewTabClicks++;
      if (deferReviewDom) return;
      reviewTab.setAttribute("aria-selected", "true");
      loadCards();
    };
    if (reviewTab.getAttribute("aria-selected") === "true") loadCards();
  }
  const observers = new Set();
  const navigation = new EventTarget();
  const createdElements = [];
  let receive;
  const messages = [];
  const logs = [];
  const location = { href: "https://www.google.com/maps/place/test/data=!1s" + fixturePlaceId };
  const context = {
    URL, AbortController, clearTimeout,
    setTimeout: (callback, delay) => setTimeout(callback, [2500, 12000, 3000, 2000, 700].includes(delay) ? 20 : delay),
    console: { debug: (...args) => logs.push(args) },
    location,
    Element: ElementFixture,
    window: { addEventListener() {}, navigation },
    document: {
      body: main,
      createElement: (name) => { createdElements.push(name); return new ElementFixture(name); },
      querySelectorAll(selector) {
        if (selector === '[role="tablist"]') return [tablist, ...nestedTablists].filter((list) => list.isConnected);
        if (selector === '[role="main"]' || selector === 'main, [role="main"]') return [liveMain, extraMain].filter(Boolean);
        if (selector.startsWith('[role="menuitemradio"]')) return menuOption ? [menuOption] : [];
        return [];
      },
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, options) { assert.equal(target, main); this.options = options; observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    chrome: { runtime: { id: "extension", onMessage: { addListener(fn) { receive = fn; } }, sendMessage: async (message) => {
      assert.ok(["MAPS_PLACE_CHANGED", "COLLECTION_STARTED"].includes(message.type));
      messages.push(message.type);
    } } },
    require(name) {
      const scope = { ...context, exports: {} };
      vm.runInNewContext(compiled.get(name), scope);
      return scope.exports;
    },
  };
  context.require("./content");
  return {
    get tablist() { return tablist; },
    logs,
    createdElements, messages,
    observerCount: () => observers.size,
    setHeading: (value) => { heading = value; },
    reviewId,
    nextScroll: (callback) => { onScroll = callback; },
    scrollCalls: () => scrollCalls,
    reviewTabClicks: () => reviewTabClicks,
    collect: (expectedPlaceId = fixturePlaceId) => new Promise((resolve) => receive(
      { type: "COLLECT_FOR_ANALYSIS", placeId: expectedPlaceId, requestId: "fixture", debug }, { id: "extension" }, resolve,
    )),
    cancel: (errorCode) => receive({ type: "CANCEL_COLLECTION", requestId: "fixture", errorCode }, { id: "extension" }),
    navigate: (id, href = "https://www.google.com/maps/place/test/data=!1s" + id) => {
      navigation.dispatchEvent(new Event("navigate"));
      activePlace = id;
      location.href = href;
      navigation.dispatchEvent(new Event("currententrychange"));
    },
    removeTablist: () => { tablist.remove(); },
    replaceReviewDom: ({ namedTitle = title, replaceRoot = false } = {}) => {
      if (tablist.isConnected) tablist.remove();
      if (replaceRoot) liveMain = new ElementFixture("main");
      heading = "";
      tablist = new ElementFixture("tablist");
      tablist.parentElement = liveMain;
      liveMain.append(tablist);
      const selected = new ElementFixture("tab");
      selected.parentElement = tablist;
      selected.textContent = "評論";
      selected.setAttribute("aria-selected", "true");
      if (namedTitle) selected.setAttribute("aria-label", "對「" + namedTitle + "」的評論");
      tablist.append(selected);
      loadCards();
    },
    replaceWithTabless: ({ ids, mainLabel = heading, multipleMains = false, scrollable = true }) => {
      if (tablist.isConnected) tablist.remove();
      liveMain = new ElementFixture("main");
      liveMain.setAttribute("aria-label", mainLabel);
      if (multipleMains) {
        extraMain = new ElementFixture("main");
        extraMain.setAttribute("aria-label", mainLabel);
      }
      const list = scrollable ? appendScroller(ids) : liveMain;
      if (!scrollable) appendCards(list, ids);
      return (nextIds) => appendCards(list, nextIds);
    },
    onSort: (callback) => {
      const sort = new ElementFixture("button");
      sort.textContent = "Sort";
      sort.parentElement = liveMain;
      liveMain.append(sort);
      sort.click = () => {
        menuOption = new ElementFixture("menuitemradio");
        menuOption.textContent = "Newest";
        menuOption.click = () => { menuOption = undefined; callback(); };
      };
    },
    renderOverview: (newTitle, { replaceRoot = false, hidden = false } = {}) => {
      if (tablist.isConnected) tablist.remove();
      if (replaceRoot) liveMain = new ElementFixture("main");
      for (const card of liveMain.children.filter((node) => node.role === "card" || node.role === "scroller")) card.remove();
      heading = newTitle;
      tablist = new ElementFixture("tablist");
      tablist.parentElement = liveMain;
      if (hidden) tablist.setAttribute("hidden", "");
      liveMain.append(tablist);
      const tab = new ElementFixture("tab");
      tab.parentElement = tablist;
      tab.textContent = "評論";
      tab.setAttribute("aria-label", "對「" + newTitle + "」的評論");
      tab.setAttribute("aria-selected", "false");
      tab.click = () => {
        reviewTabClicks++;
        tab.setAttribute("aria-selected", "true");
        loadCards();
      };
      tablist.append(tab);
    },
    mutate: (target = liveMain, attributeName) => {
      for (const observer of [...observers]) {
        if (!attributeName || observer.options.attributeFilter?.includes(attributeName)) {
          observer.callback([{ target, attributeName }]);
        }
      }
    },
  };
}

test("visiting a place does not inject controls, start a task or install a persistent DOM observer", () => {
  const page = setup(fixtureTabs);
  page.mutate();
  assert.deepEqual(page.createdElements, []);
  assert.equal(page.observerCount(), 0);
  assert.equal(page.reviewTabClicks(), 0);
  assert.deepEqual(page.messages, []);
});

test("recognizes the visible text when the accessible label is unrecognized", async () => {
  const page = setup([{ text: "評論", ariaLabel: "查看評論", selected: "false" }], title, { cardCount: 1 });
  assert.equal((await page.collect()).ok, true);
  assert.equal(page.reviewTabClicks(), 1);
});

test("does not assume an unverified English named label format", async () => {
  const page = setup([{ text: "", ariaLabel: "Reviews for “Noodle Shop”", selected: "false" }], "Noodle Shop");
  assert.equal((await page.collect()).errorCode, "REVIEW_ANCHOR_UNAVAILABLE");
});

test("recognizes the exact English tab text regardless of an unverified label", async () => {
  const page = setup([{ text: "Reviews", ariaLabel: "Reviews for “Noodle Shop”", selected: "false" }], "Noodle Shop", { cardCount: 1 });
  assert.equal((await page.collect()).ok, true);
  assert.equal(page.reviewTabClicks(), 1);
});

for (const name of ["茶米之家", "R&D Cafe [2F] + Bakery (A/B)", "吉祥「小廚」 Café & らーめん"]) {
  test("matches the verified named Chinese label dynamically for " + name, async () => {
    const page = setup([{ text: "", ariaLabel: "對「" + name + "」的評論", selected: "false" }], name, { cardCount: 1 });
    assert.equal((await page.collect()).ok, true);
    assert.equal(page.reviewTabClicks(), 1);
  });
}

test("selects exact visible text before a named accessible-label candidate", async () => {
  const page = setup([
    { text: "", ariaLabel: "對「" + title + "」的評論", selected: "false" },
    { text: "評論", ariaLabel: "查看評論", selected: "false" },
  ], title, { cardCount: 1 });
  const result = await page.collect();
  assert.equal(result.ok, true, result.error);
  assert.equal(page.reviewTabClicks(), 1);
});

test("ignores tabs belonging to a different nested tablist", async () => {
  const page = setup([{ text: "評論", ariaLabel: "", selected: "false", nested: true }]);
  assert.equal((await page.collect()).errorCode, "REVIEW_ANCHOR_UNAVAILABLE");
  assert.equal(page.reviewTabClicks(), 0);
});

test("rejects a named reviews tab belonging to another place", async () => {
  const page = setup([{ text: "評論", ariaLabel: "對「上一家店」的評論", selected: "false" }]);
  assert.equal((await page.collect()).errorCode, "REVIEW_ANCHOR_UNAVAILABLE");
  assert.equal(page.reviewTabClicks(), 0);
});

test("blocks collection on a search route and allows it after a place opens", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1 });
  page.navigate(null, "https://www.google.com/maps/search/ramen");
  assert.equal((await page.collect()).errorCode, "PLACE_ID_MISMATCH");
  const nextPlace = "0x3:0x4";
  page.navigate(nextPlace);
  page.renderOverview("Next shop");
  assert.equal((await page.collect(nextPlace)).data.place_id, nextPlace);
  assert.deepEqual(page.createdElements, []);
});

test("opens reviews, collects at most 50 cards and reports an unverified sort", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 55 });
  assert.equal(page.reviewTabClicks(), 0);
  const response = await page.collect();
  assert.equal(response.ok, true, response.error);
  assert.equal(page.reviewTabClicks(), 1);
  assert.equal(response.data.place_id, placeId);
  assert.equal(response.verifiedTitle, title);
  assert.equal(response.data.reviews.length, 50);
  assert.equal(response.newest, false);
  assert.deepEqual(page.messages, ["COLLECTION_STARTED"]);
});

test("does not click an already selected reviews tab and recognizes verified newest", async () => {
  const page = setup([{ text: "Reviews", ariaLabel: "Reviews", selected: "true" }], "Shop", {
    cardCount: 1, sortLabel: "Sort by: Newest",
  });
  const response = await page.collect();
  assert.equal(response.ok, true, response.error);
  assert.equal(page.reviewTabClicks(), 0);
  assert.equal(response.newest, true);
});

test("collection recognizes the same title after Maps repaints the heading", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1 });
  page.setHeading(title.replace("專門 ", "專門  "));
  page.mutate();

  const response = await page.collect();
  assert.equal(response.ok, true, response.error);
  assert.equal(page.reviewTabClicks(), 1);
  assert.equal(response.data.place_id, placeId);
});

test("waits for the same Maps tablist to reappear during a transient redraw", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1 });
  page.tablist.setAttribute("hidden", "");
  const response = page.collect();
  assert.equal(page.reviewTabClicks(), 0);
  delete page.tablist.attributes.hidden;
  page.mutate();

  const result = await response;
  assert.equal(result.ok, true, result.error);
  assert.equal(page.reviewTabClicks(), 1);
});

test("traces a verified review tab and caps the reported high-card fixture at 50", async () => {
  const fixturePlaceId = "0x3442a785188e36c3:0xb1b6e03ddc698514";
  const page = setup(fixtureTabs, title, { fixturePlaceId, cardCount: 108, debug: true });
  const result = await page.collect();
  assert.equal(result.ok, true, result.error);
  assert.equal(result.data.reviews.length, 50);
  const afterClick = page.logs.find(([event]) => event === "[Review Denoiser] content.review_tab.after_click")[1];
  assert.equal(afterClick.requestId, "fixture");
  assert.equal(afterClick.expectedPlaceId, fixturePlaceId);
  assert.equal(afterClick.currentPlaceId, fixturePlaceId);
  assert.equal(afterClick.contextFound, true);
  assert.equal(afterClick.reviewTabFound, true);
  assert.equal(afterClick.reviewTabSelected, true);
  assert.equal(afterClick.sameTablistAsBound, true);
  assert.equal(afterClick.tablists[0].tabs.length, 4);
  assert.ok(!JSON.stringify(page.logs).includes(title));
  assert.ok(!JSON.stringify(page.logs).includes("Review review-"));
});

test("distinguishes a visible review tab from a failed place-title check", async () => {
  const page = setup([{ text: "評論", ariaLabel: "查看評論", selected: "false" }], title, { debug: true });
  page.setHeading("A different title after initial binding");
  const result = await page.collect();
  assert.equal(result.error, "找不到目前地標的評論分頁。");
  assert.equal(result.errorCode, "PLACE_TITLE_MISMATCH");
  assert.equal(page.reviewTabClicks(), 0);
  const failure = page.logs.find(([event]) => event === "[Review Denoiser] content.collect.failed")[1];
  assert.equal(failure.reviewTabFound, true);
  assert.equal(failure.contextFound, false);
  assert.equal(failure.titleMatches, false);
  assert.equal(failure.errorCode, result.errorCode);
});

test("reports a different route as a place mismatch and keeps tracing off by default", async () => {
  const page = setup(fixtureTabs);
  const result = await page.collect("0x1:0x2");
  assert.equal(result.errorCode, "PLACE_ID_MISMATCH");
  assert.equal(page.reviewTabClicks(), 0);
  assert.equal(page.logs.length, 0);
});

test("rebinds a replaced titleless reviews tablist at the same place and continues collection", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1, debug: true, deferReviewDom: true });
  const original = page.tablist;
  const collection = page.collect();
  await new Promise(setImmediate);
  assert.equal(page.reviewTabClicks(), 1);
  page.removeTablist();
  page.mutate();
  page.replaceReviewDom({ replaceRoot: true });
  page.mutate();

  const response = await collection;
  assert.equal(response.ok, true, response.error);
  assert.equal(response.data.place_id, placeId);
  assert.equal(response.data.reviews.length, 1);
  assert.equal(original.isConnected, false);
  assert.equal(page.reviewTabClicks(), 1);
  const rebound = page.logs.find(([event]) => event === "[Review Denoiser] content.review_binding.rebound");
  assert.equal(rebound[1].titleSource, "review_label");
  assert.deepEqual(page.messages, ["COLLECTION_STARTED"]);
});

test("continues DOM rebinding across the reported overview-to-reviews URL update", async () => {
  const tabs = fixtureTabs.map((tab) => ({ ...tab, ariaLabel: tab.ariaLabel.replace(title, hotpotTitle) }));
  const page = setup(tabs, hotpotTitle, { fixturePlaceId: hotpotPlace, cardCount: 1, deferReviewDom: true });
  page.navigate(hotpotPlace, hotpotOverviewUrl);
  const collection = page.collect();
  await new Promise(setImmediate);
  assert.equal(page.reviewTabClicks(), 1);

  page.navigate(hotpotPlace, hotpotReviewsUrl);
  page.replaceReviewDom({ namedTitle: hotpotTitle, replaceRoot: true });
  page.mutate();

  const response = await collection;
  assert.equal(response.ok, true, response.error);
  assert.equal(response.data.place_id, hotpotPlace);
  assert.equal(response.data.reviews.length, 1);
  assert.deepEqual(page.messages, ["COLLECTION_STARTED"]);
});

test("rejects a titleless selected tab whose named label identifies a different place", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1, deferReviewDom: true });
  const collection = page.collect();
  await new Promise(setImmediate);
  page.replaceReviewDom({ namedTitle: "不同店家" });
  page.mutate();
  const response = await collection;
  assert.equal(response.errorCode, "REVIEW_PLACE_UNVERIFIED");
  assert.deepEqual(page.messages, []);
});

test("reports a DOM timeout if the reviews tablist never comes back", async () => {
  const page = setup(fixtureTabs, title, { deferReviewDom: true });
  const collection = page.collect();
  await new Promise(setImmediate);
  page.removeTablist();
  page.mutate();
  assert.equal((await collection).errorCode, "REVIEW_DOM_TIMEOUT");
});

test("stops waiting if the place changes during rebinding", async () => {
  const page = setup(fixtureTabs, title, { deferReviewDom: true });
  const collection = page.collect();
  await new Promise(setImmediate);
  page.removeTablist();
  page.navigate("0x1:0x2");
  page.mutate();
  assert.equal((await collection).errorCode, "PLACE_ID_MISMATCH");
  assert.ok(!page.messages.includes("COLLECTION_STARTED"));
});

test("keeps explicit cancellation distinct from a DOM timeout", async () => {
  const page = setup(fixtureTabs, title, { deferReviewDom: true });
  const collection = page.collect();
  await new Promise(setImmediate);
  page.removeTablist();
  page.cancel("COLLECTION_CANCELLED");
  assert.equal((await collection).errorCode, "COLLECTION_CANCELLED");
});

test("collects from a verified titleless reviews view and again from the overview", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1 });
  page.replaceReviewDom();
  assert.equal((await page.collect()).ok, true);
  assert.equal(page.reviewTabClicks(), 0);
  page.renderOverview(title);
  assert.equal((await page.collect()).ok, true);
  assert.equal(page.reviewTabClicks(), 1);
  assert.deepEqual(page.messages, ["COLLECTION_STARTED", "COLLECTION_STARTED"]);
});

test("waits for the next place to become visible after a completed collection", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1 });
  assert.equal((await page.collect()).ok, true);
  const nextId = "0x3:0x4";
  page.navigate(nextId);
  page.renderOverview("New shop", { replaceRoot: true, hidden: true });
  const next = page.collect(nextId);
  assert.equal(page.reviewTabClicks(), 1);
  delete page.tablist.attributes.hidden;
  page.mutate(page.tablist, "hidden");
  assert.deepEqual(page.messages, ["COLLECTION_STARTED", "MAPS_PLACE_CHANGED"]);
  assert.equal((await next).data.place_id, nextId);
});

test("collects only the requested place in an A → B → C → A sequence with a reused root", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1 });
  assert.equal((await page.collect()).data.place_id, placeId);
  let previousId = placeId;
  for (const [id, name] of [["0x3:0x4", "Shop B"], ["0x5:0x6", "Shop C"], [placeId, title]]) {
    page.navigate(id, dualPlaceUrl(previousId, id));
    assert.equal((await page.collect(id)).errorCode, "PLACE_BINDING_MISMATCH", "must not adopt the old place's DOM");
    page.renderOverview(name);
    const result = await page.collect(id);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.data.place_id, id);
    assert.deepEqual(Array.from(result.data.reviews, (review) => review.review_id), [page.reviewId(0, id)]);
    previousId = id;
  }
  assert.deepEqual(page.createdElements, []);
  assert.equal(page.observerCount(), 0);
});

test("captures the outgoing place on navigation even when it was never analyzed", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1 });
  page.navigate("0x3:0x4");
  page.renderOverview("Shop B");
  page.navigate("0x5:0x6");
  assert.equal((await page.collect("0x5:0x6")).errorCode, "PLACE_BINDING_MISMATCH");
  assert.equal(page.reviewTabClicks(), 0);
  assert.deepEqual(page.messages, ["MAPS_PLACE_CHANGED", "MAPS_PLACE_CHANGED"]);

  page.renderOverview("Shop C");
  const result = await page.collect("0x5:0x6");
  assert.equal(result.data.reviews[0].review_id, page.reviewId(0));
});

test("cancels collection A on navigation before allowing an explicit request for B", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1, deferReviewDom: true });
  const old = page.collect();
  await new Promise(setImmediate);
  const nextId = "0x3:0x4";
  page.navigate(nextId);
  page.renderOverview("Shop B", { replaceRoot: true });
  assert.equal((await old).errorCode, "PLACE_ID_MISMATCH");
  assert.deepEqual(page.messages, ["MAPS_PLACE_CHANGED"]);
  assert.equal((await page.collect(nextId)).data.place_id, nextId);
});

test("a dual-place URL permits only the selected place B to collect", async () => {
  const page = setup(fixtureTabs, title, { fixturePlaceId: previousPlace, cardCount: 1 });
  page.navigate(selectedPlace, observedDualPlaceUrl);
  assert.equal((await page.collect(selectedPlace)).errorCode, "PLACE_BINDING_MISMATCH");
  page.renderOverview("IDK Café & Restaurant", { replaceRoot: true });
  assert.equal((await page.collect(previousPlace)).errorCode, "PLACE_ID_MISMATCH");
  assert.equal((await page.collect(selectedPlace)).data.place_id, selectedPlace);
  assert.deepEqual(page.messages, ["MAPS_PLACE_CHANGED", "COLLECTION_STARTED"]);
});

test("an ambiguous multi-place URL blocks collection", async () => {
  const page = setup(fixtureTabs, title, { fixturePlaceId: previousPlace, cardCount: 1 });
  page.navigate(selectedPlace, placePath + "/data=!1s" + previousPlace + "!1s" + selectedPlace);
  page.mutate();
  assert.equal((await page.collect(selectedPlace)).errorCode, "PLACE_ID_MISMATCH");
  assert.deepEqual(page.messages, ["MAPS_PLACE_CHANGED"]);
});

test("the collection waits through the tablist gap and releases its observer", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1, debug: true, deferReviewDom: true });
  const collection = page.collect();
  await new Promise(setImmediate);
  assert.equal(page.reviewTabClicks(), 1);

  page.removeTablist();
  page.mutate();
  assert.equal(page.observerCount(), 1);
  assert.deepEqual(page.messages, []);

  page.replaceReviewDom({ replaceRoot: true });
  page.mutate();
  const response = await collection;
  assert.equal(response.ok, true, response.error);
  assert.equal(response.data.place_id, placeId);
  assert.equal(response.data.reviews.length, 1);
  assert.equal(page.observerCount(), 0);
  assert.deepEqual(page.messages, ["COLLECTION_STARTED"]);
});

test("a persistent document-wide tablist gap times out and releases its observer", async () => {
  const page = setup(fixtureTabs, title, { debug: true, deferReviewDom: true });
  const collection = page.collect();
  await new Promise(setImmediate);
  assert.equal(page.reviewTabClicks(), 1);
  page.removeTablist();
  page.mutate();
  assert.equal((await collection).errorCode, "REVIEW_DOM_TIMEOUT");
  assert.equal(page.observerCount(), 0);
  const [, details] = page.logs.find(([event]) => event === "[Review Denoiser] content.review_binding.failed");
  assert.equal(details.phase, "after_click");
  assert.equal(details.tablistCount, 0);
  assert.deepEqual(page.messages, []);
});

test("collects 50 distinct reviews through the named main when navigation disappears mid-scroll", async () => {
  const shop = "台灣香辣太傅";
  const tabs = fixtureTabs.map((tab) => ({ ...tab, ariaLabel: tab.ariaLabel.replace(title, shop) }));
  const page = setup(tabs, shop, { cardCount: 30, scrollReviews: true, debug: true });
  let domMatches;
  page.nextScroll(() => {
    const firstPage = Array.from({ length: 261 }, (_, index) => page.reviewId(index % 30));
    domMatches = firstPage.length;
    const append = page.replaceWithTabless({ ids: firstPage });
    page.nextScroll(() => {
      const nextIds = Array.from({ length: 30 }, (_, index) => page.reviewId(index + 30));
      append(nextIds);
    });
    page.mutate();
  });
  const result = await page.collect();
  assert.equal(result.ok, true, result.error);
  assert.equal(domMatches, 261);
  assert.equal(page.tablist.isConnected, false);
  assert.equal(page.scrollCalls(), 2);
  assert.equal(result.data.reviews.length, 50);
  assert.equal(new Set(result.data.reviews.map((item) => item.review_id)).size, 50);
  assert.equal(result.data.reviews.at(-1).review_id, page.reviewId(49));
  const transition = page.logs.find(([event, detail]) =>
    event === "[Review Denoiser] content.review_binding.rebound" && detail.mode === "tabless");
  assert.equal(transition[1].phase, "collecting");
  assert.deepEqual(page.messages, ["COLLECTION_STARTED"]);
});

test("does not adopt a named main if reviews were never verified as selected", async () => {
  const page = setup(fixtureTabs, title, { deferReviewDom: true });
  const collection = page.collect();
  await new Promise(setImmediate);
  page.replaceWithTabless({ ids: [page.reviewId(0)] });
  page.mutate();
  assert.equal((await collection).errorCode, "REVIEW_PLACE_UNVERIFIED");
  assert.equal(page.scrollCalls(), 0);
  assert.deepEqual(page.messages, []);
});

for (const [label, configuration] of [
  ["a nonmatching main label", { mainLabel: "Unrelated store" }],
  ["more than one visible main", { multipleMains: true }],
  ["cards with no verified inner scroller", { scrollable: false }],
]) {
  test("rejects a tabless view with " + label, async () => {
    const page = setup(fixtureTabs, title, { cardCount: 1, scrollReviews: true });
    page.nextScroll(() => page.replaceWithTabless({ ids: [page.reviewId(1)], ...configuration }));
    const result = await page.collect();
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "REVIEW_PLACE_UNVERIFIED");
    assert.equal(page.scrollCalls(), 1);
  });
}

test("does not read cloned review IDs from the previous place in the tabless view", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1, scrollReviews: true });
  const oldReviewId = page.reviewId(0);
  assert.equal((await page.collect()).ok, true);
  const nextPlaceId = "0x3:0x4";
  page.navigate(nextPlaceId);
  page.renderOverview("Next shop", { replaceRoot: true });
  page.mutate();
  const nextReviewId = page.reviewId(1);
  page.nextScroll(() => page.replaceWithTabless({ ids: [nextReviewId, oldReviewId] }));
  const response = await page.collect(nextPlaceId);
  assert.equal(response.ok, false);
  assert.equal(response.errorCode, "REVIEW_PLACE_UNVERIFIED");
});

test("resolves the same place after selecting Newest rebuilds its review DOM", async () => {
  const page = setup(fixtureTabs, title, { cardCount: 1 });
  const originalTablist = page.tablist;
  let sorted = false;
  page.onSort(() => {
    sorted = true;
    page.replaceReviewDom({ replaceRoot: true });
  });
  const result = await page.collect();
  assert.equal(sorted, true);
  assert.equal(originalTablist.isConnected, false);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.newest, false, "the rebuilt view has not confirmed the selected sort");
  assert.equal(result.data.reviews.length, 1);
});

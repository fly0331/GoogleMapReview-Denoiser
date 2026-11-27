const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const {
  previousPlace, selectedPlace, observedDualPlaceUrl, placePath, dualPlaceUrl,
  hotpotPlace, hotpotOverviewUrl, hotpotReviewsUrl,
} = require("./maps-url-fixtures.cjs");

const placeId = "0x1:0x2";
const placeUrl = 'https://www.google.com/maps/place/shop/data=!1s' + placeId;
const panelUrl = "chrome-extension://extension/index.html";
const key = "analysis-task:7";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function setup(initialUrl = placeUrl) {
  const values = {};
  let collection = deferred();
  let analysis = deferred();
  const events = [];
  const panelBehaviors = [];
  const logs = [];
  const collectionRequests = [];
  const tab = { id: 7, url: initialUrl };
  let pendingTabRead;
  let receive;
  let update;
  let signal;
  let sequence = 0;
  const scope = {
    URL, Error, AbortController, setTimeout, clearTimeout,
    console: { ...console, debug: (...args) => logs.push(args) },
    crypto: { randomUUID: () => "request-" + ++sequence },
    chrome: {
      sidePanel: {
        setPanelBehavior: async (behavior) => { panelBehaviors.push({ ...behavior }); },
      },
      runtime: {
        id: "extension", getURL: () => panelUrl,
        onMessage: { addListener: (fn) => { receive = fn; } },
      },
      storage: { session: {
        get: async (name) => ({ [name]: values[name] }),
        set: async (items) => { Object.assign(values, items); },
        remove: async (name) => { delete values[name]; },
      } },
      tabs: {
        get: async () => { if (pendingTabRead) await pendingTabRead.promise; return tab; },
        sendMessage: async (_, request) => {
          events.push(request.type);
          if (request.type === "COLLECT_FOR_ANALYSIS") {
            collectionRequests.push(request);
            return collection.promise;
          }
        },
        onUpdated: { addListener: (fn) => { update = fn; } },
        onRemoved: { addListener() {} },
      },
    },
    require(name) {
      if (name === "./api") return { analyzeReviews: async (_, abortSignal) => {
        events.push("POST");
        signal = abortSignal;
        return analysis.promise;
      } };
      const module = { ...scope, exports: {} };
      const source = fs.readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8");
      vm.runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText, module);
      return module.exports;
    },
  };
  scope.require("./background");
  const contentSender = { id: "extension", tab, frameId: 0 };
  const panelSender = { id: "extension", url: panelUrl };
  const call = (message, sender) => new Promise((resolve) => receive(message, sender, resolve));
  const sendFromPanel = (message) => call(message, panelSender);
  const snapshot = () => sendFromPanel({ type: "GET_ANALYSIS_STATE", tabId: 7 });
  const start = (options = {}) => sendFromPanel({ type: "START_FROM_PANEL", tabId: 7, placeId, ...options });
  return {
    events, panelBehaviors, values, start, snapshot, logs, collectionRequests, tab, sendFromPanel,
    sendFromMaps: (type) => receive({ type, tabId: tab.id, placeId }, { ...contentSender, url: tab.url }, assert.fail),
    deferTabRead: () => { pendingTabRead = deferred(); return pendingTabRead; },
    restart: () => { scope.require("./background"); },
    get collection() { return collection; },
    get analysis() { return analysis; },
    resetResponses: () => { collection = deferred(); analysis = deferred(); },
    signal: () => signal,
    collecting: (requestId = "request-1", verifiedTitle, url = tab.url) =>
      receive({ type: "COLLECTION_STARTED", requestId, verifiedTitle }, { ...contentSender, url }),
    verified: (verifiedTitle, overrides = {}, sender = {}) =>
      receive({ type: "MERCHANT_VERIFIED", requestId: "request-1", placeId, verifiedTitle, ...overrides },
        { ...contentSender, url: tab.url, ...sender }),
    progress: (count, overrides = {}, sender = {}) =>
      receive({ type: "COLLECTION_PROGRESS", requestId: "request-1", placeId, count, ...overrides },
        { ...contentSender, url: tab.url, ...sender }),
    samePlaceLoading: () => {
      update(tab.id, { status: "loading" });
      update(tab.id, { status: "loading", url: tab.url });
    },
    navigate: (nextPlace = "0x3:0x4", href = placeUrl.replace(placeId, nextPlace)) => {
      tab.url = href;
      update(tab.id, { url: tab.url });
    },
  };
}

const reviews = [{ review_id: "r1", rating: 5, text: "Helpful and friendly" }];
const collectionResponse = { ok: true, newest: false, verifiedTitle: "測試商家", data: { place_id: placeId, reviews } };

test("persists the verified merchant while opening reviews and after a binding failure", async () => {
  const worker = setup();
  await worker.start();
  worker.verified("過期名稱", { requestId: "old" });
  worker.verified("其他商家", { placeId: "0x3:0x4" });
  worker.verified("非頂層", {}, { frameId: 1 });
  worker.verified("其他分頁", {}, { tab: { id: 8 } });
  assert.equal((await worker.snapshot()).verifiedTitle, undefined);
  worker.verified(" 已驗證商家 ");
  assert.equal((await worker.snapshot()).phase, "opening_reviews");
  assert.equal(worker.values[key].verifiedTitle, "已驗證商家");
  worker.collection.resolve({ ok: false, errorCode: "REVIEW_DOM_TIMEOUT", error: "評論載入逾時" });
  await flush();
  assert.equal((await worker.snapshot()).phase, "failed");
  assert.equal((await worker.snapshot()).verifiedTitle, "已驗證商家");
  assert.ok(!worker.events.includes("POST"));
});

test("recovers the verified title from the active failure reply if notification was missed", async () => {
  const worker = setup();
  await worker.start();
  worker.collection.resolve({
    ok: false, errorCode: "REVIEW_DOM_TIMEOUT", error: "評論載入逾時", verifiedTitle: "已驗證商家",
  });
  await flush();
  assert.equal((await worker.snapshot()).verifiedTitle, "已驗證商家");
});

test("keeps a title from the collection reply even when collection-start source URL is stale", async () => {
  const worker = setup();
  await worker.start();
  worker.collecting("request-1", "其他商家", placeUrl.replace(placeId, "0x3:0x4"));
  assert.equal((await worker.snapshot()).verifiedTitle, undefined);
  worker.collection.resolve({ ...collectionResponse, verifiedTitle: "正確商家" });
  await flush();
  assert.equal((await worker.snapshot()).phase, "analyzing");
  assert.equal((await worker.snapshot()).verifiedTitle, "正確商家");
  worker.analysis.resolve({ analyzed_count: 1 });
  await flush();
  worker.restart();
  const restored = await worker.snapshot();
  assert.equal(restored.phase, "done");
  assert.equal(restored.verifiedTitle, "正確商家");
});

test("does not create a nameless result from a legacy reply without a verified title", async () => {
  const worker = setup();
  await worker.start();
  worker.collection.resolve({ ...collectionResponse, verifiedTitle: undefined });
  await flush();
  assert.equal((await worker.snapshot()).phase, "failed");
  assert.ok(!worker.events.includes("POST"));
});

test("progress accepts only monotonic verified updates and reconciles the final count from the collection reply", async () => {
  const worker = setup();
  await worker.start();
  worker.progress(1);
  assert.equal((await worker.snapshot()).collectionProgress, undefined);
  worker.collecting();
  worker.progress(1, { requestId: "old-request" });
  worker.progress(1, { placeId: "0x3:0x4" });
  worker.progress(1, {}, { frameId: 1 });
  worker.progress(1, {}, { tab: { id: 8 } });
  worker.progress(51);
  worker.progress(0.5);
  assert.equal((await worker.snapshot()).collectionProgress.count, 0);
  worker.progress(1);
  worker.progress(0);
  assert.equal((await worker.snapshot()).collectionProgress.count, 1);
  assert.equal(worker.values[key].collectionProgress.count, 1);
  worker.collection.resolve({ ...collectionResponse, data: {
    ...collectionResponse.data, reviews: [...reviews, { ...reviews[0], review_id: "r2" }],
  } });
  await flush();
  worker.progress(10);
  assert.equal((await worker.snapshot()).phase, "analyzing");
  assert.equal((await worker.snapshot()).collectionProgress.count, 2);
  worker.analysis.resolve({ analyzed_count: 1 });
  await flush();
  worker.progress(20);
  assert.equal((await worker.snapshot()).collectionProgress.count, 2);
  assert.equal((await worker.snapshot()).result.analyzed_count, 1);
  assert.equal(worker.events.filter((event) => event === "POST").length, 1);
});

test("progress from a cancelled task cannot update a new task for the same place", async () => {
  const worker = setup();
  await worker.start();
  worker.collecting();
  worker.progress(1);
  const previous = worker.collection;
  worker.navigate();
  worker.navigate(placeId);
  worker.resetResponses();
  await worker.start();
  worker.collecting("request-2");
  worker.progress(10);
  assert.equal((await worker.snapshot()).collectionProgress.count, 0);
  worker.progress(1, { requestId: "request-2" });
  assert.equal((await worker.snapshot()).collectionProgress.count, 1);
  previous.resolve(collectionResponse);
  worker.collection.resolve({ ok: false, error: "fixture" });
  await flush();
  worker.progress(20, { requestId: "request-2" });
  assert.equal((await worker.snapshot()).phase, "failed");
  assert.equal((await worker.snapshot()).failedPhase, "collecting");
  assert.equal((await worker.snapshot()).collectionProgress.count, 1);
});

test("initializes native toolbar opening without starting an analysis", async () => {
  const worker = setup();
  assert.deepEqual(worker.panelBehaviors, [{ openPanelOnActionClick: true }]);
  assert.equal(await worker.snapshot(), undefined);
  assert.deepEqual(worker.events, []);
});

test("a panel click starts one task, deduplicates subsequent clicks and restores the completed result", async () => {
  const worker = setup();
  assert.deepEqual(worker.events, []);
  const ack = worker.start();
  const replies = await Promise.all([ack, worker.start()]);
  assert.ok(replies.every((reply) => reply.ok));
  await flush();
  assert.equal((await worker.snapshot()).phase, "opening_reviews");
  worker.collecting();
  assert.equal((await worker.snapshot()).phase, "collecting");
  await worker.start();
  worker.collection.resolve(collectionResponse);
  await flush();
  assert.equal((await worker.snapshot()).phase, "analyzing");
  worker.analysis.resolve({ model_id: "gemini-fixture" });
  await flush();
  const restored = await worker.snapshot();
  assert.equal(restored.phase, "done");
  assert.equal(restored.newest, false);
  assert.equal(restored.result.model_id, "gemini-fixture");
  assert.equal(restored.reviews[0].review_id, "r1");
  assert.deepEqual(worker.events, ["COLLECT_FOR_ANALYSIS", "POST"]);
});

test("navigation aborts an ongoing POST and rejects the late result", async () => {
  const worker = setup();
  await worker.start();
  worker.collection.resolve(collectionResponse);
  await flush();
  worker.navigate();
  assert.equal(worker.signal().aborted, true);
  worker.analysis.resolve({ model_id: "late" });
  await flush();
  assert.equal(await worker.snapshot(), undefined);
  assert.equal(worker.values[key], undefined);
  assert.deepEqual(worker.events, ["COLLECT_FOR_ANALYSIS", "POST", "CANCEL_COLLECTION"]);
});

test("restores a verified title when the panel reopens during analysis and after completion", async () => {
  const worker = setup();
  await worker.start();
  const requestId = worker.collectionRequests[0].requestId;
  worker.collecting(requestId, "同名餐廳");
  const collecting = await worker.snapshot();
  assert.equal(collecting.phase, "collecting");
  assert.equal(collecting.requestId, requestId);
  assert.equal(collecting.tabId, 7);
  assert.equal(collecting.placeId, placeId);
  assert.equal(collecting.verifiedTitle, "同名餐廳");
  worker.collection.resolve({ ...collectionResponse, verifiedTitle: "同名餐廳" });
  await flush();
  assert.equal((await worker.snapshot()).verifiedTitle, "同名餐廳");
  worker.analysis.resolve({ model_id: "fixture" });
  await flush();
  assert.equal((await worker.snapshot()).verifiedTitle, "同名餐廳");
});

test("ignores late collection messages and replies across same-name merchants", async () => {
  const worker = setup();
  const nextPlace = "0x3:0x4";
  await worker.start();
  const firstRequest = worker.collectionRequests[0].requestId;
  const firstCollection = worker.collection;
  worker.collecting(firstRequest, "同名餐廳");
  worker.navigate(nextPlace);
  worker.resetResponses();
  await worker.start({ placeId: nextPlace });
  const nextRequest = worker.collectionRequests[1].requestId;
  worker.collecting(firstRequest, "過期名稱");
  worker.collecting(nextRequest, "錯誤分頁位置", placeUrl);
  assert.equal((await worker.snapshot()).verifiedTitle, undefined);
  assert.equal((await worker.snapshot()).phase, "opening_reviews");
  worker.collecting(nextRequest, "同名餐廳");
  firstCollection.resolve({ ...collectionResponse, verifiedTitle: "過期名稱" });
  await flush();
  const current = await worker.snapshot();
  assert.equal(current.placeId, nextPlace);
  assert.equal(current.requestId, nextRequest);
  assert.equal(current.verifiedTitle, "同名餐廳");
  assert.ok(!worker.events.includes("POST"));
  worker.collection.resolve({ ...collectionResponse, data: { place_id: nextPlace, reviews } });
  await flush();
  worker.analysis.resolve({ model_id: "second-merchant" });
  await flush();
  assert.equal((await worker.snapshot()).result.model_id, "second-merchant");
  worker.navigate(placeId);
  assert.equal(await worker.snapshot(), undefined);
});

test("can restore a completed session snapshot created before verifiedTitle", async () => {
  const worker = setup();
  worker.values[key] = { tabId: 7, placeId, requestId: "legacy", phase: "done", result: { model_id: "legacy" } };
  const restored = await worker.snapshot();
  assert.equal(restored.phase, "done");
  assert.equal(restored.verifiedTitle, undefined);
  assert.equal(restored.result.model_id, "legacy");
});

test("keeps the existing task across same-place loading events and submits exactly once", async () => {
  const worker = setup();
  await worker.start();
  await flush();
  worker.samePlaceLoading();
  assert.equal((await worker.snapshot()).phase, "opening_reviews");
  worker.collection.resolve(collectionResponse);
  await flush();
  assert.equal((await worker.snapshot()).phase, "analyzing");
  worker.analysis.resolve({ model_id: "gemini-fixture" });
  await flush();
  assert.equal((await worker.snapshot()).phase, "done");
  assert.deepEqual(worker.events, ["COLLECT_FOR_ANALYSIS", "POST"]);
});

test("rejects a late reply from A after a dual-place navigation selects B", async () => {
  const worker = setup(placePath + "/data=!1s" + previousPlace);
  await worker.start({ placeId: previousPlace });
  await flush();
  const oldCollection = worker.collection;
  worker.navigate(selectedPlace, observedDualPlaceUrl);
  oldCollection.resolve({ ...collectionResponse, data: { ...collectionResponse.data, place_id: previousPlace } });
  await flush();
  assert.equal(await worker.snapshot(), undefined);
  assert.ok(!worker.events.includes("POST"));

  worker.resetResponses();
  await worker.start({ placeId: selectedPlace });
  await flush();
  assert.equal(worker.collectionRequests.at(-1).placeId, selectedPlace);
  worker.navigate(selectedPlace, dualPlaceUrl(previousPlace, selectedPlace, { reviews: true }) + "?sort=newest#scroll");
  worker.collection.resolve({ ...collectionResponse, data: { ...collectionResponse.data, place_id: selectedPlace } });
  await flush();
  assert.equal((await worker.snapshot()).phase, "analyzing");
  worker.analysis.resolve({ model_id: "gemini-fixture" });
  await flush();
  assert.equal((await worker.snapshot()).placeId, selectedPlace);
  assert.equal(worker.events.filter((event) => event === "POST").length, 1);
});

test("never posts a collection tagged as B to an active A task", async () => {
  const worker = setup(placePath + "/data=!1s" + previousPlace);
  await worker.start({ placeId: previousPlace });
  worker.collection.resolve({ ...collectionResponse, data: { ...collectionResponse.data, place_id: selectedPlace } });
  await flush();
  assert.equal((await worker.snapshot()).phase, "failed");
  assert.ok(!worker.events.includes("POST"));
});

test("keeps the active task after the reported reviews URL update and submits once", async () => {
  const worker = setup(hotpotOverviewUrl);
  await worker.start({ placeId: hotpotPlace });
  await flush();
  assert.equal(worker.collectionRequests.at(-1).placeId, hotpotPlace);
  worker.navigate(hotpotPlace, hotpotReviewsUrl);
  assert.equal((await worker.snapshot())?.requestId, worker.collectionRequests[0].requestId);
  worker.collection.resolve({ ...collectionResponse, data: { ...collectionResponse.data, place_id: hotpotPlace } });
  await flush();
  worker.analysis.resolve({ model_id: "gemini-fixture" });
  await flush();
  assert.equal((await worker.snapshot()).phase, "done");
  assert.deepEqual(worker.events, ["COLLECT_FOR_ANALYSIS", "POST"]);
});

test("A → B → C → A starts tasks only on panel clicks and posts once per place visit", async () => {
  const worker = setup();
  for (const [index, nextPlace] of [placeId, "0x3:0x4", "0x5:0x6", placeId].entries()) {
    if (index) worker.navigate(nextPlace);
    await flush();
    assert.equal(await worker.snapshot(), undefined);
    assert.equal(worker.events.filter((event) => event === "POST").length, index);
    worker.resetResponses();
    const replies = await Promise.all([worker.start({ placeId: nextPlace }), worker.start({ placeId: nextPlace })]);
    assert.ok(replies.every((reply) => reply.ok));
    assert.equal(worker.collectionRequests.length, index + 1);
    const request = worker.collectionRequests.at(-1);
    assert.equal(request.placeId, nextPlace);
    worker.collection.resolve({ ...collectionResponse, data: { ...collectionResponse.data, place_id: nextPlace } });
    await flush();
    worker.analysis.resolve({ model_id: "model-" + index });
    await flush();
    const task = await worker.snapshot();
    assert.equal(task.placeId, nextPlace);
    assert.equal(task.requestId, request.requestId);
    assert.equal(task.result.model_id, "model-" + index);
    assert.equal(worker.events.filter((event) => event === "POST").length, index + 1);
  }
});

test("ignores both retired and forged analysis start messages from Maps", async () => {
  const worker = setup();
  assert.equal(worker.sendFromMaps("OPEN_ANALYSIS_PANEL"), undefined);
  assert.equal(worker.sendFromMaps("START_FROM_PANEL"), undefined);
  assert.deepEqual(worker.events, []);
  assert.equal(await worker.snapshot(), undefined);
});

test("rejects the old place when navigation finishes before panel start is validated", async () => {
  const worker = setup();
  const pendingTab = worker.deferTabRead();
  const ack = worker.start();
  worker.navigate();
  pendingTab.resolve();
  assert.equal((await ack).errorCode, "PLACE_ID_MISMATCH");
  assert.deepEqual(worker.events, []);
  assert.equal(await worker.snapshot(), undefined);
});

test("restores completed results after worker restart and runs only a new explicit request", async () => {
  const worker = setup();
  worker.values[key] = { requestId: "completed", phase: "done", placeId, tabId: 7, result: { model_id: "first" } };
  worker.restart();
  assert.equal((await worker.snapshot()).result.model_id, "first");
  assert.deepEqual(worker.events, []);

  const replies = await Promise.all([worker.start(), worker.start()]);
  assert.ok(replies.every((reply) => reply.ok));
  worker.collection.resolve(collectionResponse);
  await flush();
  worker.analysis.resolve({ model_id: "after restart" });
  await flush();
  assert.deepEqual(worker.events, ["COLLECT_FOR_ANALYSIS", "POST"]);
  assert.equal((await worker.snapshot()).requestId, worker.collectionRequests[0].requestId);
  assert.equal((await worker.snapshot()).result.model_id, "after restart");
});

test("a recovered unfinished snapshot fails without automatically replaying a request", async () => {
  const worker = setup();
  worker.values[key] = { requestId: "old", phase: "analyzing", placeId, tabId: 7 };
  assert.equal((await worker.snapshot()).phase, "failed");
  assert.deepEqual(worker.events, []);
});

test("correlates the panel click, collection dispatch and content error code without posting", async () => {
  const worker = setup();
  await worker.start({ debug: true });
  await flush();
  const requestId = worker.collectionRequests[0].requestId;
  assert.equal(worker.collectionRequests[0].placeId, placeId);
  assert.equal(worker.collectionRequests[0].debug, true);

  worker.collection.resolve({ ok: false, error: "Fixture failure", errorCode: "PLACE_TITLE_MISMATCH" });
  await flush();
  assert.equal((await worker.snapshot()).phase, "failed");
  assert.deepEqual(worker.events, ["COLLECT_FOR_ANALYSIS"]);
  assert.deepEqual(worker.logs.map(([event, detail]) => [event, detail.requestId]), [
    ["[Review Denoiser] worker.start", requestId],
    ["[Review Denoiser] worker.collect.dispatch", requestId],
    ["[Review Denoiser] worker.collect.reply", requestId],
  ]);
  assert.equal(worker.logs.at(-1)[1].errorCode, "PLACE_TITLE_MISMATCH");
});

test("the panel button starts analysis and a reopened panel restores and refreshes results", async () => {
  const worker = setup();
  const stateUpdates = [];
  const noopEvent = { addListener() {}, removeListener() {} };
  let storageChanged;
  let cleanup;
  let click;
  let tabUpdated;
  let mounted = false;
  let panelState;
  let actions;
  const source = fs.readFileSync(path.join(__dirname, "../src/App.tsx"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

  const render = (tag, props) => {
    if (tag === "button") click = props.disabled ? undefined : props.onClick;
    return null;
  };
  const scope = {
    exports: {}, URL, setTimeout, clearTimeout,
    chrome: {
      tabs: {
        query: async () => [worker.tab],
        onActivated: noopEvent, onUpdated: {
          addListener: (listener) => { tabUpdated = listener; },
          removeListener: () => { tabUpdated = undefined; },
        },
      },
      storage: { onChanged: {
        addListener: (listener) => { storageChanged = listener; },
        removeListener: () => { storageChanged = undefined; },
      } },
      runtime: { sendMessage: worker.sendFromPanel },
    },
    require(name) {
      if (name === "react") return {
        useState: (initial) => [panelState ?? initial, (value) => {
          panelState = value;
          stateUpdates.push(value);
        }],
        useRef: () => actions ??= { current: undefined },
        useEffect: (effect) => {
          if (mounted) return;
          mounted = true;
          const dispose = effect();
          cleanup = () => {
            dispose();
            mounted = false;
            panelState = undefined;
            actions = undefined;
          };
        },
      };
      if (name === "react/jsx-runtime") return { jsx: render, jsxs: render };
      const source = fs.readFileSync(path.join(__dirname, "../src", name + ".ts"), "utf8");
      const module = { exports: {}, URL };
      vm.runInNewContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText, module);
      return module.exports;
    },
  };
  vm.runInNewContext(compiled, scope);
  scope.exports.default();
  await flush();
  assert.deepEqual(worker.events, []);
  scope.exports.default();
  click();
  await flush();
  assert.equal((await worker.snapshot()).phase, "opening_reviews");
  worker.collecting("request-1", "原商家");
  worker.progress(1);
  cleanup();
  scope.exports.default();
  await flush();
  assert.equal(panelState.task.phase, "collecting");
  assert.equal(panelState.task.verifiedTitle, "原商家");
  assert.equal(panelState.task.collectionProgress.count, 1);
  worker.collection.resolve({ ...collectionResponse, verifiedTitle: "原商家" });
  await flush();
  assert.equal((await worker.snapshot()).phase, "analyzing");
  cleanup();
  assert.equal(storageChanged, undefined);
  assert.equal(worker.signal().aborted, false);
  scope.exports.default();
  await flush();
  assert.equal(panelState.task.phase, "analyzing");
  assert.equal(panelState.task.verifiedTitle, "原商家");
  cleanup();
  worker.analysis.resolve({ model_id: "first" });
  await flush();
  assert.equal((await worker.snapshot()).phase, "done");

  scope.exports.default();
  await flush();
  assert.equal(stateUpdates.at(-1).task.result.model_id, "first");
  assert.deepEqual(worker.events, ["COLLECT_FOR_ANALYSIS", "POST"]);

  const secondPlace = "0x3:0x4";
  worker.navigate(secondPlace);
  tabUpdated(worker.tab.id, { url: worker.tab.url });
  assert.equal(panelState.kind, "checking");
  assert.equal(panelState.task, undefined);
  worker.resetResponses();
  await flush();
  scope.exports.default();
  click();
  await flush();
  worker.collection.resolve({ ...collectionResponse, data: { ...collectionResponse.data, place_id: secondPlace } });
  await flush();
  worker.analysis.resolve({ model_id: "second" });
  await flush();
  storageChanged({ [key]: { newValue: worker.values[key] } }, "session");
  await flush();
  assert.equal(stateUpdates.at(-1).task.result.model_id, "second");
  assert.deepEqual(worker.events, ["COLLECT_FOR_ANALYSIS", "POST", "COLLECT_FOR_ANALYSIS", "POST"]);
  cleanup();
});

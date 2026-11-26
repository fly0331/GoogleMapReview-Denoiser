import { analyzeReviews } from "./api";
import {
  taskKey, type AnalysisTask, type CollectionRequest, type CollectionResponse, type StartAnalysisResponse,
} from "./analysis-task";
import { getMapsPlaceId, logReviewTrace } from "./maps-context";

interface ActiveTask {
  snapshot: AnalysisTask;
  abort: AbortController;
  debug: boolean;
}

const active = new Map<number, ActiveTask>();
const COLLECTION_TIMEOUT_MS = 65_000;
const ANALYSIS_DEADLINE_MS = 65_000;
const inProgress = (task: AnalysisTask) => task.phase !== "done" && task.phase !== "failed";

function publish(task: ActiveTask, update: Partial<AnalysisTask> = {}) {
  if (active.get(task.snapshot.tabId) !== task) return;
  task.snapshot = { ...task.snapshot, ...update };
  return chrome.storage.session.set({ [taskKey(task.snapshot.tabId)]: task.snapshot });
}

function cancel(tabId: number, task: ActiveTask, errorCode: "PLACE_ID_MISMATCH" | "COLLECTION_CANCELLED" | "COLLECTION_SUPERSEDED") {
  if (active.get(tabId) !== task) return;
  active.delete(tabId);
  task.abort.abort();
  if (task.debug) logReviewTrace("worker.collect.cancel", {
    requestId: task.snapshot.requestId, expectedPlaceId: task.snapshot.placeId, errorCode,
  });
  void chrome.tabs.sendMessage(tabId, {
    type: "CANCEL_COLLECTION", requestId: task.snapshot.requestId, errorCode,
  }, { frameId: 0 }).catch(() => {});
  return chrome.storage.session.remove(taskKey(tabId));
}

async function run(task: ActiveTask) {
  const { tabId, requestId, placeId } = task.snapshot;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await publish(task);
    if (task.abort.signal.aborted) return;
    const request: CollectionRequest = { type: "COLLECT_FOR_ANALYSIS", requestId, placeId, debug: task.debug };
    if (task.debug) logReviewTrace("worker.collect.dispatch", { requestId, tabId, expectedPlaceId: placeId, frameId: 0 });
    const response = await Promise.race([
      chrome.tabs.sendMessage<CollectionRequest, CollectionResponse>(tabId, request, { frameId: 0 }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          if (task.debug) logReviewTrace("worker.collect.cancel", { requestId, expectedPlaceId: placeId, errorCode: "COLLECTION_TIMEOUT" });
          void chrome.tabs.sendMessage(tabId, { type: "CANCEL_COLLECTION", requestId, errorCode: "COLLECTION_TIMEOUT" }, { frameId: 0 }).catch(() => {});
          reject(new Error("評論擷取逾時，請再試一次。"));
        }, COLLECTION_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (active.get(tabId) !== task) return;
    if (task.debug) logReviewTrace("worker.collect.reply", {
      requestId, expectedPlaceId: placeId, ok: response?.ok,
      errorCode: response?.ok === false ? response.errorCode : undefined,
    });
    if (!response?.ok) throw new Error(response?.error || "無法連接 Google Maps，請重新整理地標頁。");
    if (response.data.place_id !== placeId) throw new Error("地標已變更，請重新分析。");
    if (!response.data.reviews.some((review) => review.text.trim())) {
      throw new Error("目前沒有可分析的文字評論。");
    }

    await publish(task, { phase: "analyzing", newest: response.newest, deadlineAt: Date.now() + ANALYSIS_DEADLINE_MS });
    const tab = await chrome.tabs.get(tabId);
    if (active.get(tabId) !== task) return;
    if (!tab.url || getMapsPlaceId(tab.url) !== placeId) {
      await cancel(tabId, task, "PLACE_ID_MISMATCH");
      return;
    }
    const result = await analyzeReviews(response.data, task.abort.signal);
    const finalTab = await chrome.tabs.get(tabId);
    if (!finalTab.url || getMapsPlaceId(finalTab.url) !== placeId) {
      await cancel(tabId, task, "PLACE_ID_MISMATCH");
      return;
    }
    await publish(task, { phase: "done", result, reviews: response.data.reviews });
  } catch (error) {
    await publish(task, {
      phase: "failed",
      error: error instanceof Error ? error.message : "分析失敗，請再試一次。",
    });
  } finally {
    clearTimeout(timer);
    if (active.get(tabId) === task) active.delete(tabId);
  }
}

async function getSnapshot(tabId: number, placeId: string): Promise<AnalysisTask | undefined> {
  const key = taskKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key] as AnalysisTask | undefined;
  const live = active.get(tabId);
  if (live) return live.snapshot.placeId === placeId ? live.snapshot : undefined;
  if (!stored || stored.placeId !== placeId) return;
  if (inProgress(stored)) {
    return { ...stored, phase: "failed", error: "分析已中斷。請手動重新啟動分析。" };
  }
  return stored;
}

function begin(tabId: number, placeId: string, requestId: string, debug: boolean): StartAnalysisResponse {
  const previous = active.get(tabId);
  if (previous?.snapshot.placeId === placeId) return { ok: true };
  if (previous) void cancel(tabId, previous, "COLLECTION_SUPERSEDED");
  const task: ActiveTask = {
    snapshot: {
      requestId, placeId, tabId, phase: "opening_reviews",
      deadlineAt: Date.now() + COLLECTION_TIMEOUT_MS,
    },
    abort: new AbortController(),
    debug,
  };
  active.set(tabId, task);
  void run(task).catch(console.error);
  return { ok: true };
}

function invalidatePlace(tabId: number, nextPlace: string | null) {
  const task = active.get(tabId);
  if (task) {
    if (nextPlace !== task.snapshot.placeId) void cancel(tabId, task, "PLACE_ID_MISMATCH")?.catch(console.error);
    return;
  }
  const key = taskKey(tabId);
  void chrome.storage.session.get(key).then((items) => {
    if (!active.has(tabId) && items[key] && items[key].placeId !== nextPlace) {
      return chrome.storage.session.remove(key);
    }
  }).catch(console.error);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (sender.id !== chrome.runtime.id || typeof message !== "object" || message === null) return;
  const request = message as { type?: string; placeId?: string; requestId?: string; tabId?: number; debug?: boolean };

  if (request.type === "GET_ANALYSIS_STATE" || request.type === "START_FROM_PANEL") {
    if (sender.tab || sender.url?.split(/[?#]/u, 1)[0] !== chrome.runtime.getURL("index.html") ||
        typeof request.tabId !== "number") return;
    const panelTabId = request.tabId;
    void chrome.tabs.get(panelTabId).then(async (tab) => {
      const currentPlace = tab.url ? getMapsPlaceId(tab.url) : null;
      if (request.type === "GET_ANALYSIS_STATE") {
        return currentPlace ? getSnapshot(panelTabId, currentPlace) : undefined;
      }
      const requestId = crypto.randomUUID();
      const debug = request.debug === true;
      const accepted = !!currentPlace && currentPlace === request.placeId;
      if (debug) logReviewTrace("worker.start", {
        requestId, tabId: panelTabId, expectedPlaceId: request.placeId, currentPlaceId: currentPlace, accepted,
      });
      return accepted ? begin(panelTabId, currentPlace, requestId, debug)
        : { ok: false, errorCode: "PLACE_ID_MISMATCH" } satisfies StartAnalysisResponse;
    }).then(reply, () => reply(undefined));
    return true;
  }

  const tabId = sender.tab?.id;
  if (tabId !== undefined && sender.frameId === 0) {
    const placeId = sender.url ? getMapsPlaceId(sender.url) : null;
    if (request.type === "MAPS_PLACE_CHANGED") {
      invalidatePlace(tabId, placeId);
      return;
    }
    const task = active.get(tabId);
    if (!task) return;
    if (request.type === "COLLECTION_STARTED" && placeId === task.snapshot.placeId &&
        request.requestId === task.snapshot.requestId && task.snapshot.phase === "opening_reviews") {
      void publish(task, { phase: "collecting" })?.catch(console.error);
    }
    return;
  }

});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  // Loading alone carries no place identity and can accompany a same-place redraw.
  if (change.url) invalidatePlace(tabId, getMapsPlaceId(change.url));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const task = active.get(tabId);
  if (task) void cancel(tabId, task, "COLLECTION_CANCELLED")?.catch(console.error);
  else void chrome.storage.session.remove(taskKey(tabId)).catch(console.error);
});


import { useEffect, useRef, useState } from "react";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  PracticalVisitInformation,
  VisitInformationCategory,
} from "./types";
import { REVIEW_COLLECTION_LIMIT, taskKey, type AnalysisTask, type StartAnalysisRequest, type StartAnalysisResponse } from "./analysis-task";
import { getMapsPlaceId, mapsDebugEnabled } from "./maps-context";

const taskStatus: Record<AnalysisTask["phase"], string> = {
  opening_reviews: "正在開啟評論",
  collecting: "正在擷取評論",
  analyzing: "正在分析評論",
  done: "分析完成",
  failed: "分析失敗",
};

function formatReviewDate(
  reviewDate: string | null,
  relativeTime: string | null
): string | null {
  if (relativeTime) return relativeTime;

  if (reviewDate) {
    const date = new Date(reviewDate);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString("zh-TW");
    }
  }

  return null;
}

function formatAspect(aspect: string): string {
  const labels: Record<string, string> = {
    food: "餐點品質",
    service: "服務品質",
    price: "價格",
    environment: "用餐環境",
    portion: "餐點份量",
    waiting_time: "等候時間",
    overall: "整體評價",
  };

  return labels[aspect] ?? aspect;
}

const ASPECT_SCORE_BANDS = [
  { minimum: 4, color: "bg-lumora-sage", label: "良好", range: "4–5" },
  { minimum: 3, color: "bg-lumora-ochre", label: "普通", range: "3–<4" },
  { minimum: 1, color: "bg-lumora-error", label: "有待改善", range: "1–<3" },
] as const;

function AspectRatingBars({ scores }: { scores?: AnalyzeResponse["aspect_scores"] }) {
  const ratings = Object.entries(scores ?? {})
    .filter(([aspect, score]) =>
      aspect.trim() && Number.isFinite(score) && score >= 1 && score <= 5
    )
    .sort(([, first], [, second]) => second - first);

  return (
    <section className="border-t border-lumora-border pt-4">
      <details className="group">
        <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 rounded-sm">
          <h2 className="font-semibold">各面向評分</h2>
          <span aria-hidden="true" className="shrink-0 text-xs font-medium text-lumora-iris">
            <span className="group-open:hidden">展開查看 ▾</span>
            <span className="hidden group-open:inline">收合 ▴</span>
          </span>
        </summary>

        {ratings.length === 0 ? (
          <p className="mt-4 text-sm text-lumora-muted">目前沒有可用的面向評分。</p>
        ) : (
          <>
            <ul className="mt-4 space-y-3">
              {ratings.map(([aspect, score]) => {
                const band = ASPECT_SCORE_BANDS.find(({ minimum }) => score >= minimum)
                  ?? ASPECT_SCORE_BANDS[2];

                return (
                  <li key={aspect}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                      <span className="min-w-0 break-words">{formatAspect(aspect)}</span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {score} / 5<span className="text-xs text-lumora-muted"> · {band.label}</span>
                      </span>
                    </div>
                    <div aria-hidden="true" className="h-1 overflow-hidden bg-lumora-border">
                      <div className={`h-full ${band.color}`} style={{ width: `${(score / 5) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>

            <ul aria-label="評分圖例" className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-lumora-border/70 pt-3 text-xs text-lumora-muted">
              {ASPECT_SCORE_BANDS.map(({ color, label, range }) => (
                <li key={label} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${color}`} />
                  <span>{label} {range}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}

function EvidenceList({
  evidenceIds,
  reviews,
}: {
  evidenceIds: string[];
  reviews: AnalyzeRequest["reviews"];
}) {
  const evidenceReviews = (evidenceIds ?? [])
    .map((id) => reviews.find((review) => review.review_id === id))
    .filter((review) => review !== undefined);

  if (evidenceReviews.length === 0) {
    return (
      <p className="mt-2 text-xs text-lumora-muted">
        找不到對應的原始評論。
      </p>
    );
  }

  return (
    <details className="mt-2">
      <summary className="min-h-6 cursor-pointer rounded-sm text-sm font-medium tabular-nums text-lumora-iris underline-offset-4 hover:underline active:text-lumora-ink">
        查看原始評論（{evidenceReviews.length}）
      </summary>

      <div className="mt-3 space-y-3">
        {evidenceReviews.map((review) => {
          const dateLabel = formatReviewDate(
            review.review_date,
            review.relative_time
          );

          return (
            <div
              className="border-t border-lumora-border pt-3 first:border-0 first:pt-0"
              key={review.review_id}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-xs font-medium tabular-nums text-lumora-ochre">
                  {review.rating} / 5 分
                </span>

                {dateLabel && (
                  <span className="min-w-0 break-words text-xs text-lumora-muted">
                    {dateLabel}
                  </span>
                )}
              </div>

              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-lumora-ink">
                {review.text || "此評論沒有文字內容。"}
              </p>
            </div>
          );
        })}
      </div>
    </details>
  );
}


function LineIcon({ path }: { path: string }) {
  return (
    <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const progressStages = [
  { phase: "opening_reviews", label: "確認商家與評論區" },
  { phase: "collecting", label: "擷取評論" },
  { phase: "analyzing", label: "整理消費建議" },
] as const;

function AnalysisProgress({ task, starting }: { task?: AnalysisTask; starting: boolean }) {
  const phase = starting ? "opening_reviews" : task?.phase === "failed" ? task.failedPhase : task?.phase;
  const current = progressStages.findIndex((stage) => stage.phase === phase);
  if (current < 0) return null;

  const failed = task?.phase === "failed";
  const collection = phase === "collecting" && !failed ? task?.collectionProgress : undefined;
  return (
    <div className="mt-5 min-[600px]:mt-[27px]">
      {collection?.count !== undefined && (
        <>
          <div aria-hidden="true" className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="tabular-nums">
              <span className="text-[clamp(2.25rem,7vw,3.25rem)] font-semibold leading-none">{collection.count}</span>
              <span className="ml-1.5 text-base text-lumora-muted">/ {collection.limit}</span>
            </p>
            <span className="text-xs text-lumora-iris">擷取評論中</span>
          </div>
          <div
            role="progressbar"
            aria-label="評論擷取進度"
            aria-valuemin={0}
            aria-valuemax={collection.limit}
            aria-valuenow={collection.count}
            aria-valuetext={`${collection.count} / ${collection.limit} 則`}
            className="h-[3px] overflow-hidden bg-lumora-border"
          >
            <div className="h-full bg-lumora-iris motion-safe:transition-[width]" style={{ width: `${(collection.count / collection.limit) * 100}%` }} />
          </div>
        </>
      )}
      {phase === "analyzing" && !failed && (
        <div role="progressbar" aria-label="正在分析評論，完成時間未定" className="h-[3px] overflow-hidden bg-lumora-border">
          <div className="lumora-indeterminate h-full w-1/3 bg-lumora-iris" />
        </div>
      )}
      <ol aria-label="分析階段" className="mt-2 text-sm leading-5">
        {progressStages.map((stage, index) => (
          <li
            key={stage.phase}
            aria-current={index === current && !failed ? "step" : undefined}
            className={`flex min-h-9 items-center gap-2 min-[600px]:min-h-[42px] ${index > current ? "text-lumora-muted" : index === current && failed ? "text-lumora-error" : ""}`}
          >
            {index < current ? (
              <><span className="text-lumora-sage"><LineIcon path="M4 8l3 3 5-6" /></span><span className="sr-only">已完成：</span></>
            ) : (
              <span aria-hidden="true" className={`grid h-4 w-4 shrink-0 place-items-center ${index === current ? failed ? "text-lumora-error" : "text-lumora-iris" : "text-lumora-muted/60"}`}>
                <span className={`h-3 w-3 rounded-full ${index === current ? "border border-current" : "bg-current"}`} />
              </span>
            )}
            {stage.label}{index === current && failed && "（未完成）"}
          </li>
        ))}
      </ol>
    </div>
  );
}

function RecommendedDishes({ dishes }: { dishes?: AnalyzeResponse["recommended_dishes"] }) {
  return (
    <section className="lumora-result-section">
      <h2 className="text-lg font-semibold leading-7">值得一試</h2>
      {!dishes?.length ? (
        <p className="mt-2 text-sm leading-6 text-lumora-muted">目前評論中沒有足夠明確的餐點推薦資訊。</p>
      ) : (
        <ol className="mt-3 list-[decimal-leading-zero] space-y-3 pl-8 marker:font-[Georgia] marker:text-xl marker:text-lumora-iris marker:tabular-nums">
          {dishes.map((dish, index) => (
            <li className="pl-1 text-sm" key={dish.name + "-" + index}>
              <h3 className="break-words font-medium leading-6">{dish.name}</h3>
              <p className="mt-0.5 break-words leading-6 text-lumora-muted">{dish.summary}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function DecisionSummary({
  decisionPros,
  decisionCons,
}: {
  decisionPros: string;
  decisionCons: string;
}) {
  return (
    <section className="lumora-result-section">
      <h2 className="text-lg font-semibold leading-7">消費決策摘要</h2>

      <div className="lumora-summary-note mt-3 border-lumora-sage">
        <h3 className="text-xs font-medium text-lumora-sage">值得推薦</h3>
        <p className="mt-1 break-words text-sm leading-6 text-lumora-ink">
          {decisionPros || "目前評論資訊不足。"}
        </p>
      </div>

      <div className="lumora-summary-note mt-3 border-lumora-ochre">
        <h3 className="text-xs font-medium text-lumora-ochre">消費前須注意</h3>
        <p className="mt-1 break-words text-sm leading-6 text-lumora-ink">
          {decisionCons || "目前評論資訊不足。"}
        </p>
      </div>
    </section>
  );
}


const visitCategories: Record<VisitInformationCategory, string> = {
  reservation: "訂位",
  budget: "預算",
  wait_time: "候位",
  parking: "停車",
  dining_time_limit: "用餐限時",
  payment: "付款",
  other: "其他",
};

function VisitInformation({ items }: { items: PracticalVisitInformation[] }) {
  if (!items?.length) return null;

  return (
    <section className="lumora-result-section">
      <h2 className="text-lg font-semibold leading-7">到訪前須知</h2>
      <dl className="mt-2 text-sm leading-6">
        {Object.entries(visitCategories).map(([category, label]) =>
          items.filter((item) => item.category === category).map(({ summary }, index) => (
            <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-3 py-1.5" key={category + "-" + index}>
              <dt className="text-lumora-muted">{label}</dt>
              <dd className="break-words">{summary}</dd>
            </div>
          ))
        )}
      </dl>
    </section>
  );
}

function AspectAnalysisList({
  items,
  reviews,
  type,
}: {
  items: AnalyzeResponse["pros"];
  reviews: AnalyzeRequest["reviews"];
  type: "pros" | "cons";
}) {
  const isPros = type === "pros";

  const sortedItems = [...(items ?? [])].sort(
    (a, b) =>
      (b.evidence_review_ids?.length ?? 0) - (a.evidence_review_ids?.length ?? 0)
  );

  return (
    <section>
      <h3 className={isPros ? "text-sm font-semibold text-lumora-sage" : "text-sm font-semibold text-lumora-ochre"}>
        {isPros ? "優點" : "缺點"}
      </h3>

      {sortedItems.length === 0 ? (
        <p className="mt-3 text-sm text-lumora-muted">
          {isPros ? "尚無優點分析結果。" : "尚無缺點分析結果。"}
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {sortedItems.map((item, index) => (
            <div
              className="border-b border-lumora-border/70 pb-4 last:border-0 last:pb-0"
              key={`${item.aspect}-${index}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 break-words text-sm font-semibold text-lumora-ink">
                  {formatAspect(item.aspect)}
                </p>
                <span
                  className="shrink-0 text-xs tabular-nums text-lumora-muted"
                >
                  {item.evidence_review_ids?.length ?? 0} 則佐證
                </span>
              </div>

              <p className="mt-1 break-words text-sm leading-6 text-lumora-muted">
                {item.summary}
              </p>

              <EvidenceList
                evidenceIds={item.evidence_review_ids}
                reviews={reviews}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type PanelFailure = { message: string; retry: "analysis" | "context" | null };
type MerchantContext = { tabId: number; placeId: string };
type PanelState =
  | { kind: "checking" | "unsupported" | "unselected" }
  | { kind: "unavailable"; failure: PanelFailure }
  | { kind: "merchant"; task?: AnalysisTask; starting?: boolean; failure?: PanelFailure };

function isMapsPage(href?: string): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    return url.protocol === "https:" &&
      ["www.google.com", "maps.google.com"].includes(url.host) &&
      (url.pathname === "/maps" || url.pathname.startsWith("/maps/") || url.host === "maps.google.com");
  } catch {
    return false;
  }
}

function describeTaskFailure(task: AnalysisTask): PanelFailure {
  if (task.errorCode === "NO_REVIEWS" || task.error === "目前沒有可分析的文字評論。") {
    return { message: "這間商家目前沒有可分析的文字評論。請選擇其他商家。", retry: null };
  }
  if (task.errorCode === "PLACE_ID_MISMATCH" || task.error?.startsWith("地標已變更")) {
    return { message: "分析時商家已變更。請先確認 Google Maps 上選取的商家。", retry: "context" };
  }
  if (
    task.errorCode === "REVIEW_ANCHOR_UNAVAILABLE" ||
    task.errorCode === "REVIEW_PLACE_UNVERIFIED" ||
    task.errorCode === "PLACE_BINDING_MISMATCH" ||
    task.errorCode === "PLACE_TITLE_MISMATCH" ||
    task.errorCode === "FOREIGN_REVIEW_CARD" ||
    task.error?.startsWith("無法連接 Google Maps")
  ) {
    return { message: "無法確認這間商家的評論。請重新整理 Google Maps 商家頁面後再試。", retry: "analysis" };
  }
  if (task.errorCode === "REVIEW_DOM_TIMEOUT" || task.error?.includes("逾時") || task.error === "Analysis request timed out.") {
    return { message: "這次分析等待逾時。請重新分析。", retry: "analysis" };
  }
  if (task.error?.startsWith("分析已中斷")) {
    return { message: "這次分析已中斷。請重新分析。", retry: "analysis" };
  }
  if (task.error?.startsWith("Cannot connect to the backend")) {
    return { message: "目前無法連線到分析服務。請稍後重新分析。", retry: "analysis" };
  }
  return { message: "這次無法完成分析。請稍後重新分析。", retry: "analysis" };
}

export default function App() {
  const [panel, setPanel] = useState<PanelState>({ kind: "checking" });
  const actions = useRef<{ analyze: () => Promise<void>; check: () => void }>();
  const task = panel.kind === "merchant" ? panel.task : undefined;
  const failure = panel.kind === "unavailable" ? panel.failure
    : panel.kind === "merchant" ? panel.failure ?? (task?.phase === "failed" ? describeTaskFailure(task) : undefined)
    : undefined;
  const starting = panel.kind === "merchant" && panel.starting === true;
  const isLoading = starting || !!task && task.phase !== "done" && task.phase !== "failed";
  const result = task?.phase === "done" && !starting && !failure ? task.result : undefined;
  const reviews = task?.reviews ?? [];
  const status = panel.kind === "checking" ? "正在確認商家"
    : panel.kind === "unsupported" ? "請在 Google Maps 開啟商家頁面，即可分析評論。"
    : panel.kind === "unselected" ? "尚未選擇商家。請在 Google Maps 選取一間商家。"
    : failure ? ""
    : starting ? "正在啟動分析"
    : task ? taskStatus[task.phase]
    : "已選取商家，可以開始分析。";

  useEffect(() => {
    let live = true;
    let revision = 0;
    let navigation = 0;
    let tabId: number | undefined;
    let merchant: MerchantContext | undefined;
    let pendingStart: MerchantContext | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    async function refresh() {
      const requested = ++revision;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!live || requested !== revision) return;
        clearTimeout(deadlineTimer);
        tabId = tab?.id;
        const placeId = tab?.url && getMapsPlaceId(tab.url);
        if (tabId === undefined || !placeId) {
          merchant = undefined;
          pendingStart = undefined;
          setPanel({ kind: isMapsPage(tab?.url) ? "unselected" : "unsupported" });
          return;
        }
        if (merchant?.tabId !== tabId || merchant.placeId !== placeId) {
          merchant = { tabId, placeId };
          pendingStart = undefined;
          setPanel({ kind: "checking" });
        }
        const target = merchant;
        const latest = await chrome.runtime.sendMessage<{ type: "GET_ANALYSIS_STATE"; tabId: number }, AnalysisTask | undefined>({
          type: "GET_ANALYSIS_STATE", tabId: target.tabId,
        });
        if (!live || requested !== revision || merchant !== target) return;
        const matching = latest?.tabId === target.tabId && latest.placeId === target.placeId ? latest : undefined;
        setPanel({ kind: "merchant", task: matching, starting: pendingStart === target });
        if (matching && matching.phase !== "done" && matching.phase !== "failed") {
          const delay = matching.deadlineAt + 2000 - Date.now();
          if (delay > 0) deadlineTimer = setTimeout(() => void refresh(), delay);
        }
      } catch (error) {
        if (!live || requested !== revision || pendingStart) return;
        merchant = undefined;
        if (mapsDebugEnabled()) console.debug("Lumora: unable to read analysis state", error);
        setPanel({ kind: "unavailable", failure: { message: "目前無法確認商家狀態。請再確認一次。", retry: "context" } });
      }
    }

    function check() {
      navigation++;
      merchant = undefined;
      pendingStart = undefined;
      clearTimeout(deadlineTimer);
      setPanel({ kind: "checking" });
      void refresh();
    }

    async function analyze() {
      const target = merchant;
      if (!live || !target || pendingStart) return;
      const startedAt = navigation;
      const isCurrent = () => live && navigation === startedAt && merchant === target;
      pendingStart = target;
      setPanel({ kind: "merchant", starting: true });
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!isCurrent()) return;
        if (tab?.id !== target.tabId || !tab.url || getMapsPlaceId(tab.url) !== target.placeId) {
          check();
          return;
        }
        const response = await chrome.runtime.sendMessage<StartAnalysisRequest, StartAnalysisResponse | undefined>({
          type: "START_FROM_PANEL", ...target, debug: mapsDebugEnabled(),
        });
        if (!isCurrent()) return;
        if (response?.ok === false) {
          check();
          return;
        }
        if (!response) throw new Error("START_FROM_PANEL returned no response");
        pendingStart = undefined;
        await refresh();
      } catch (error) {
        if (!isCurrent()) return;
        pendingStart = undefined;
        revision++;
        if (mapsDebugEnabled()) console.debug("Lumora: unable to start analysis", error);
        setPanel({ kind: "merchant", failure: { message: "目前無法啟動分析。請重新分析。", retry: "analysis" } });
      }
    }

    const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (updatedId, change) => {
      if (updatedId !== tabId || (!change.url && change.status !== "loading")) return;
      if (change.url && merchant && getMapsPlaceId(change.url) === merchant.placeId) return;
      check();
    };
    const onStorage: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === "session" && tabId !== undefined && taskKey(tabId) in changes) void refresh();
    };
    actions.current = { analyze, check };
    chrome.tabs.onActivated.addListener(check);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.storage.onChanged.addListener(onStorage);
    void refresh();
    return () => {
      live = false;
      actions.current = undefined;
      clearTimeout(deadlineTimer);
      chrome.tabs.onActivated.removeListener(check);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.storage.onChanged.removeListener(onStorage);
    };
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 pb-8 min-[380px]:px-5">
      <header className="flex h-16 items-center justify-between gap-3 border-b border-lumora-border min-[600px]:h-20">
        <h1 className="relative -top-0.5 flex min-w-0 items-center gap-2">
          <img src="/icons/lumora.svg" alt="" width={30} height={30} className="h-[30px] w-[30px] shrink-0" />
          <img src="/icons/lumora-wordmark.svg" alt="Lumora" width={100} height={23} className="block h-auto max-w-full" />
        </h1>
        <span className="shrink-0 text-[0.625rem] text-lumora-muted">消費指南</span>
      </header>

      {panel.kind === "unsupported" && (
        <section className="lumora-welcome">
          <p className="text-xs text-lumora-iris">你的日常消費指南</p>
          <h2 className="lumora-welcome-title">
            好的選擇，<br />從了解開始。
          </h2>
          <p className="lumora-welcome-copy text-sm leading-6 text-lumora-muted">
            在 Google Maps 選擇一間商家，Lumora 為你整理評論中值得留意的資訊。
          </p>
          <a
            href="https://www.google.com/maps/"
            target="_blank"
            rel="noopener noreferrer"
            className="lumora-primary mt-4 flex items-center justify-center gap-2"
          >
            開啟 Google Maps
            <LineIcon path="M4 12l8-8M6 4h6v6" />
          </a>
          <p className="lumora-welcome-features text-xs leading-5 text-lumora-muted">
            評論摘要 · 推薦餐點 · 到訪資訊
          </p>
        </section>
      )}

      {panel.kind === "unselected" && (
        <section className="mt-5">
          <h2 className="text-xl font-semibold leading-7">今天想探索哪間店？</h2>
          <p className="mt-2 text-sm leading-6 text-lumora-muted">
            在 Google Maps 搜尋感興趣的商家，並開啟它的商家頁面。選好後，就能在這裡開始分析。
          </p>
        </section>
      )}

      {!result && panel.kind !== "unsupported" && panel.kind !== "unselected" && (
        <section className="mt-6 min-[600px]:mt-9">
          <h2 className="break-words text-xl font-medium leading-7 min-[600px]:text-[1.375rem]">
            {isLoading && task?.verifiedTitle ? task.verifiedTitle : failure ? "這次分析還沒完成" : panel.kind === "merchant" && !task && !starting
              ? "看懂評論，再做決定。" : "分析商家評論"}
          </h2>

          {panel.kind === "merchant" && !task && !starting && !failure && (
            <p className="mt-2 text-sm leading-6 text-lumora-muted">
              Lumora 會擷取最多 {REVIEW_COLLECTION_LIMIT} 則評論，由 AI 整理評論重點、推薦餐點與到訪前可參考的資訊。
            </p>
          )}

          {(task || starting) && !(isLoading && task?.verifiedTitle) && (
            <p className="mt-2 break-words text-sm font-semibold leading-6">
              分析對象：{task?.verifiedTitle ?? (isLoading ? "正在確認商家名稱" : "商家名稱未記錄")}
            </p>
          )}

          <p role="status" aria-atomic="true" className={status ? "mt-2 break-words text-sm leading-6 text-lumora-muted" : "sr-only"}>
            <span>
              {task?.phase === "collecting" && !starting && !failure ? "正在整理商家評論" : status}
              {status && !starting && task?.newest === false && "，採用目前評論順序。"}
            </span>
          </p>

          <AnalysisProgress task={task} starting={starting} />

          {failure && (
            <p role="alert" className="mt-3 break-words border-t border-lumora-border pt-3 text-sm leading-6 text-lumora-error">
              {failure.message}
            </p>
          )}

          {!isLoading && ((panel.kind === "merchant" && !failure) || failure?.retry) && (
            <button
              className="lumora-primary mt-4 w-full"
              onClick={() => failure?.retry === "context" ? actions.current?.check() : void actions.current?.analyze()}
              type="button"
            >
              {failure?.retry === "context" ? "確認商家" : failure || result ? "重新分析" : "開始消費分析"}
            </button>
          )}
        </section>
      )}

      {result && (
        <div className="mt-5 space-y-6 min-[600px]:mt-6">
          <section aria-label="分析對象">
            <p className="mb-2.5 text-xs text-lumora-iris">消費指南 / 評論洞察</p>
            <h2 className="break-words text-2xl font-semibold leading-8 min-[600px]:text-[1.5625rem]">{task?.verifiedTitle ?? "商家名稱未記錄"}</h2>
            <div className="-my-1 flex flex-wrap items-center justify-between gap-x-3">
              <p role="status" className="text-xs leading-5 tabular-nums text-lumora-muted">
                <span className={Number.isFinite(result.analyzed_count) ? "sr-only" : undefined}>分析完成。 </span>
                {Number.isFinite(result.analyzed_count) && <span>根據 {result.analyzed_count} 則評論整理</span>}
              </p>
              <button
                className="min-h-8 shrink-0 rounded-sm text-xs text-lumora-iris underline-offset-4 hover:underline active:text-lumora-ink"
                onClick={() => void actions.current?.analyze()}
                type="button"
              >
                重新分析
              </button>
            </div>
            {result.analysis_mode === "mock" && (
              <p className="mt-1 text-xs font-medium leading-5 text-lumora-ochre">
                <span lang="en">MOCK MODE</span> · 模擬結果
              </p>
            )}
          </section>

          <DecisionSummary decisionPros={result.decision_pros} decisionCons={result.decision_cons} />
          <VisitInformation items={result.practical_visit_information} />
          <RecommendedDishes dishes={result.recommended_dishes} />

          <section className="border-t border-lumora-border pt-4">
            <h2 className="font-semibold">深入評論分析</h2>
            <div className="mt-3 space-y-4">
              <AspectAnalysisList items={result.pros} reviews={reviews} type="pros" />
              <AspectAnalysisList items={result.cons} reviews={reviews} type="cons" />
            </div>
          </section>

          <AspectRatingBars scores={result.aspect_scores} />

          <footer className="border-t border-lumora-border pt-4">
            <h2 className="text-sm font-semibold">分析資訊</h2>
            <dl className="mt-2 space-y-1 text-xs leading-5 text-lumora-muted">
              <div className="flex gap-2">
                <dt className="shrink-0">分析模式</dt>
                <dd>{result.analysis_mode === "mock" ? "MOCK MODE（模擬分析）" : result.analysis_mode === "gemini" ? "GEMINI MODE" : "未記錄"}</dd>
              </div>
              {result.analysis_mode === "gemini" && (
                <div className="flex gap-2">
                  <dt className="shrink-0">Gemini 模型</dt>
                  <dd className="min-w-0 break-words">{result.model_id || "本次未記錄模型名稱"}</dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="shrink-0">資料範圍</dt>
                <dd>本次納入分析的文字評論。{task?.newest === false && "採用目前評論順序。"}</dd>
              </div>
              {!!result.practical_visit_information?.length && (
                <div className="flex gap-2">
                  <dt className="shrink-0">到訪資訊</dt>
                  <dd>資訊整理自評論，實際價格與店家政策可能有所變動。</dd>
                </div>
              )}
            </dl>
          </footer>
        </div>
      )}
    </main>
  );
}

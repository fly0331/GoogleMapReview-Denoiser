
import { useEffect, useRef, useState } from "react";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  PracticalVisitInformation,
  VisitInformationCategory,
} from "./types";
import { taskKey, type AnalysisTask, type StartAnalysisRequest, type StartAnalysisResponse } from "./analysis-task";
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
  { minimum: 4, color: "bg-emerald-600", label: "良好", range: "4–5" },
  { minimum: 3, color: "bg-amber-500", label: "普通", range: "3–<4" },
  { minimum: 1, color: "bg-red-500", label: "有待改善", range: "1–<3" },
] as const;

function AspectRatingBars({ scores }: { scores?: AnalyzeResponse["aspect_scores"] }) {
  const ratings = Object.entries(scores ?? {})
    .filter(([aspect, score]) =>
      aspect.trim() && Number.isFinite(score) && score >= 1 && score <= 5
    )
    .sort(([, first], [, second]) => second - first);

  return (
    <section className="rounded-xl border border-lumora-border bg-white p-4">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-sm">
          <h2 className="font-semibold">各面向評分</h2>
          <span aria-hidden="true" className="shrink-0 text-xs font-medium text-lumora-action">
            <span className="group-open:hidden">展開查看 ▾</span>
            <span className="hidden group-open:inline">收合 ▴</span>
          </span>
        </summary>

        {ratings.length === 0 ? (
          <p className="mt-4 text-sm text-lumora-secondary">目前沒有可用的面向評分。</p>
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
                        {score} / 5<span className="sr-only">（{band.label}）</span>
                      </span>
                    </div>
                    <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-lumora-border">
                      <div className={`h-full rounded-full ${band.color}`} style={{ width: `${(score / 5) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>

            <ul aria-label="評分圖例" className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-lumora-border/70 pt-3 text-xs text-lumora-secondary">
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
  const evidenceReviews = evidenceIds
    .map((id) => reviews.find((review) => review.review_id === id))
    .filter((review) => review !== undefined);

  if (evidenceReviews.length === 0) {
    return (
      <p className="mt-2 text-xs text-lumora-secondary">
        找不到對應的原始評論。
      </p>
    );
  }

  return (
    <details className="mt-3 rounded-lg bg-lumora-cloud p-3">
      <summary className="cursor-pointer rounded-sm text-xs font-medium text-lumora-action hover:underline">
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
                <span className="text-xs font-medium text-amber-600">
                  {"★".repeat(review.rating)}
                  {"☆".repeat(5 - review.rating)}
                </span>

                {dateLabel && (
                  <span className="text-xs text-lumora-secondary">
                    {dateLabel}
                  </span>
                )}
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-lumora-midnight">
                {review.text || "此評論沒有文字內容。"}
              </p>
            </div>
          );
        })}
      </div>
    </details>
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
    <section className="rounded-xl border border-lumora-lavender/70 bg-white p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-lumora-violet" />
        <h2 className="font-semibold">消費決策摘要</h2>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-emerald-700">值得推薦</h3>
        <p className="mt-1 text-sm leading-5 text-lumora-secondary">
          {decisionPros || "目前評論資訊不足。"}
        </p>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-red-700">消費前須注意</h3>
        <p className="mt-1 text-sm leading-5 text-lumora-secondary">
          {decisionCons || "目前評論資訊不足。"}
        </p>
      </div>
    </section>
  );
}


const visitCategories: Record<VisitInformationCategory, { label: string; icon: string }> = {
  budget: { label: "消費預算", icon: "💰" },
  wait_time: { label: "候位時間", icon: "⏳" },
  reservation: { label: "訂位建議", icon: "📅" },
  parking: { label: "停車資訊", icon: "🅿️" },
  dining_time_limit: { label: "用餐時間限制", icon: "⏱️" },
  payment: { label: "付款方式", icon: "💳" },
  other: { label: "其他實用資訊", icon: "ℹ️" },
};

function VisitInformation({ items }: { items: PracticalVisitInformation[] }) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-lumora-border bg-white p-4">
      <h2 className="font-semibold">消費實用資訊</h2>
      <ul className="mt-3 divide-y divide-lumora-border/70">
        {Object.entries(visitCategories).map(([category, { label, icon }]) =>
          items.filter((item) => item.category === category).map(({ summary }, index) => (
            <li className="flex items-start gap-3 py-3 first:pt-0" key={category + "-" + index}>
              <span aria-hidden="true" className="shrink-0">{icon}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{label}</h3>
                <p className="mt-1 break-words text-sm leading-6 text-lumora-secondary">{summary}</p>
              </div>
            </li>
          ))
        )}
      </ul>
      <p className="mt-2 text-xs leading-5 text-lumora-secondary">
        資訊整理自評論，實際價格與店家政策可能有所變動。
      </p>
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

  const sortedItems = [...items].sort(
    (a, b) =>
      b.evidence_review_ids.length - a.evidence_review_ids.length
  );

  const badgeColor = isPros
    ? "bg-emerald-50 text-emerald-700"
    : "bg-red-50 text-red-700";

  return (
    <section className="rounded-xl border border-lumora-border bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {isPros ? "優點 Pros" : "缺點 Cons"}
        </h2>
      </div>

      {sortedItems.length === 0 ? (
        <p className="mt-3 text-sm text-lumora-secondary">
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
                <p className="text-sm font-semibold text-lumora-midnight">
                  {formatAspect(item.aspect)}
                </p>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${badgeColor}`}
                >
                  {item.evidence_review_ids.length} 則評論
                </span>
              </div>

              <p className="mt-2 text-sm leading-6 text-lumora-secondary">
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

function SectionHeading({
  label,
  title,
}: {
  label: string;
  title: string;
}) {
  return (
    <div className="border-t border-lumora-border pt-3">
      <h2 className="text-xs font-semibold tracking-wider text-lumora-secondary">
        {label}
      </h2>
      <p className="mt-1 text-sm font-semibold text-lumora-midnight">
        {title}
      </p>
    </div>
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
    <main className="mx-auto min-h-screen max-w-xl px-4 pb-6 pt-5">
      <header className="space-y-2 border-b border-lumora-border pb-4">
        <div className="flex items-center gap-3">
          <img src="/icons/lumora.svg" alt="" width={48} height={48} className="h-12 w-12 shrink-0" />
          <div className="min-w-0">
            <h1 className="flex items-baseline gap-1 text-[1.625rem] font-bold leading-7 tracking-[-0.045em] text-lumora-midnight">
              Lumora
              <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-lumora-violet" />
            </h1>
            <p className="text-sm font-medium leading-5 text-lumora-midnight">AI 消費決策助手</p>
          </div>
        </div>
        <p lang="en" className="text-xs leading-4 text-lumora-secondary">A brighter way to choose.</p>
      </header>

      {result && (
        <>
          <div
            className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${
              result.analysis_mode === "mock"
                ? "border-amber-200 bg-amber-50"
                : "border-emerald-200 bg-emerald-50"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                result.analysis_mode === "mock"
                  ? "bg-amber-500"
                  : "bg-emerald-500"
              }`}
            />
            <span
              className={`text-xs font-semibold ${
                result.analysis_mode === "mock"
                  ? "text-amber-700"
                  : "text-emerald-700"
              }`}
            >
              {result.analysis_mode === "mock" ? "MOCK MODE" : "GEMINI MODE"}
            </span>
          </div>

          <p className="mt-2 break-words text-xs text-lumora-secondary">
            {result.analysis_mode === "mock"
              ? "目前使用模擬 LLM 分析結果。"
              : result.model_id
                ? "本次使用 " + result.model_id + " 進行 AI 評論分析。"
                : "本次分析的模型名稱未記錄。"}
          </p>
        </>
      )}

      <section className="mt-4 rounded-xl border border-lumora-border bg-white p-4">
        <h2 className="font-semibold">分析商家評論</h2>

        {(task || starting) && (
          <p className="mt-2 break-words text-sm font-semibold leading-6">
            分析對象：{task?.verifiedTitle ?? (isLoading ? "正在確認商家名稱" : "商家名稱未記錄")}
          </p>
        )}

        <p role="status" aria-atomic="true" className={status ? `mt-2 flex items-center gap-2 text-sm leading-6 ${
          isLoading ? "text-lumora-action" : result ? "text-emerald-700" : "text-lumora-secondary"
        }` : "sr-only"}>
          {isLoading && (
            <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full border-2 border-lumora-lavender border-t-lumora-action motion-safe:animate-spin" />
          )}
          <span>
            {status}
            {status && !starting && task?.newest === false && "，採用目前評論順序。"}
          </span>
        </p>

        {failure && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {failure.message}
          </p>
        )}

        {((panel.kind === "merchant" && !failure) || failure?.retry) && (
          <button
            className="mt-3 w-full rounded-lg bg-lumora-action px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-lumora-action/90 disabled:cursor-not-allowed disabled:bg-lumora-action/10 disabled:text-lumora-action"
            disabled={isLoading}
            onClick={() => failure?.retry === "context" ? actions.current?.check() : void actions.current?.analyze()}
            type="button"
          >
            {failure?.retry === "context" ? "確認商家" : failure || result ? "重新分析" : "AI 消費分析"}
          </button>
        )}
      </section>

      {result && (
        <div className="mt-4 space-y-3">
          {/* 第一層：消費決策 */}
          <SectionHeading
            label="CONSUMER INSIGHTS"
            title="先看結論"
          />

          <DecisionSummary
            decisionPros={result.decision_pros}
            decisionCons={result.decision_cons}
          />

          <VisitInformation items={result.practical_visit_information} />

          <section className="rounded-xl border border-lumora-border bg-white p-4">
            <h2 className="font-semibold">最推薦餐點</h2>

            {result.recommended_dishes.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-lumora-secondary">
                目前評論中沒有足夠明確的餐點推薦資訊。
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {result.recommended_dishes.map((dish, index) => (
                  <div
                    className="flex items-start gap-3 border-b border-lumora-border/70 pb-4 last:border-0 last:pb-0"
                    key={`${dish.name}-${index}`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-lumora-lavender/25 text-sm font-semibold tabular-nums text-lumora-action">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-semibold text-lumora-midnight">
                        {dish.name}
                      </h3>
                      <p className="mt-1 break-words text-sm leading-6 text-lumora-secondary">
                        {dish.summary}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 第二層：評論洞察 */}
          <SectionHeading
            label="REVIEW ANALYSIS"
            title="深入了解評論"
          />

          <AspectAnalysisList
            items={result.pros}
            reviews={reviews}
            type="pros"
          />

          <AspectAnalysisList
            items={result.cons}
            reviews={reviews}
            type="cons"
          />

          {/* 第三層：進階資訊 */}
          <SectionHeading
            label="ADVANCED INSIGHTS"
            title="更多分析資訊"
          />

          <AspectRatingBars scores={result.aspect_scores} />
        </div>
      )}
    </main>
  );
}

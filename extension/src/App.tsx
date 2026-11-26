
import { useEffect, useState } from "react";
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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
          <h2 className="font-semibold">各面向評分</h2>
          <span aria-hidden="true" className="shrink-0 text-xs text-blue-700">
            <span className="group-open:hidden">展開查看 ▾</span>
            <span className="hidden group-open:inline">收合 ▴</span>
          </span>
        </summary>

        {ratings.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">目前沒有可用的面向評分。</p>
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
                    <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${band.color}`} style={{ width: `${(score / 5) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>

            <ul aria-label="評分圖例" className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
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
      <p className="mt-2 text-xs text-slate-400">
        找不到對應的原始評論。
      </p>
    );
  }

  return (
    <details className="mt-3 rounded-lg bg-slate-50 p-3">
      <summary className="cursor-pointer text-xs font-medium text-blue-700">
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
              className="border-t border-slate-200 pt-3 first:border-0 first:pt-0"
              key={review.review_id}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-amber-600">
                  {"★".repeat(review.rating)}
                  {"☆".repeat(5 - review.rating)}
                </span>

                {dateLabel && (
                  <span className="text-xs text-slate-400">
                    {dateLabel}
                  </span>
                )}
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
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
    <section className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-lg">💡</span>
        <h2 className="font-semibold">消費決策摘要</h2>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-emerald-700">值得推薦</h3>
        <p className="mt-1 text-sm leading-5 text-slate-600">
          {decisionPros || "目前評論資訊不足。"}
        </p>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-red-700">消費前須注意</h3>
        <p className="mt-1 text-sm leading-5 text-slate-600">
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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">消費實用資訊</h2>
      <ul className="mt-3 divide-y divide-slate-100">
        {Object.entries(visitCategories).map(([category, { label, icon }]) =>
          items.filter((item) => item.category === category).map(({ summary }, index) => (
            <li className="flex items-start gap-3 py-3 first:pt-0" key={category + "-" + index}>
              <span aria-hidden="true" className="shrink-0">{icon}</span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{label}</h3>
                <p className="mt-1 break-words text-sm leading-6 text-slate-600">{summary}</p>
              </div>
            </li>
          ))
        )}
      </ul>
      <p className="mt-2 text-xs leading-5 text-slate-500">
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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">
          {isPros ? "優點 Pros" : "缺點 Cons"}
        </h2>
      </div>

      {sortedItems.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          {isPros ? "尚無優點分析結果。" : "尚無缺點分析結果。"}
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {sortedItems.map((item, index) => (
            <div
              className="border-b border-slate-100 pb-4 last:border-0 last:pb-0"
              key={`${item.aspect}-${index}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800">
                  {formatAspect(item.aspect)}
                </p>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${badgeColor}`}
                >
                  {item.evidence_review_ids.length} 則評論
                </span>
              </div>

              <p className="mt-2 text-sm leading-6 text-slate-600">
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
    <div className="border-t border-slate-200 pt-4">
      <h2 className="text-xs font-semibold tracking-wider text-slate-400">
        {label}
      </h2>
      <p className="mt-1 text-sm font-medium text-slate-700">
        {title}
      </p>
    </div>
  );
}

export default function App() {
  const [task, setTask] = useState<AnalysisTask>();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const result = task?.result;
  const reviews = task?.reviews ?? [];
  const isLoading = starting || (task && task.phase !== "done" && task.phase !== "failed");

  useEffect(() => {
    let live = true;
    let revision = 0;
    let currentTabId: number | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      const requested = ++revision;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!live || requested !== revision) return;
        currentTabId = tab?.id;
        const latest = currentTabId === undefined ? undefined
          : await chrome.runtime.sendMessage<{ type: string; tabId: number }, AnalysisTask | undefined>({
            type: "GET_ANALYSIS_STATE", tabId: currentTabId,
          });
        if (live && requested === revision) {
          clearTimeout(deadlineTimer);
          setTask(latest);
          // Reconcile a task once after its deadline if Chrome stopped the worker mid-request.
          if (latest && latest.phase !== "done" && latest.phase !== "failed") {
            const delay = latest.deadlineAt + 2000 - Date.now();
            if (delay > 0) deadlineTimer = setTimeout(() => void refresh(), delay);
          }
        }
      } catch {
        if (live && requested === revision) setTask(undefined);
      }
    }

    const onActivated = () => { setTask(undefined); setError(undefined); void refresh(); };
    const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (tabId, change) => {
      if (tabId === currentTabId && (change.url || change.status === "loading")) void refresh();
    };
    const onStorage: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === "session" && (currentTabId === undefined || taskKey(currentTabId) in changes)) void refresh();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.storage.onChanged.addListener(onStorage);
    void refresh();
    return () => {
      live = false;
      clearTimeout(deadlineTimer);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.storage.onChanged.removeListener(onStorage);
    };
  }, []);

  async function handleAnalyze() {
    setError(undefined);
    setStarting(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const placeId = tab?.url && getMapsPlaceId(tab.url);
      if (tab?.id === undefined || !placeId) {
        setError("請先開啟支援的 Google Maps 地標頁面。");
        return;
      }
      const response = await chrome.runtime.sendMessage<StartAnalysisRequest, StartAnalysisResponse | undefined>({
        type: "START_FROM_PANEL", tabId: tab.id, placeId, debug: mapsDebugEnabled(),
      });
      if (response?.ok === false) setError("地標已變更，請重新分析。");
      else if (!response) setError("無法啟動分析，請再試一次。");
    } catch {
      setError("無法啟動分析，請再試一次。");
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-900">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-sm font-medium text-blue-700">Google Maps</p>
        <h1 className="mt-1 text-xl font-semibold">AI 消費決策助手</h1>
        <p className="mt-1 text-xs text-slate-500">
          AI Consumer Decision Assistant
        </p>
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

          <p className="mt-2 text-xs text-slate-500">
            {result.analysis_mode === "mock"
              ? "目前使用模擬 LLM 分析結果。"
              : result.model_id
                ? "本次使用 " + result.model_id + " 進行 AI 評論分析。"
                : "本次分析的模型名稱未記錄。"}
          </p>
        </>
      )}

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-medium">分析商家評論</h2>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          請在 Google Maps 選取地標，再點擊下方按鈕。
        </p>

        <button
          className="mt-4 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={isLoading}
          onClick={handleAnalyze}
          type="button"
        >
          AI 消費分析
        </button>

        {task && (
          <p role="status" className="mt-3 text-sm text-blue-700">
            {taskStatus[task.phase]}
            {task.newest === false && task.phase !== "failed" && "，採用目前評論順序。"}
          </p>
        )}

        {(task?.error || error) && (
          <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {task?.error || error}
          </div>
        )}
      </section>

      {result && (
        <div className="mt-5 space-y-4">
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

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">最推薦餐點</h2>

            {result.recommended_dishes.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-slate-500">
                目前評論中沒有足夠明確的餐點推薦資訊。
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {result.recommended_dishes.map((dish, index) => (
                  <div
                    className="flex items-start gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0"
                    key={`${dish.name}-${index}`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-sm font-semibold text-amber-700">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-semibold text-slate-900">
                        {dish.name}
                      </h3>
                      <p className="mt-1 break-words text-sm leading-6 text-slate-600">
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

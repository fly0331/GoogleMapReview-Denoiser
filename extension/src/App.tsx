
import { useState } from "react";
import type { AnalyzeRequest, AnalyzeResponse } from "./types";
import { analyzeReviews } from "./api";

interface CollectionResult {
  place_id: string;
  scraped_at: string;
  reviews: AnalyzeRequest["reviews"];
}

interface CollectionMessage {
  success: boolean;
  data?: CollectionResult;
  error?: string;
}

type AnalysisStatus = "idle" | "collecting" | "analyzing" | "done";

function formatMetricLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMetricValue(value: number | null): string {
  if (value === null) return "N/A";

  if (Number.isInteger(value)) return value.toLocaleString();

  return value.toFixed(2);
}

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

export default function App() {
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [reviews, setReviews] = useState<AnalyzeRequest["reviews"]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [placeId, setPlaceId] = useState<string | null>(null);

  const isLoading = status === "collecting" || status === "analyzing";

  async function handleAnalyze() {
    setError(null);
    setResult(null);
    setReviewCount(0);
    setReviews([]);
    setPlaceId(null);
    

    try {
      setStatus("collecting");

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id || !tab.url?.includes("google.com/maps")) {
        throw new Error("請先開啟 Google Maps 商家頁面。");
      }

      const response = (await chrome.tabs.sendMessage(tab.id, {
        type: "COLLECT_REVIEWS",
      })) as CollectionMessage;

      if (!response.success || !response.data) {
        throw new Error(response.error || "無法擷取評論。");
      }

      const collection = response.data;

      if (collection.reviews.length === 0) {
        throw new Error("沒有找到可分析的評論。");
      }
      setReviews(collection.reviews);
      setReviewCount(collection.reviews.length);
      setPlaceId(collection.place_id);
      setStatus("analyzing");

      const request: AnalyzeRequest = {
        place_id: collection.place_id,
        scraped_at: collection.scraped_at,
        reviews: collection.reviews,
      };

      const analysis = await analyzeReviews(request);

      setResult(analysis);
      setStatus("done");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "分析過程發生未知錯誤。"
      );
      setStatus("idle");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 text-slate-900">
      <header className="border-b border-slate-200 pb-4">
        <p className="text-sm font-medium text-blue-700">Google Maps</p>
        <h1 className="mt-1 text-xl font-semibold">評論去噪器</h1>
        <p className="mt-1 text-xs text-slate-500">
          Review Cleaner & Sentiment Analysis
        </p>
      </header>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        <span className="text-xs font-semibold text-amber-700">
          MOCK MODE
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        目前使用模擬 LLM 分析結果，尚未連接正式 Gemini API。
      </p>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-medium">分析商家評論</h2>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          開啟 Google Maps 商家頁面，擷取最多 50 則評論並進行分析。
        </p>

        <button
          className="mt-4 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={isLoading}
          onClick={handleAnalyze}
          type="button"
        >
          {status === "collecting"
            ? "正在擷取評論..."
            : status === "analyzing"
              ? "正在分析評論..."
              : "分析目前商家"}
        </button>

        {isLoading && (
          <p className="mt-3 text-center text-xs text-blue-700">
            {status === "collecting"
              ? "正在讀取 Google Maps 評論，請稍候。"
              : "評論已擷取，正在進行分析。"}
          </p>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {placeId && (
          <p className="mt-3 break-all text-xs text-slate-400">
            Place ID: {placeId}
          </p>
        )}
      </section>

      {result && (
        <div className="mt-5 space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">分析摘要</h2>
              {result.cache_hit && (
                <span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700">
                  Cache Hit
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">擷取評論</p>
                <p className="mt-1 text-2xl font-semibold">
                  {reviewCount}
                </p>
              </div>

              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">分析評論</p>
                <p className="mt-1 text-2xl font-semibold">
                  {result.analyzed_count}
                </p>
              </div>
            </div>

            {Object.keys(result.metrics).length > 0 && (
              <div className="mt-4 space-y-2">
                <h3 className="text-sm font-medium">Cleaner Metrics</h3>
                {Object.entries(result.metrics).map(([key, value]) => (
                  <div
                    className="flex items-center justify-between border-b border-slate-100 py-2 text-sm"
                    key={key}
                  >
                    <span className="text-slate-600">
                      {formatMetricLabel(key)}
                    </span>
                    <span className="font-medium">
                      {formatMetricValue(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">負評趨勢</h2>
              {result.anomaly_alert && (
                <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700">
                  異常警示
                </span>
              )}
            </div>

            {!result.timeline.length ? (
              <p className="mt-3 text-sm text-slate-500">
                尚無足夠的時間序列資料。
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {result.timeline.map((item) => (
                  <div key={item.month}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium">{item.month}</span>
                      <span className="text-slate-500">
                        {item.negative_count}/{item.review_count} 負評
                        （{(item.negative_ratio * 100).toFixed(1)}%）
                      </span>
                    </div>

                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-red-500"
                        style={{
                          width: `${Math.max(
                            0,
                            Math.min(100, item.negative_ratio * 100)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.anomaly_alert && (
              <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                最近的負評比例出現異常，建議進一步檢視近期評論。
              </p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">可疑評論原因</h2>

            {Object.keys(result.suspicious_reasons_breakdown).length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                沒有偵測到可疑評論原因。
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {Object.entries(result.suspicious_reasons_breakdown).map(
                  ([reason, count]) => (
                    <div
                      className="flex justify-between text-sm"
                      key={reason}
                    >
                      <span className="text-slate-600">
                        {formatMetricLabel(reason)}
                      </span>
                      <span className="font-medium">{count}</span>
                    </div>
                  )
                )}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">店家優點 Pros</h2>

            {result.pros.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                尚無優點分析結果。
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {result.pros.map((item, index) => (
                  <div
                    className="border-b border-slate-100 pb-3 last:border-0"
                    key={`${item.aspect}-${index}`}
                  >
                    <p className="text-sm font-medium">{item.aspect}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.summary}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      情感：{item.sentiment}
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

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-semibold">店家缺點 Cons</h2>

            {result.cons.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                尚無缺點分析結果。
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {result.cons.map((item, index) => (
                  <div
                    className="border-b border-slate-100 pb-3 last:border-0"
                    key={`${item.aspect}-${index}`}
                  >
                    <p className="text-sm font-medium">{item.aspect}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {item.summary}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      情感：{item.sentiment}
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

          {Object.keys(result.aspect_scores).length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">面向評分</h2>

              <div className="mt-3 space-y-3">
                {Object.entries(result.aspect_scores).map(([aspect, score]) => (
                  <div key={aspect}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{aspect}</span>
                      <span className="font-medium">{score.toFixed(2)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-blue-600"
                        style={{
                          width: `${Math.max(0, Math.min(100, score * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

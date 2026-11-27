import type { AnalyzeRequest, AnalyzeResponse, CollectedReview, CollectedReviews } from "./types";

export const ANALYSIS_TASK_PREFIX = "analysis-task:";
export const REVIEW_COLLECTION_LIMIT = 50;
export const taskKey = (tabId: number) => ANALYSIS_TASK_PREFIX + tabId;

export function toAnalyzeRequest({ place_id, scraped_at, reviews }: CollectedReviews): AnalyzeRequest {
  return {
    place_id,
    scraped_at,
    reviews: reviews.map(({ review_id, rating, text }) => ({ review_id, rating, text })),
  };
}

export interface StartAnalysisRequest {
  type: "START_FROM_PANEL";
  tabId: number;
  placeId: string;
  debug: boolean;
}

export type StartAnalysisResponse = { ok: true } | { ok: false; errorCode: "PLACE_ID_MISMATCH" };

export type AnalysisPhase = "opening_reviews" | "collecting" | "analyzing" | "done" | "failed";
export type ActiveAnalysisPhase = Exclude<AnalysisPhase, "done" | "failed">;

export interface AnalysisTask {
  requestId: string;
  tabId: number;
  placeId: string;
  phase: AnalysisPhase;
  deadlineAt: number;
  verifiedTitle?: string;
  collectionProgress?: { count: number; limit: number };
  failedPhase?: ActiveAnalysisPhase;
  newest?: boolean;
  result?: AnalyzeResponse;
  reviews?: CollectedReview[];
  error?: string;
  errorCode?: string;
}

export interface CollectionRequest {
  type: "COLLECT_FOR_ANALYSIS";
  requestId: string;
  placeId: string;
  debug?: boolean;
}

export type CollectionResponse =
  | { ok: true; data: CollectedReviews; newest: boolean; verifiedTitle: string }
  | { ok: false; error: string; errorCode?: string; verifiedTitle?: string };

export interface MerchantVerified {
  type: "MERCHANT_VERIFIED";
  requestId: string;
  placeId: string;
  verifiedTitle: string;
}

export interface CollectionStarted {
  type: "COLLECTION_STARTED";
  requestId: string;
  verifiedTitle: string;
}

export interface CollectionProgress {
  type: "COLLECTION_PROGRESS";
  requestId: string;
  placeId: string;
  count: number;
}

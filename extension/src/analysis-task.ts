import type { AnalyzeRequest, AnalyzeResponse } from "./types";

export const ANALYSIS_TASK_PREFIX = "analysis-task:";
export const taskKey = (tabId: number) => ANALYSIS_TASK_PREFIX + tabId;

export interface StartAnalysisRequest {
  type: "START_FROM_PANEL";
  tabId: number;
  placeId: string;
  debug: boolean;
}

export type StartAnalysisResponse = { ok: true } | { ok: false; errorCode: "PLACE_ID_MISMATCH" };

export type AnalysisPhase = "opening_reviews" | "collecting" | "analyzing" | "done" | "failed";

export interface AnalysisTask {
  requestId: string;
  tabId: number;
  placeId: string;
  phase: AnalysisPhase;
  deadlineAt: number;
  verifiedTitle?: string;
  newest?: boolean;
  result?: AnalyzeResponse;
  reviews?: AnalyzeRequest["reviews"];
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
  | { ok: true; data: AnalyzeRequest; newest: boolean; verifiedTitle?: string }
  | { ok: false; error: string; errorCode?: string };

export interface CollectionStarted {
  type: "COLLECTION_STARTED";
  requestId: string;
  verifiedTitle: string;
}


export interface ReviewInput {
  review_id: string;
  rating: number;
  text: string;
  relative_time: string | null;
  author_reviews_count: number | null;
  review_date: string | null;
}

export interface AnalyzeRequest {
  place_id: string;
  scraped_at: string;
  reviews: ReviewInput[];
}

export interface ReviewAnalysis {
  aspect: string;
  sentiment: string;
  summary: string;
  evidence_review_ids: string[];
}

export interface TimelineBucket {
  month: string;
  review_count: number;
  negative_count: number;
  negative_ratio: number;
}

export interface AnalyzeResponse {
  cache_hit: boolean;
  analysis_mode: "mock" | "gemini";
  analyzed_count: number;
  metrics: Record<string, number | null>;
  anomaly_alert: boolean;
  timeline: TimelineBucket[];
  aspect_scores: Record<string, number>;
  pros: ReviewAnalysis[];
  cons: ReviewAnalysis[];
  suspicious_reasons_breakdown: Record<string, number>;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  detail?: string | ApiErrorDetail;
}

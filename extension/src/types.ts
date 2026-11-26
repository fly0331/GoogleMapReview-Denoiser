
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

export interface RecommendedDish {
  name: string;
  summary: string;
  evidence_review_ids: string[];
}

export type VisitInformationCategory =
  | "budget"
  | "wait_time"
  | "reservation"
  | "parking"
  | "dining_time_limit"
  | "payment"
  | "other";

export interface PracticalVisitInformation {
  category: VisitInformationCategory;
  summary: string;
  evidence_review_ids: string[];
}

export interface AnalyzeResponse {
  cache_hit: boolean;
  analysis_mode: "mock" | "gemini";
  model_id?: string | null;
  analyzed_count: number;
  aspect_scores: Record<string, number>;
  decision_pros: string;
  decision_cons: string;
  pros: ReviewAnalysis[];
  cons: ReviewAnalysis[];
  recommended_dishes: RecommendedDish[];
  practical_visit_information: PracticalVisitInformation[];
}

export interface ApiErrorDetail {
  code: string;
  message: string;
}

export interface ApiErrorResponse {
  detail?: string | ApiErrorDetail;
}

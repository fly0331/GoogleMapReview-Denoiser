
import type {
    AnalyzeRequest,
    AnalyzeResponse,
    ApiErrorResponse,
    VisitInformationCategory,
} from "./types";

const ANALYZE_ENDPOINT = import.meta.env.VITE_API_BASE_URL + "/api/v1/analyze";
const REQUEST_TIMEOUT_MS = 60_000;
const INVALID_RESULT = "分析服務回傳了無法讀取的結果。";
const visitCategories: ReadonlySet<string> = new Set<VisitInformationCategory>([
    "budget", "wait_time", "reservation", "parking", "dining_time_limit", "payment", "other",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvidenceItem(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && typeof value.summary === "string" &&
        Array.isArray(value.evidence_review_ids) && value.evidence_review_ids.every((id) => typeof id === "string");
}

function isAnalysisResponse(value: unknown): value is AnalyzeResponse {
    if (!isRecord(value) || typeof value.cache_hit !== "boolean" ||
        (value.analysis_mode !== "gemini" && value.analysis_mode !== "mock") ||
        (value.model_id != null && typeof value.model_id !== "string") ||
        typeof value.analyzed_count !== "number" || !Number.isInteger(value.analyzed_count) || value.analyzed_count < 0 ||
        typeof value.decision_pros !== "string" || typeof value.decision_cons !== "string" ||
        !isRecord(value.aspect_scores) || !Object.values(value.aspect_scores).every((score) => typeof score === "number" && Number.isFinite(score))) {
        return false;
    }

    const isAspect = (item: unknown) => isEvidenceItem(item) && typeof item.aspect === "string" && typeof item.sentiment === "string";
    return Array.isArray(value.pros) && value.pros.every(isAspect) &&
        Array.isArray(value.cons) && value.cons.every(isAspect) &&
        Array.isArray(value.recommended_dishes) && value.recommended_dishes.every((item) => isEvidenceItem(item) && typeof item.name === "string") &&
        Array.isArray(value.practical_visit_information) && value.practical_visit_information.every((item) =>
            isEvidenceItem(item) && typeof item.category === "string" && visitCategories.has(item.category));
}

export async function analyzeReviews(
    request: AnalyzeRequest,
    signal?: AbortSignal,
): Promise<AnalyzeResponse> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();

    const timeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS
    );

    try {
        const response = await fetch(ANALYZE_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
            signal: controller.signal,
        });

        if (!response.ok) {
            let detail = `API request failed (${response.status})`;

            try {
                const errorData =
                    (await response.json()) as ApiErrorResponse;

                if (typeof errorData.detail === "string") {
                    detail = errorData.detail;
                } else if (
                    errorData.detail &&
                    typeof errorData.detail.message === "string"
                ) {
                    detail = errorData.detail.message;
                }
            } catch {
                // Keep the default HTTP error message.
            }

            throw new Error(detail);
        }

        const data: unknown = await response.json();
        if (!isRecord(data)) {
            throw new Error(INVALID_RESULT);
        }
        const result = {
            decision_pros: "", decision_cons: "", aspect_scores: {},
            pros: [], cons: [], recommended_dishes: [], practical_visit_information: [],
            ...data,
        };
        if (!isAnalysisResponse(result)) {
            throw new Error(INVALID_RESULT);
        }
        return result;
    } catch (error: unknown) {
        if (error instanceof SyntaxError) {
            throw new Error(INVALID_RESULT);
        }
        if (error instanceof Error && error.name === "AbortError") {
            throw new Error("Analysis request timed out.");
        }

        if (error instanceof TypeError) {
            throw new Error(
                "Cannot connect to the backend. Please check whether FastAPI is running."
            );
        }

        throw error;
    } finally {
        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", cancel);
    }
}

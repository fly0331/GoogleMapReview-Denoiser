
import type {
    AnalyzeRequest,
    AnalyzeResponse,
    ApiErrorResponse,
} from "./types";

const ANALYZE_ENDPOINT = import.meta.env.VITE_API_BASE_URL + "/api/v1/analyze";
const REQUEST_TIMEOUT_MS = 60_000;

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

        return (await response.json()) as AnalyzeResponse;
    } catch (error: unknown) {
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

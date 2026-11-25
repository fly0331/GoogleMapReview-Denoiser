
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  ApiErrorResponse,
} from "./types";

const API_BASE_URL = "http://127.0.0.1:8000";
const ANALYZE_ENDPOINT = `${API_BASE_URL}/api/v1/analyze`;
const REQUEST_TIMEOUT_MS = 60_000;

export async function analyzeReviews(
  request: AnalyzeRequest
): Promise<AnalyzeResponse> {
  const controller = new AbortController();

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
  }
}

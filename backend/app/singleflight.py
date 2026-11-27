import logging
from collections.abc import Callable
from concurrent.futures import Future, TimeoutError
from threading import Lock

from app.core.schemas import AnalyzeResponse
from app.services.llm_absa import LLMAnalysisError


logger = logging.getLogger("uvicorn.error.lumora_analysis")


class SingleFlight:
    def __init__(self, *, wait_seconds: float = 45, max_entries: int = 16, max_followers: int = 16):
        self.wait_seconds = wait_seconds
        self.max_entries = max_entries
        self.max_followers = max_followers
        self._lock = Lock()
        self._entries: dict[str, Future[AnalyzeResponse | LLMAnalysisError]] = {}
        self._followers = 0

    def run(self, key: str, work: Callable[[], AnalyzeResponse]) -> AnalyzeResponse:
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                if len(self._entries) >= self.max_entries:
                    raise LLMAnalysisError("LLM_BUSY", "AI 分析服務目前忙碌，請稍後再試。", 503)
                entry = self._entries[key] = Future()
                leader = True
            else:
                if self._followers >= self.max_followers:
                    raise LLMAnalysisError("LLM_BUSY", "AI 分析服務目前忙碌，請稍後再試。", 503)
                self._followers += 1
                leader = False

        if not leader:
            try:
                logger.info("singleflight_follower")
                outcome = entry.result(timeout=self.wait_seconds)
            except TimeoutError as error:
                raise LLMAnalysisError("SINGLEFLIGHT_WAIT_TIMEOUT", "共用分析等待逾時，請稍後再試。", 504) from error
            finally:
                with self._lock:
                    self._followers -= 1
            if isinstance(outcome, LLMAnalysisError):
                raise LLMAnalysisError(outcome.code, outcome.message, outcome.status_code)
            return outcome

        failure = LLMAnalysisError("ANALYSIS_UNAVAILABLE", "分析服務暫時無法使用，請稍後再試。", 503)
        try:
            logger.info("singleflight_leader")
            response = work()
            entry.set_result(response)
            return response
        except LLMAnalysisError as error:
            failure = LLMAnalysisError(error.code, error.message, error.status_code)
            raise
        except Exception as error:
            raise failure from error
        finally:
            failed = not entry.done()
            if failed:
                entry.set_result(failure)
            with self._lock:
                if self._entries.get(key) is entry:
                    del self._entries[key]
            if failed:
                logger.warning("singleflight_failure", extra={"error_code": failure.code})


import time
from collections import deque
from threading import Lock


CLEANUP_INTERVAL = 100


class InMemoryRateLimiter:
    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: dict[str, deque[float]] = {}
        self.lock = Lock()
        self._calls_since_cleanup = 0

    def _cleanup_expired(self, now: float) -> None:
        cutoff = now - self.window_seconds

        for key, timestamps in list(self.requests.items()):
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()

            if not timestamps:
                del self.requests[key]

    def is_allowed(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self.lock:
            self._calls_since_cleanup += 1

            if self._calls_since_cleanup >= CLEANUP_INTERVAL:
                self._cleanup_expired(now)
                self._calls_since_cleanup = 0

            timestamps = self.requests.setdefault(key, deque())

            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()

            if len(timestamps) >= self.max_requests:
                return False

            timestamps.append(now)
            return True

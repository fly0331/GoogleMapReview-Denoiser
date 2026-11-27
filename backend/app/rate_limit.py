
import time
from collections import deque
from math import ceil
from threading import Lock


CLEANUP_INTERVAL = 100


class InMemoryRateLimiter:
    def __init__(self, max_requests: int = 5, window_seconds: int = 60, max_clients: int = 10_000):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.max_clients = max_clients
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
        return self.retry_after(key) is None

    def retry_after(self, key: str) -> int | None:
        with self.lock:
            now = time.monotonic()
            cutoff = now - self.window_seconds
            self._calls_since_cleanup += 1

            if self._calls_since_cleanup >= CLEANUP_INTERVAL:
                self._cleanup_expired(now)
                self._calls_since_cleanup = 0

            timestamps = self.requests.get(key)
            if timestamps is None:
                if len(self.requests) >= self.max_clients:
                    return max(1, self.window_seconds)
                timestamps = self.requests[key] = deque()

            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()

            if len(timestamps) >= self.max_requests:
                return max(1, ceil(timestamps[0] + self.window_seconds - now))

            timestamps.append(now)
            return None

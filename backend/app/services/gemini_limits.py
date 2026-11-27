import sqlite3
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import BoundedSemaphore


class GeminiBusyError(Exception):
    pass


class GeminiQuotaExceededError(Exception):
    pass


def utc_day() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class GeminiLimits:
    def __init__(self, path: str | Path, daily_calls: int, concurrent_calls: int):
        self.path = path
        self.daily_calls = daily_calls
        self.slots = BoundedSemaphore(concurrent_calls)

    def _reserve_daily_call(self) -> None:
        with closing(sqlite3.connect(self.path, timeout=5.0)) as connection, connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS gemini_daily_quota (
                    day TEXT PRIMARY KEY,
                    calls INTEGER NOT NULL
                )
            """)
            connection.execute("BEGIN IMMEDIATE")
            reserved = connection.execute("""
                INSERT INTO gemini_daily_quota (day, calls) VALUES (?, 1)
                ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ?
            """, (utc_day(), self.daily_calls))
            if reserved.rowcount != 1:
                raise GeminiQuotaExceededError

    @contextmanager
    def reserve(self):
        if not self.slots.acquire(blocking=False):
            raise GeminiBusyError
        try:
            self._reserve_daily_call()
            yield
        finally:
            self.slots.release()

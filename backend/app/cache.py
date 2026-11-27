
import hashlib
import json
import sqlite3
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4


CACHE_FORMAT_VERSION = 4


@dataclass(frozen=True)
class CacheEntry:
    place_id: str
    value: str
    cached_at: float
    response: dict[str, Any]
    analysis_key: str | None


def create_fingerprint(payload: dict[str, Any]) -> str:
    """Create a stable SHA-256 fingerprint from a JSON-compatible payload."""
    canonical_payload = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(canonical_payload.encode("utf-8")).hexdigest()


class SQLiteCache:
    def __init__(
        self,
        path: str | Path,
        ttl_seconds: int = 7 * 24 * 60 * 60,
    ):
        self.path = str(path)
        self.ttl_seconds = ttl_seconds
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            self.path,
            timeout=5.0,
        )
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _delete_expired(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            "DELETE FROM cache WHERE cached_at <= ?",
            (time.time() - self.ttl_seconds,),
        )
    
    def _initialize(self) -> None:
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection, connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS cache (
                    place_id TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    cached_at REAL NOT NULL
                )
                """
            )
            self._delete_expired(connection)

    def get(
        self,
        place_id: str,
        fingerprint: str,
    ) -> dict[str, Any] | None:
        entry = self.get_entry(place_id, fingerprint)
        return entry.response if entry else None

    def get_entry(self, place_id: str, fingerprint: str) -> CacheEntry | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT value, cached_at FROM cache WHERE place_id = ?",
                (place_id,),
            ).fetchone()

        if row is None:
            return None

        value, cached_at = row
        if time.time() - cached_at >= self.ttl_seconds:
            self._delete_if_unchanged(place_id, value, cached_at)
            return None

        try:
            envelope = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            self._delete_if_unchanged(place_id, value, cached_at)
            return None

        if not isinstance(envelope, dict) or envelope.get("format_version") != CACHE_FORMAT_VERSION:
            self._delete_if_unchanged(place_id, value, cached_at)
            return None

        if envelope.get("fingerprint") != fingerprint:
            return None

        response = envelope.get("response")
        analysis_key = envelope.get("analysis_key")
        if not isinstance(response, dict) or ("analysis_key" in envelope and not isinstance(analysis_key, str)):
            self._delete_if_unchanged(place_id, value, cached_at)
            return None

        return CacheEntry(place_id, value, cached_at, response, analysis_key)

    def set(
        self,
        place_id: str,
        fingerprint: str,
        response: dict[str, Any],
        *,
        analysis_key: str | None = None,
    ) -> None:
        envelope = {
            "format_version": CACHE_FORMAT_VERSION,
            "fingerprint": fingerprint,
            "write_id": uuid4().hex,
            "response": response,
        }
        if analysis_key is not None:
            envelope["analysis_key"] = analysis_key

        with closing(self._connect()) as connection, connection:
            self._delete_expired(connection)
            connection.execute(
                """
                INSERT OR REPLACE INTO cache(place_id, value, cached_at)
                VALUES (?, ?, ?)
                """,
                (
                    place_id,
                    json.dumps(envelope, ensure_ascii=False),
                    time.time(),
                ),
            )

    def delete_entry(self, entry: CacheEntry) -> None:
        self._delete_if_unchanged(entry.place_id, entry.value, entry.cached_at)

    def _delete_if_unchanged(self, place_id: str, value: str, cached_at: float) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "DELETE FROM cache WHERE place_id = ? AND value = ? AND cached_at = ?",
                (place_id, value, cached_at),
            )

    def delete(self, place_id: str) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "DELETE FROM cache WHERE place_id = ?",
                (place_id,),
            )

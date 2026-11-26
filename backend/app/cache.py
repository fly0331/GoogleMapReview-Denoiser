
import hashlib
import json
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Any


CACHE_FORMAT_VERSION = 2


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
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT value, cached_at FROM cache WHERE place_id = ?",
                (place_id,),
            ).fetchone()

        if row is None:
            return None

        cached_at = row[1]
        if time.time() - cached_at >= self.ttl_seconds:
            self.delete(place_id)
            return None

        try:
            envelope = json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            self.delete(place_id)
            return None

        if not isinstance(envelope, dict):
            self.delete(place_id)
            return None

        if envelope.get("format_version") != CACHE_FORMAT_VERSION:
            self.delete(place_id)
            return None

        if envelope.get("fingerprint") != fingerprint:
            return None

        response = envelope.get("response")
        if not isinstance(response, dict):
            self.delete(place_id)
            return None

        return response

    def set(
        self,
        place_id: str,
        fingerprint: str,
        response: dict[str, Any],
    ) -> None:
        envelope = {
            "format_version": CACHE_FORMAT_VERSION,
            "fingerprint": fingerprint,
            "response": response,
        }

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

    def delete(self, place_id: str) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "DELETE FROM cache WHERE place_id = ?",
                (place_id,),
            )

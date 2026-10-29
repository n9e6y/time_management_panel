"""A small in-memory cache for analysis results, keyed on file content + settings + range."""
from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from datetime import date


def analysis_key(body: bytes, settings: dict, first_day: date, last_day: date) -> str:
    """Same file, same settings and same range give the same key."""
    digest = hashlib.sha256(body).hexdigest()
    return f"{digest}|{json.dumps(settings, sort_keys=True)}|{first_day}|{last_day}"


class AnalysisCache:
    """Least-recently-used cache holding a few finished responses."""

    def __init__(self, maxsize: int = 8):
        self.maxsize = maxsize
        self._items: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> dict | None:
        with self._lock:
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key]

    def put(self, key: str, value: dict) -> None:
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self.maxsize:
                self._items.popitem(last=False)

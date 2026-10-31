"""The user's calendar saved on this computer, outside the repository (design: ux-v2/IA.md §5).

Folder: ``~/.time-analyzer/`` (override with env ``TIME_ANALYZER_HOME``). Only ``calendar/`` is used so far:
``current.ics`` + ``current.json`` and one ``previous.*`` copy kept after a replace. No web framework imports.
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import ingest
import syntax

if TYPE_CHECKING:
    from config import Config

DEFAULT_HOME = Path.home() / ".time-analyzer"


def data_home() -> Path:
    """The personal data folder; read from the environment each time so tests can redirect it."""
    return Path(os.environ.get("TIME_ANALYZER_HOME") or DEFAULT_HOME)


@dataclass(frozen=True)
class CalendarInfo:
    name: str
    size: int
    sha256: str
    loaded_at: str               # when it was loaded here (UTC, ISO)
    data_as_of: str | None       # the file's modified time from the browser: close to when it was exported
    first_day: str | None        # local dates the file covers
    last_day: str | None
    events: int
    known_share: float           # share of event titles with a configured category (wrong-file guard)


def _iso_or_none(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return None


def describe(body: bytes, name: str, data_as_of: str | None, config: Config) -> CalendarInfo:
    """Read the facts of a calendar file. Raises ValueError when it isn't a readable calendar."""
    try:
        cal = ingest.load_calendar(body)
    except Exception as exc:  # icalendar raises several kinds; the caller shows one generic message
        raise ValueError("not a calendar") from exc
    events = list(cal.walk("VEVENT"))
    first, last = ingest.calendar_span(cal, config.tz)
    titles = [str(e.get("SUMMARY", "")) for e in events]
    known = sum(syntax.parse_title(t, config).category in config.categories for t in titles)
    return CalendarInfo(
        name=name, size=len(body), sha256=hashlib.sha256(body).hexdigest(),
        loaded_at=datetime.now(timezone.utc).isoformat(timespec="seconds"), data_as_of=_iso_or_none(data_as_of),
        first_day=first.isoformat() if first else None, last_day=last.isoformat() if last else None,
        events=len(events), known_share=known / len(titles) if titles else 0.0,
    )


def compare(current: CalendarInfo | None, new: CalendarInfo) -> list[dict]:
    """Reasons a replacement may be the wrong calendar (empty when it looks like a newer export of the same one)."""
    if current is None or not (current.first_day and new.first_day):
        return []
    span = lambda i: (datetime.fromisoformat(i.last_day) - datetime.fromisoformat(i.first_day)).days + 1
    warnings = []
    if span(new) < span(current) / 2:
        warnings.append({"code": "shorter_span", "current": span(current), "new": span(new)})
    if new.last_day < current.last_day:
        warnings.append({"code": "ends_earlier", "current": current.last_day, "new": new.last_day})
    if new.known_share < 0.5 and new.known_share < current.known_share / 2:
        warnings.append({"code": "few_known_categories", "current": current.known_share, "new": new.known_share})
    return warnings


class CalendarStore:
    """The saved calendar plus one previous copy. Files are written atomically."""

    def __init__(self, home: Path):
        self.folder = Path(home) / "calendar"

    def _paths(self, which: str) -> tuple[Path, Path]:
        return self.folder / f"{which}.ics", self.folder / f"{which}.json"

    def info(self, which: str = "current") -> CalendarInfo | None:
        _, meta = self._paths(which)
        return CalendarInfo(**json.loads(meta.read_text(encoding="utf-8"))) if meta.exists() else None

    def read(self) -> bytes | None:
        body, _ = self._paths("current")
        return body.read_bytes() if body.exists() else None

    def has_previous(self) -> bool:
        return self._paths("previous")[0].exists()

    def save(self, body: bytes, info: CalendarInfo) -> None:
        """Make this the current calendar; the old current one becomes the previous copy."""
        self.folder.mkdir(parents=True, exist_ok=True)
        if self._paths("current")[0].exists():
            for src, dst in zip(self._paths("current"), self._paths("previous")):
                os.replace(src, dst)
        ics_path, meta_path = self._paths("current")
        _write_atomic(ics_path, body)
        _write_atomic(meta_path, json.dumps(asdict(info), indent=1).encode())

    def restore(self) -> CalendarInfo:
        """Swap the current and previous calendars. Raises LookupError when there is no previous copy."""
        if not self.has_previous():
            raise LookupError("no previous calendar")
        swap = [self.folder / "swap.ics", self.folder / "swap.json"]
        for a, b, tmp in zip(self._paths("current"), self._paths("previous"), swap):
            os.replace(a, tmp)
            os.replace(b, a)
            os.replace(tmp, b)
        return self.info()

    def remove(self) -> None:
        for which in ("current", "previous"):
            for path in self._paths(which):
                path.unlink(missing_ok=True)


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)

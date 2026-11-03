"""Title corrections: fixing a mistyped event title without re-exporting the calendar.

Pure apart from reading and writing ``corrections.yaml``: no web framework. A correction gives a new title and
says what it applies to:

* ``uid`` - one event (every occurrence of a repeating one, since they share a UID);
* ``match_title`` - every event whose title is exactly this text, which is how a habit gets fixed once.

Corrections are applied in :func:`ingest.build_blocks` just before the title is parsed, so a fix reaches every
chart, every goal and the CSV export. They are kept beside the calendar rather than written into it: a corrected
``.ics`` would be undone by the next export, while a UID or a title text still matches.

The calendar in Google is never changed; the app only reads it.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

CORRECTIONS_FILE = "corrections.yaml"


class CorrectionsError(ValueError):
    """A corrections file that can't be used; the message lists every problem found."""


@dataclass(frozen=True)
class Correction:
    """One fix: ``title`` replaces the title of the event(s) the matcher names."""
    title: str
    uid: str | None = None
    match_title: str | None = None

    @property
    def key(self) -> str:
        """How the correction is referred to in the API and the UI."""
        return f"uid:{self.uid}" if self.uid else f"title:{self.match_title}"

    @property
    def scope(self) -> str:
        return "event" if self.uid else "title"


@dataclass(frozen=True)
class Resolver:
    """The corrections in the shape ``build_blocks`` needs: a title lookup that never raises."""
    by_uid: dict[str, str]
    by_title: dict[str, str]

    def title_for(self, uid: str, title: str) -> str:
        """The corrected title, or the original. A fix for one event wins over a fix for the text."""
        return self.by_uid.get(uid) or self.by_title.get(title.strip()) or title

    def __bool__(self) -> bool:
        return bool(self.by_uid or self.by_title)


EMPTY = Resolver(by_uid={}, by_title={})


def resolver(corrections: list[Correction]) -> Resolver:
    return Resolver(
        by_uid={c.uid: c.title for c in corrections if c.uid},
        by_title={c.match_title.strip(): c.title for c in corrections if c.match_title},
    )


# --- validation, loading and saving ------------------------------------------------------------

def corrections_from_dict(data, source: str = "") -> list[Correction]:
    """Validate plain data into corrections, or raise CorrectionsError listing every problem."""
    errors: list[str] = []
    if data is None:
        return []
    if isinstance(data, list):
        data = {"corrections": data}
    if not isinstance(data, dict):
        raise CorrectionsError(f"Invalid corrections: expected a mapping with a 'corrections' list, got {data!r}")
    raw = data.get("corrections") or []
    if not isinstance(raw, list):
        raise CorrectionsError(f"Invalid corrections: 'corrections' must be a list, got {raw!r}")

    out: list[Correction] = []
    for i, item in enumerate(raw):
        where = f"corrections[{i}]"
        if not isinstance(item, dict):
            errors.append(f"{where}: expected a mapping, got {item!r}")
            continue
        title = item.get("title")
        if not isinstance(title, str) or not title.strip():
            errors.append(f"{where}.title: expected the corrected title, got {title!r}")
            continue
        uid = item.get("uid") or None
        match_title = item.get("match_title") or None
        if bool(uid) == bool(match_title):
            errors.append(f"{where}: give either uid (one event) or match_title (every event written that way), "
                          f"not both and not neither")
            continue
        if uid is not None and not isinstance(uid, str):
            errors.append(f"{where}.uid: expected the event's UID as text, got {uid!r}")
            continue
        if match_title is not None and (not isinstance(match_title, str) or not match_title.strip()):
            errors.append(f"{where}.match_title: expected the title to match, got {match_title!r}")
            continue
        out.append(Correction(title=title.strip(), uid=uid,
                              match_title=match_title.strip() if match_title else None))

    keys = [c.key for c in out]
    for key in {k for k in keys if keys.count(k) > 1}:
        errors.append(f"two corrections for the same {key.split(':', 1)[0]}: keep one")
    if errors:
        where = f" ({source})" if source else ""
        raise CorrectionsError(f"Invalid corrections{where}:\n" + "\n".join(f"  - {e}" for e in errors))
    return out


def corrections_to_dict(corrections: list[Correction]) -> dict:
    items = []
    for c in corrections:
        item: dict = {"title": c.title}
        if c.uid:
            item["uid"] = c.uid
        else:
            item["match_title"] = c.match_title
        items.append(item)
    return {"corrections": items}


SAVED_HEADER = (
    "# Title corrections, saved by Time Analyzer (Data quality -> Fix title).\n"
    "# Each one replaces an event's title when the calendar is read; the calendar file itself is not changed.\n"
    "# uid: one event (all occurrences of a repeating one) | match_title: every event with exactly that title\n"
)


def load_corrections(path: str | Path) -> list[Correction]:
    """Read corrections.yaml. A missing file means no corrections, not an error."""
    path = Path(path)
    if not path.exists():
        return []
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        line = f" (line {mark.line + 1})" if mark else ""
        raise CorrectionsError(f"{path} is not valid YAML{line}: {getattr(exc, 'problem', exc)}") from exc
    return corrections_from_dict(data, source=str(path))


def save_corrections(corrections: list[Correction], path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = yaml.safe_dump(corrections_to_dict(corrections), sort_keys=False, allow_unicode=True,
                          default_flow_style=None)
    path.write_text(SAVED_HEADER + text, encoding="utf-8")
    return path

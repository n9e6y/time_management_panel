"""Event title grammar: ``CATEGORY: task #tag +project [score]``.

Pure functions only; ``parse_title`` never raises on user text. Spec and test table: c-c-k/docs/SYNTAX_SPEC.md.
Tokens are whole whitespace-separated words, so ``C#``, ``C++`` and ``e-mail`` stay part of the task.
"""
from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from config import Config

CATEGORY_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_ ]*")
TAG = re.compile(r"#([A-Za-z0-9_-]+)")
PROJECT = re.compile(r"\+([A-Za-z0-9_-]+)")
BRACKET = re.compile(r"\[([^\[\]\s]*)\]")   # any bracket word is a score attempt
SCORE = re.compile(r"[1-5]")
COLONS = ":\uff1a\ufe55"  # ASCII, full-width and small colon all separate the category


def clean_name(text: str) -> str:
    """Normalize a category name as typed: look-alike forms become ASCII (NFKC), invisible format characters
    (zero-width space/joiners, byte-order mark) are dropped, whitespace is collapsed. Case is handled by callers."""
    text = unicodedata.normalize("NFKC", text)
    return " ".join("".join(ch for ch in text if unicodedata.category(ch) != "Cf").split())


@dataclass
class ParsedTitle:
    category: str | None
    task: str
    subcategories: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    projects: list[str] = field(default_factory=list)
    score: int | None = None
    issues: list[str] = field(default_factory=list)


@dataclass
class _Tokens:
    words: list[str] = field(default_factory=list)   # words that are not tokens
    tags: list[str] = field(default_factory=list)
    projects: list[str] = field(default_factory=list)
    scores: list[int] = field(default_factory=list)
    invalid_scores: int = 0

    def add(self, text: str) -> "_Tokens":
        for word in text.split():
            if m := TAG.fullmatch(word):
                _append_unique(self.tags, m.group(1).lower())
            elif m := PROJECT.fullmatch(word):
                _append_unique(self.projects, m.group(1).lower())
            elif m := BRACKET.fullmatch(word):
                if SCORE.fullmatch(m.group(1)):
                    self.scores.append(int(m.group(1)))
                else:
                    self.invalid_scores += 1
            else:
                self.words.append(word)
        return self


def _append_unique(items: list[str], value: str) -> None:
    if value not in items:
        items.append(value)


def split_subcategories(task: str, separator: str) -> list[str]:
    """Split the task on the separator, trimming parts and dropping empty ones.

    A separator that is one word (``-`` in ``" - "``) only matches as a standalone word, so ``-youtube`` and
    ``e-mail`` never split.
    """
    mark = separator.strip()
    if mark and not any(ch.isspace() for ch in mark):
        parts, current = [], []
        for word in task.split():
            if word == mark:
                parts.append(" ".join(current))
                current = []
            else:
                current.append(word)
        parts.append(" ".join(current))
    else:
        parts = task.split(separator) if separator else [task]
    return [p.strip() for p in parts if p.strip()]


def _no_category(title: str, config: Config) -> ParsedTitle:
    task = " ".join(title.split())
    return ParsedTitle(None, task, split_subcategories(task, config.subcategory_separator) if task else [],
                       issues=["missing_category"])


def parse_title(title: str, config: Config) -> ParsedTitle:
    """Parse one event title against the configured categories, tags and separator."""
    title = title if isinstance(title, str) else ""
    split_at = min((i for i in (title.find(c) for c in COLONS) if i >= 0), default=-1)
    if split_at < 0:
        # A title that is just a category name ("Sleep", "sleep [4]") counts as that category.
        tokens = _Tokens().add(title)
        name = clean_name(" ".join(tokens.words)).upper()
        if name and (name in config.categories or name in config.legacy_categories):
            tokens.words = []
            return _finish(name, tokens, [], config, needs_task=False)
        return _no_category(title, config)

    prefix, body = clean_name(title[:split_at]), title[split_at + 1:]  # the task keeps its characters as typed
    issues = []
    tokens = _Tokens()
    name = prefix
    if not CATEGORY_NAME.fullmatch(name):
        # Lenient rule: tokens typed before the category still count, with a warning.
        tokens.add(prefix)
        name = " ".join(tokens.words)
        if not tokens.words or not CATEGORY_NAME.fullmatch(name) or len(tokens.words) == len(prefix.split()):
            return _no_category(title, config)
        tokens.words = []
        issues.append("tokens_before_category")
    tokens.add(body)
    return _finish(name.upper(), tokens, issues, config)


def _finish(category: str, tokens: _Tokens, issues: list[str], config: Config, needs_task: bool = True) -> ParsedTitle:
    """Apply category, score and tag rules to the extracted tokens."""
    if category in config.legacy_categories:
        rule = config.legacy_categories[category]
        issues.append("legacy_category")
        category = rule.map_to or category
        for tag in rule.add_tags:
            _append_unique(tokens.tags, tag)
    elif category not in config.categories:
        issues.append("unknown_category")

    score = None
    if tokens.invalid_scores:
        issues.append("invalid_score")
    if len(tokens.scores) > 1:
        issues.append("multiple_scores")
    elif tokens.scores:
        score = tokens.scores[0]

    task = " ".join(tokens.words)
    if not task and needs_task:
        issues.append("empty_task")
    if any(tag not in config.known_tags for tag in tokens.tags):
        issues.append("unknown_tag")

    return ParsedTitle(category, task, split_subcategories(task, config.subcategory_separator),
                       tokens.tags, tokens.projects, score, issues)


# --- comments ----------------------------------------------------------------------------------

_LINE_BREAK = re.compile(r"<br\s*/?>|</p\s*>|</div\s*>|</li\s*>", re.IGNORECASE)
_TAG_MARKUP = re.compile(r"<[^>]+>")


def clean_description(text: str | None) -> str:
    """Event DESCRIPTION as plain text: HTML line breaks become ``\\n``, other markup is removed, entities decoded."""
    if not isinstance(text, str) or not text:
        return ""
    text = _LINE_BREAK.sub("\n", text)
    text = html.unescape(_TAG_MARKUP.sub("", text))
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    return "\n".join(lines).strip()

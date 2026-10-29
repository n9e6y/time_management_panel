"""Stage 2 title grammar tests. The table is SYNTAX_SPEC.md section 6, row by row."""
from dataclasses import replace
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

import config
import syntax

CONFIG = config.load_config(Path(__file__).resolve().parent.parent / "config.example.yaml")

# (title, category, task, subcategories, tags, projects, score, issues)
SPEC_TABLE = [
    ("SLEEP: night", "SLEEP", "night", ["night"], [], [], None, []),
    ("LEARN: calculus ch.4 #deep +exam-prep [4]", "LEARN", "calculus ch.4", ["calculus ch.4"], ["deep"],
     ["exam-prep"], 4, []),
    ("learn: Calculus", "LEARN", "Calculus", ["Calculus"], [], [], None, []),
    ("ME: fixing laptop #unplanned [2]", "ME", "fixing laptop", ["fixing laptop"], ["unplanned"], [], 2, []),
    ("LEARN: C# basics", "LEARN", "C# basics", ["C# basics"], [], [], None, []),
    ("LEARN: C++ templates +cpp-course", "LEARN", "C++ templates", ["C++ templates"], [], ["cpp-course"], None, []),
    ("JOB: follow-up e-mail", "JOB", "follow-up e-mail", ["follow-up e-mail"], [], [], None, []),
    ("ME: chill - youtube [3]", "ME", "chill - youtube", ["chill", "youtube"], [], [], 3, []),
    ("RESEARCH: paper: attention is all you need", "RESEARCH", "paper: attention is all you need",
     ["paper: attention is all you need"], [], [], None, []),
    ("SOCIAL:dinner", "SOCIAL", "dinner", ["dinner"], [], [], None, []),
    ("CLASS: lab report #Deep #deep", "CLASS", "lab report", ["lab report"], ["deep"], [], None, []),
    ("[4] #deep LEARN: x", "LEARN", "x", ["x"], ["deep"], [], 4, ["tokens_before_category"]),
    ("ME: chill [7]", "ME", "chill", ["chill"], [], [], None, ["invalid_score"]),
    ("ME: chill [3] [4]", "ME", "chill", ["chill"], [], [], None, ["multiple_scores"]),
    ("LEARN: #deep [4]", "LEARN", "", [], ["deep"], [], 4, ["empty_task"]),
    ("Birthday reminder", None, "Birthday reminder", ["Birthday reminder"], [], [], None, ["missing_category"]),
    ("GYM: legs", "GYM", "legs", ["legs"], [], [], None, ["unknown_category"]),
    ("LEARN: rust #async-io", "LEARN", "rust", ["rust"], ["async-io"], [], None, ["unknown_tag"]),
    ("LEARN: build API - write tests +hack-week [4]", "LEARN", "build API - write tests",
     ["build API", "write tests"], [], ["hack-week"], 4, []),
    ("ME: chill -youtube", "ME", "chill -youtube", ["chill -youtube"], [], [], None, []),
    ("#deep: x", None, "#deep: x", ["#deep: x"], [], [], None, ["missing_category"]),
]


@pytest.mark.parametrize("row", SPEC_TABLE, ids=[f"row{i + 1}" for i in range(len(SPEC_TABLE))])
def test_spec_table(row):
    title, *expected = row

    p = syntax.parse_title(title, CONFIG)

    assert [p.category, p.task, p.subcategories, p.tags, p.projects, p.score, p.issues] == expected


# --- more rules from the spec -----------------------------------------------------------------

def test_invalid_score_forms_are_removed_and_flagged():
    for title in ["ME: chill [0]", "ME: chill [x]", "ME: chill [3.5]"]:
        p = syntax.parse_title(title, CONFIG)
        assert (p.task, p.score, p.issues) == ("chill", None, ["invalid_score"]), title


def test_one_valid_and_one_invalid_score_keeps_the_valid_one():
    p = syntax.parse_title("ME: chill [3] [9]", CONFIG)

    assert (p.score, p.issues) == (3, ["invalid_score"])


def test_whitespace_is_collapsed_before_splitting():
    p = syntax.parse_title("ME:   chill   -\tyoutube  ", CONFIG)

    assert (p.task, p.subcategories) == ("chill - youtube", ["chill", "youtube"])


def test_tokens_between_parts_do_not_leave_blank_parts():
    p = syntax.parse_title("ME: chill - [3] - youtube", CONFIG)

    assert (p.task, p.subcategories, p.score) == ("chill - - youtube", ["chill", "youtube"], 3)
    assert syntax.parse_title("ME: - chill", CONFIG).subcategories == ["chill"]


def test_legacy_category_keeps_its_own_group_and_gets_unplanned():
    p = syntax.parse_title("URGANT: fixing laptop", CONFIG)

    assert (p.category, p.tags, p.issues) == ("URGANT", ["unplanned"], ["legacy_category"])


def test_legacy_category_can_be_mapped_to_a_category():
    cfg = replace(CONFIG, legacy_categories={"URGENT": config.LegacyRule(map_to="ME", add_tags=("unplanned",))})

    p = syntax.parse_title("urgent: fixing laptop #unplanned", cfg)

    assert (p.category, p.tags, p.issues) == ("ME", ["unplanned"], ["legacy_category"])


def test_removing_a_category_from_config_makes_it_unknown():
    cfg = replace(CONFIG, categories={k: v for k, v in CONFIG.categories.items() if k != "LEARN"})

    assert syntax.parse_title("LEARN: calculus", cfg).issues == ["unknown_category"]


def test_custom_separator_from_config():
    cfg = replace(CONFIG, subcategory_separator=" / ")

    assert syntax.parse_title("ME: chill / youtube - music", cfg).subcategories == ["chill", "youtube - music"]


def test_non_text_title_does_not_raise():
    p = syntax.parse_title(None, CONFIG)

    assert (p.category, p.task, p.issues) == (None, "", ["missing_category"])


# --- property: never raises, never leaves tokens in the task ----------------------------------

TITLE_CHARS = st.sampled_from(list("abcLEARNme0159 #+[]:-_.\t") + ["C#", "C++", " - ", "[4]", "#deep", "+p"])


def _has_token(word: str) -> bool:
    return bool(syntax.TAG.fullmatch(word) or syntax.PROJECT.fullmatch(word) or syntax.BRACKET.fullmatch(word))


@settings(max_examples=500, deadline=None)
@given(st.one_of(st.text(), st.lists(TITLE_CHARS, max_size=30).map("".join)))
def test_any_title_parses_without_error_and_task_has_no_tokens(title):
    p = syntax.parse_title(title, CONFIG)

    assert isinstance(p.task, str) and isinstance(p.issues, list)
    if p.category is not None:  # titles without a category keep their text untouched, by design
        assert not any(_has_token(word) for word in p.task.split())
        assert p.score is None or 1 <= p.score <= 5


# --- comments ---------------------------------------------------------------------------------

@pytest.mark.parametrize("raw, clean", [
    ("a<br>b &amp; c", "a\nb & c"),
    ("<p>one</p><p>two</p>", "one\ntwo"),
    ("<b>bold</b> and <a href='x'>link</a>", "bold and link"),
    ("love &lt;3", "love <3"),
    ("line one  \nline two", "line one\nline two"),
    ("", ""),
    (None, ""),
])
def test_clean_description(raw, clean):
    assert syntax.clean_description(raw) == clean

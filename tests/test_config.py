"""Stage 2 config tests (spec: c-c-k/docs/stages/STAGE_2_syntax_and_config.md)."""
from pathlib import Path

import pytest
import yaml

import config
from config import ConfigError

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "config.example.yaml"


def example_dict() -> dict:
    return yaml.safe_load(EXAMPLE.read_text())


def with_changes(**changes) -> dict:
    data = example_dict()
    data.update(changes)
    return data


def error_text(data: dict) -> str:
    with pytest.raises(ConfigError) as exc:
        config.config_from_dict(data)
    return str(exc.value)


# --- the example ------------------------------------------------------------------------------

def test_example_config_loads_with_the_decided_defaults():
    cfg = config.load_config(EXAMPLE)

    assert cfg.timezone == "Asia/Tehran"
    assert cfg.week_start == "Saturday"
    assert cfg.days_off == frozenset({"Friday"})
    assert list(cfg.categories) == ["SLEEP", "JOB", "CLASS", "LEARN", "RESEARCH", "SOCIAL", "ME"]
    assert cfg.focus_categories == {"JOB", "CLASS", "LEARN", "RESEARCH"}
    assert cfg.focus_min_minutes == 90
    assert cfg.subcategory_separator == " - "
    assert cfg.known_tags == frozenset({"deep", "shallow", "unplanned"})
    assert cfg.legacy_categories["URGENT"].map_to is None
    assert cfg.legacy_categories["URGANT"].add_tags == ("unplanned",)
    assert cfg.source == str(EXAMPLE)


def test_names_are_normalized():
    data = with_changes(week_start="saturday", days_off=["FRIDAY", "thursday"],
                        categories={"learn": {"focus": True}, "Me": None},
                        tags={"known": ["Deep"]}, legacy_categories={})

    cfg = config.config_from_dict(data)

    assert cfg.week_start == "Saturday"
    assert cfg.days_off == frozenset({"Friday", "Thursday"})
    assert list(cfg.categories) == ["LEARN", "ME"]
    assert cfg.known_tags == frozenset({"deep"})


def test_optional_settings_have_defaults():
    cfg = config.config_from_dict({"timezone": "UTC", "categories": {"ME": {}}})

    assert cfg.week_start == "Saturday"
    assert cfg.days_off == frozenset()
    assert cfg.focus_min_minutes == 90
    assert cfg.subcategory_separator == " - "


# --- readable errors ----------------------------------------------------------------------------

def test_bad_timezone_is_named():
    assert "timezone: Unknown timezone: 'Mars/Base'" in error_text(with_changes(timezone="Mars/Base"))


def test_unknown_weekdays_are_named():
    text = error_text(with_changes(week_start="Someday", days_off=["Friday", "Fryday"]))

    assert "week_start: 'Someday' is not a weekday" in text
    assert "days_off[1]: 'Fryday' is not a weekday" in text


def test_negative_focus_minutes_is_rejected():
    assert "focus.min_minutes" in error_text(with_changes(focus={"min_minutes": -5}))


def test_all_problems_are_reported_together():
    text = error_text(with_changes(timezone="Nowhere", focus={"min_minutes": -1}, days_off="Friday"))

    assert "timezone" in text and "focus.min_minutes" in text and "days_off" in text


def test_legacy_mapping_must_target_a_configured_category():
    data = with_changes(legacy_categories={"URGENT": {"map_to": "WORK", "add_tags": ["unplanned"]}})

    assert "legacy_categories.URGENT.map_to: 'WORK' is not a configured category" in error_text(data)


def test_invalid_category_names_and_empty_categories_are_rejected():
    assert "categories" in error_text(with_changes(categories={}))
    assert "'2DO'" in error_text(with_changes(categories={"2DO": {}}))


def test_unknown_setting_is_reported_to_catch_typos():
    assert "unknown setting 'day_off'" in error_text(with_changes(day_off=["Friday"]))


def test_separator_must_not_be_blank():
    assert "syntax.subcategory_separator" in error_text(with_changes(syntax={"subcategory_separator": "  "}))


# --- loading files ----------------------------------------------------------------------------

def test_invalid_yaml_gives_a_readable_error(tmp_path):
    bad = tmp_path / "config.yaml"
    bad.write_text("timezone: UTC\ncategories: [unclosed\n")

    with pytest.raises(ConfigError, match="not valid YAML"):
        config.load_config(bad)


def test_missing_explicit_file_is_an_error(tmp_path):
    with pytest.raises(ConfigError, match="not found"):
        config.load_config(tmp_path / "nope.yaml")


def test_without_config_yaml_the_example_is_used(tmp_path):
    (tmp_path / "config.example.yaml").write_text(EXAMPLE.read_text())

    cfg = config.load_config(root=tmp_path)

    assert cfg.source.endswith("config.example.yaml")


def test_config_yaml_wins_over_the_example(tmp_path):
    (tmp_path / "config.example.yaml").write_text(EXAMPLE.read_text())
    (tmp_path / "config.yaml").write_text("timezone: UTC\ncategories: {ME: {}}\n")

    cfg = config.load_config(root=tmp_path)

    assert cfg.timezone == "UTC" and cfg.source.endswith("config.yaml")


# --- turning a config back into settings and saving it (used by the API) ---------------------

def test_config_round_trips_through_plain_settings():
    cfg = config.load_config(EXAMPLE)

    settings = config.config_to_dict(cfg)

    assert settings["days_off"] == ["Friday"] and settings["categories"]["LEARN"] == {"focus": True, "color": 4}
    assert config.config_from_dict(settings, source=cfg.source) == cfg


def test_days_off_are_listed_in_week_order():
    cfg = config.config_from_dict(with_changes(days_off=["Sunday", "Friday", "Monday"]))

    assert config.config_to_dict(cfg)["days_off"] == ["Monday", "Friday", "Sunday"]


def test_save_config_writes_a_file_that_loads_back(tmp_path):
    cfg = config.config_from_dict(with_changes(week_start="Monday", days_off=["Saturday", "Sunday"]))

    path = config.save_config(cfg, tmp_path / "config.yaml")

    assert path.read_text().startswith("# Time Analyzer settings")
    assert config.config_to_dict(config.load_config(path)) == config.config_to_dict(cfg)


# --- color slots: a category keeps its color when reordered (decided 2026-10-29) ---------------

def test_colors_default_to_config_order():
    cfg = config.load_config(EXAMPLE)

    assert [c.color for c in cfg.categories.values()] == [1, 2, 3, 4, 5, 6, 7]


def test_explicit_colors_survive_reordering_and_new_categories_take_the_first_free_slot():
    cfg = config.config_from_dict(with_changes(categories={"ME": {"color": 7}, "SLEEP": {"color": 1}, "GYM": {}}))

    assert {n: c.color for n, c in cfg.categories.items()} == {"ME": 7, "SLEEP": 1, "GYM": 2}
    assert config.config_to_dict(cfg)["categories"]["GYM"] == {"focus": False, "color": 2}


def test_categories_beyond_the_ninth_have_no_color():
    names = {f"C{i}": {} for i in range(10)}

    cfg = config.config_from_dict(with_changes(categories=names, legacy_categories={}))

    assert [c.color for c in cfg.categories.values()] == [1, 2, 3, 4, 5, 6, 7, 8, 9, None]


def test_bad_or_duplicate_colors_are_rejected():
    text = error_text(with_changes(categories={"ME": {"color": 10}, "SLEEP": {"color": 1}, "JOB": {"color": 1}}))

    assert "categories.ME.color" in text and "categories.JOB.color: slot 1 is already used" in text


def test_category_names_in_config_ignore_case_and_hidden_characters():
    cfg = config.config_from_dict(with_changes(categories={"sle\u200cep": {}, "Me": {}},
                                               legacy_categories={"urgent": {"map_to": "me"}}))

    assert list(cfg.categories) == ["SLEEP", "ME"] and cfg.legacy_categories["URGENT"].map_to == "ME"


from app.csv_import import kind_for_type, parse_int, parse_number
from app.models import ItemKind


def test_parse_number_variants():
    assert parse_number("0.5") == 0.5
    assert parse_number("12.666666666666666") == 12.666666666666666
    assert parse_number("60") == 60.0
    assert parse_number("") is None
    assert parse_number(None) is None
    assert parse_number("  ") is None


def test_parse_int_variants():
    assert parse_int("20") == 20
    assert parse_int("") is None
    assert parse_int("8") == 8
    # tolerate a stray decimal like "5.0"
    assert parse_int("5.0") == 5


def test_kind_for_type_known():
    assert kind_for_type("Enabler Feature") == (ItemKind.FEATURE, None)
    assert kind_for_type("Feature") == (ItemKind.FEATURE, None)
    assert kind_for_type("Enabler Story") == (ItemKind.STORY, None)
    assert kind_for_type("Risk") == (ItemKind.RISK, None)


def test_kind_for_type_unknown_defaults_to_feature_with_warning():
    kind, warning = kind_for_type("Spike")
    assert kind == ItemKind.FEATURE
    assert warning is not None and "Spike" in warning

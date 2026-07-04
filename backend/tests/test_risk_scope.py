from app.csv_import import classify_risk_scope
from app.models import ItemKind


def test_art_risk_from_kategorie():
    assert classify_risk_scope(ItemKind.RISK, "ART Risk") == "art"


def test_team_risk_from_kategorie():
    assert classify_risk_scope(ItemKind.RISK, "Team Risk") == "team"


def test_case_insensitive_and_substring():
    assert classify_risk_scope(ItemKind.RISK, "some ART RISK note") == "art"
    assert classify_risk_scope(ItemKind.RISK, "team risk") == "team"


def test_risk_without_marker_is_none():
    assert classify_risk_scope(ItemKind.RISK, "Infrastruktur") is None
    assert classify_risk_scope(ItemKind.RISK, None) is None
    assert classify_risk_scope(ItemKind.RISK, "") is None


def test_non_risk_is_none():
    assert classify_risk_scope(ItemKind.FEATURE, "ART Risk") is None
    assert classify_risk_scope(ItemKind.STORY, "Team Risk") is None

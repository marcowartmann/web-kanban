from pathlib import Path

from app.csv_import import parse_items, read_rows
from app.models import ItemKind

FIXTURE = Path(__file__).parent / "fixtures" / "team_planning.csv"


def _parse_fixture():
    rows = read_rows(FIXTURE.read_bytes())
    return parse_items(rows)


def test_synthetic_positional_hierarchy():
    rows = [
        {"Title": "Feature A", "Type": "Enabler Feature", "Status": "Analyzing",
         "Story Points": "", "Parent": "", "WSJF Score": "60"},
        {"Title": "Story A1", "Type": "Enabler Story", "Status": "Analyzing",
         "Story Points": "0.5", "Parent": "Feature A", "WSJF Score": ""},
        {"Title": "Story A2", "Type": "Enabler Story", "Status": "Analyzing",
         "Story Points": "0.8", "Parent": "Feature A", "WSJF Score": ""},
        {"Title": "Risk X", "Type": "Risk", "Status": "New",
         "Story Points": "", "Parent": "", "WSJF Score": ""},
    ]
    parsed = parse_items(rows)
    assert len(parsed.features) == 1
    assert len(parsed.risks) == 1
    feature = parsed.features[0]
    assert [s.data["title"] for s in feature.stories] == ["Story A1", "Story A2"]
    assert feature.stories[0].data["story_points"] == 0.5
    assert parsed.risks[0].data["title"] == "Risk X"


def test_story_before_any_feature_is_warned_and_skipped():
    rows = [
        {"Title": "Orphan", "Type": "Enabler Story", "Status": "", "Parent": ""},
    ]
    parsed = parse_items(rows)
    assert parsed.features == []
    assert any("Orphan" in w for w in parsed.warnings)


def test_real_fixture_counts_and_duplicates():
    parsed = _parse_fixture()
    # 9 Risk rows in the fixture (verified by inspection of Team Planning Q3 26.csv)
    assert len(parsed.risks) == 9
    # Duplicate feature title appears as two separate features
    netapp = [f for f in parsed.features if f.data["title"] == "NetApp AirGap Recovery - ruttm"]
    assert len(netapp) == 2
    # Each NetApp feature owns its own 3 stories (recurring child titles)
    assert all(len(f.stories) == 3 for f in netapp)
    # A recurring story title is parented under multiple distinct features
    parents_of_doku = [
        f.data["title"]
        for f in parsed.features
        for s in f.stories
        if s.data["title"].strip() == "Dokumentation"
    ]
    assert len(set(parents_of_doku)) >= 2


def test_real_fixture_multiline_description_preserved():
    parsed = _parse_fixture()
    teton = next(f for f in parsed.features if f.data["title"].startswith("Teton Isolierung"))
    assert "\n" in (teton.data["description"] or "")

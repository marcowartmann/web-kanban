from app.csv_import import parse_items


def _rows(*dicts):
    return list(dicts)


def test_import_sets_risk_scope_from_kategorie():
    rows = _rows(
        {"Title": "Feature A", "Type": "Feature", "Kategorie": "Infrastruktur"},
        {"Title": "R1", "Type": "Risk", "Kategorie": "ART Risk"},
        {"Title": "R2", "Type": "Risk", "Kategorie": "Team Risk"},
        {"Title": "R3", "Type": "Risk", "Kategorie": "Infrastruktur"},
    )
    parsed = parse_items(rows)
    scopes = {r.data["title"]: r.data.get("risk_scope") for r in parsed.risks}
    assert scopes == {"R1": "art", "R2": "team", "R3": None}
    # non-risk items carry no scope
    assert parsed.features[0].data.get("risk_scope") is None

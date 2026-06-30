def test_lists_and_seeds_default_boards(client):
    boards = client.get("/api/boards").json()
    assert [b["name"] for b in boards] == ["Features & Stories", "Risks"]
    fs = boards[0]
    assert fs["kinds"] == ["feature", "story"]
    assert [lane["name"] for lane in fs["lanes"]] == ["Funnel", "Analyzing", "New"]
    risks = boards[1]
    assert risks["kinds"] == ["risk"]
    assert [lane["name"] for lane in risks["lanes"]] == ["New", "Analyzing", "Resolved"]


def test_seeding_is_idempotent(client):
    first = client.get("/api/boards").json()
    second = client.get("/api/boards").json()
    assert len(first) == 2 and len(second) == 2
    assert [b["id"] for b in first] == [b["id"] for b in second]

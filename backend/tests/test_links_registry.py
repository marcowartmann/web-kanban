from app.links import RELATIONS, canonicalize, relation_options


def test_seed_relations_present():
    assert set(RELATIONS) == {"blocks", "relates_to"}
    assert RELATIONS["blocks"].symmetric is False
    assert RELATIONS["relates_to"].symmetric is True


def test_relation_options_expands_directional_and_symmetric():
    opts = relation_options()
    assert {"relation": "blocks", "direction": "outgoing", "label": "blocks"} in opts
    assert {"relation": "blocks", "direction": "incoming", "label": "blocked by"} in opts
    assert {"relation": "relates_to", "direction": "both", "label": "relates to"} in opts
    # symmetric relation contributes exactly one option
    assert sum(o["relation"] == "relates_to" for o in opts) == 1


def test_canonicalize_orders_symmetric_pair():
    assert canonicalize(5, 2, "relates_to") == (2, 5)
    assert canonicalize(2, 5, "relates_to") == (2, 5)


def test_canonicalize_leaves_directional_untouched():
    assert canonicalize(5, 2, "blocks") == (5, 2)

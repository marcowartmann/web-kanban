from dataclasses import dataclass


@dataclass(frozen=True)
class Relation:
    forward: str   # label shown on the source end
    inverse: str   # label shown on the target end
    symmetric: bool


RELATIONS: dict[str, Relation] = {
    "blocks": Relation(forward="blocks", inverse="blocked by", symmetric=False),
    "relates_to": Relation(forward="relates to", inverse="relates to", symmetric=True),
}


def relation_options() -> list[dict[str, str]]:
    """Directed picker options for the UI, derived from the registry."""
    options: list[dict[str, str]] = []
    for key, rel in RELATIONS.items():
        if rel.symmetric:
            options.append({"relation": key, "direction": "both", "label": rel.forward})
        else:
            options.append({"relation": key, "direction": "outgoing", "label": rel.forward})
            options.append({"relation": key, "direction": "incoming", "label": rel.inverse})
    return options


def canonicalize(source_id: int, target_id: int, relation: str) -> tuple[int, int]:
    """For symmetric relations, order the pair so the smaller id is the source."""
    rel = RELATIONS[relation]
    if rel.symmetric and source_id > target_id:
        return target_id, source_id
    return source_id, target_id

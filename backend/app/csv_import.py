from app.models import ItemKind

_TYPE_MAP: dict[str, ItemKind] = {
    "enabler feature": ItemKind.FEATURE,
    "feature": ItemKind.FEATURE,
    "enabler story": ItemKind.STORY,
    "story": ItemKind.STORY,
    "risk": ItemKind.RISK,
}


def parse_number(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_int(raw: str | None) -> int | None:
    value = parse_number(raw)
    if value is None:
        return None
    return int(value)


def kind_for_type(raw_type: str | None) -> tuple[ItemKind, str | None]:
    key = (raw_type or "").strip().lower()
    if key in _TYPE_MAP:
        return _TYPE_MAP[key], None
    return ItemKind.FEATURE, f"Unknown Type '{raw_type}', treated as feature"

import csv
import io
from dataclasses import dataclass, field

from sqlalchemy import func, select

from app.models import ItemKind

# Column-name constants (CSV header strings)
COL_TITLE = "Title"
COL_DESCRIPTION = "Description / Nutzenhypothese"
COL_TYPE = "Type"
COL_KATEGORIE = "Kategorie"
COL_ART = "ART"
COL_SDI_PRIO = "SDI Prio"
COL_STATUS = "Status"
COL_TSHIRT = "T-Shirt Size"
COL_WSJF = "WSJF Score"
COL_STORY_POINTS = "Story Points"
COL_ITERATION = "Iteration"
COL_LEADING_TEAM = "Leading Team"
COL_SUPPORTING_TEAM = "Supporting Team"
COL_EXTERNER_PARTNER = "Externer Partner"
COL_ASSIGNEE = "Assignee"
COL_AKZEPTANZ = "Akzeptanzkriterien"
COL_DEPENDENCIES = "Dependencies"
COL_BO = "BO/Stakeholder"
COL_BUSINESS_VALUE = "Business Value / Direkter Nutzen (1,2,3,5,8,13,20)"
COL_TIME_CRIT = "Time Criticality / Zukünftiger Nutzen (1,2,3,5,8,13,20)"
COL_RISK_RED = "Risk Reduction / Dringlichkeit (1,2,3,5,8,13,20)"
COL_COST_OF_DELAY = "Cost of Delay"
COL_JOB_SIZE = "Job Size / Aufwand (1,2,3,5,8,13,20)"
COL_PARENT = "Parent"
COL_DOD = "Definition of Done (DoD)"

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


@dataclass
class ParsedItem:
    kind: ItemKind
    data: dict
    stories: list["ParsedItem"] = field(default_factory=list)


@dataclass
class ParsedImport:
    features: list[ParsedItem] = field(default_factory=list)
    risks: list[ParsedItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def read_rows(content: bytes) -> list[dict[str, str]]:
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    return [dict(row) for row in reader]


def _row_to_data(row: dict[str, str]) -> dict:
    g = row.get
    return {
        "title": (g(COL_TITLE) or "").strip(),
        "type": g(COL_TYPE),
        "description": g(COL_DESCRIPTION),
        "kategorie": g(COL_KATEGORIE),
        "art": g(COL_ART),
        "sdi_prio": g(COL_SDI_PRIO),
        "status": (g(COL_STATUS) or "").strip(),
        "tshirt_size": g(COL_TSHIRT),
        "wsjf_score": parse_number(g(COL_WSJF)),
        "story_points": parse_number(g(COL_STORY_POINTS)),
        "planning_interval": g(COL_ITERATION),
        "leading_team": g(COL_LEADING_TEAM),
        "supporting_team": g(COL_SUPPORTING_TEAM),
        "externer_partner": g(COL_EXTERNER_PARTNER),
        "assignee": g(COL_ASSIGNEE),
        "akzeptanzkriterien": g(COL_AKZEPTANZ),
        "dependencies": g(COL_DEPENDENCIES),
        "bo_stakeholder": g(COL_BO),
        "business_value": parse_int(g(COL_BUSINESS_VALUE)),
        "time_criticality": parse_int(g(COL_TIME_CRIT)),
        "risk_reduction": parse_int(g(COL_RISK_RED)),
        "cost_of_delay": parse_number(g(COL_COST_OF_DELAY)),
        "job_size": parse_number(g(COL_JOB_SIZE)),
        "definition_of_done": g(COL_DOD),
    }


def parse_items(rows: list[dict[str, str]]) -> ParsedImport:
    result = ParsedImport()
    current_feature: ParsedItem | None = None

    for index, row in enumerate(rows):
        title = (row.get(COL_TITLE) or "").strip()
        if not title:
            continue
        kind, type_warning = kind_for_type(row.get(COL_TYPE))
        if type_warning:
            result.warnings.append(f"Row {index + 2}: {type_warning}")
        data = _row_to_data(row)

        if kind == ItemKind.FEATURE:
            item = ParsedItem(kind=kind, data=data)
            result.features.append(item)
            current_feature = item
        elif kind == ItemKind.RISK:
            result.risks.append(ParsedItem(kind=kind, data=data))
            # risks do not change the current feature
        else:  # STORY
            if current_feature is None:
                result.warnings.append(
                    f"Row {index + 2}: story '{title}' has no preceding feature; skipped"
                )
                continue
            stated_parent = (row.get(COL_PARENT) or "").strip()
            if stated_parent and stated_parent != current_feature.data["title"]:
                result.warnings.append(
                    f"Row {index + 2}: story '{title}' Parent column "
                    f"'{stated_parent}' != positional parent "
                    f"'{current_feature.data['title']}'; using positional"
                )
            current_feature.stories.append(ParsedItem(kind=kind, data=data))

    return result


def _insert_item(db, parsed_item, parent_id, position):
    from app.models import Item

    item = Item(
        kind=parsed_item.kind,
        parent_id=parent_id,
        position=position,
        **parsed_item.data,
    )
    db.add(item)
    db.flush()  # assign id for child linkage
    return item


def _seed_teams_and_members(db, parsed) -> None:
    from app.models import Team, TeamMember

    all_data = []
    for feature in parsed.features:
        all_data.append(feature.data)
        all_data.extend(story.data for story in feature.stories)
    all_data.extend(risk.data for risk in parsed.risks)

    team_names: set[str] = set()
    for data in all_data:
        for attr in ("leading_team", "supporting_team"):
            raw = data.get(attr)
            if raw:
                for token in str(raw).split(","):
                    token = token.strip()
                    if token:
                        team_names.add(token)
    existing_teams = {t.name for t in db.scalars(select(Team))}
    for name in team_names - existing_teams:
        db.add(Team(name=name))

    member_names: set[str] = set()
    for data in all_data:
        assignee = data.get("assignee")
        if assignee and str(assignee).strip():
            member_names.add(str(assignee).strip())
    existing_members = {m.name for m in db.scalars(select(TeamMember))}
    for name in member_names - existing_members:
        db.add(TeamMember(name=name))


def _seed_planning_intervals(db, parsed) -> None:
    from app.models import PlanningInterval

    all_data = []
    for feature in parsed.features:
        all_data.append(feature.data)
        all_data.extend(story.data for story in feature.stories)
    all_data.extend(risk.data for risk in parsed.risks)

    names: set[str] = set()
    for data in all_data:
        raw = data.get("planning_interval")
        if raw and str(raw).strip():
            names.add(str(raw).strip())
    existing = {p.name for p in db.scalars(select(PlanningInterval))}
    start = db.scalar(select(func.max(PlanningInterval.position))) or 0
    for offset, name in enumerate(sorted(names - existing), start=1):
        db.add(PlanningInterval(name=name, position=start + offset))


def replace_all(db, parsed):
    from app.models import Item
    from app.schemas import ImportResult

    stories = 0
    db.query(Item).delete()
    for f_index, feature in enumerate(parsed.features):
        feature_row = _insert_item(db, feature, None, f_index)
        for s_index, story in enumerate(feature.stories):
            _insert_item(db, story, feature_row.id, s_index)
            stories += 1
    for r_index, risk in enumerate(parsed.risks):
        _insert_item(db, risk, None, r_index)
    _seed_teams_and_members(db, parsed)
    _seed_planning_intervals(db, parsed)
    db.commit()
    return ImportResult(
        features=len(parsed.features),
        stories=stories,
        risks=len(parsed.risks),
        warnings=parsed.warnings,
    )

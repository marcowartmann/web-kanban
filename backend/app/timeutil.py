from datetime import datetime, timezone

from sqlalchemy import DateTime as _DateTime
from sqlalchemy.types import TypeDecorator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DateTime(TypeDecorator):
    """Drop-in replacement for ``sqlalchemy.DateTime`` that always round-trips
    an aware UTC datetime, even on backends whose dialect ignores
    ``timezone=True``.

    PostgreSQL's ``timestamptz`` already round-trips aware datetimes natively,
    so this is a no-op there. SQLite does not: ``sqlalchemy.dialects.sqlite
    .base.DATETIME`` builds/parses its stored string from the naive
    year/month/.../microsecond fields regardless of the ``timezone`` flag,
    silently dropping any tzinfo on both bind and result. Since this app's
    test suite runs against an in-memory SQLite engine (see
    tests/conftest.py), every column would otherwise read back naive after
    any commit + refresh — even though every stored instant is UTC by
    construction (``app.timeutil.utcnow()``). This decorator normalizes both
    directions so callers always see an aware UTC datetime, on every backend.
    """

    impl = _DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is None or value.tzinfo is not None:
            return value
        return value.replace(tzinfo=timezone.utc)

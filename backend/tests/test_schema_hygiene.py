import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.models import Capacity, User


def test_item_response_has_no_dependencies_field(client):
    resp = client.post("/api/v1/items", json={"kind": "feature", "title": "Clean"})
    assert resp.status_code == 201
    assert "dependencies" not in resp.json()


def test_items_filter_columns_are_indexed(db_session):
    names = {ix["name"] for ix in inspect(db_session.get_bind()).get_indexes("items")}
    assert {
        "ix_items_parent_id",
        "ix_items_kind",
        "ix_items_status",
        "ix_items_planning_interval",
        "ix_items_leading_team",
        "ix_items_assignee_id",
    } <= names


def test_capacity_iteration_check_constraint(db_session):
    user = User(display_name="Checked")
    db_session.add(user)
    db_session.flush()
    db_session.add(
        Capacity(user_id=user.id, planning_interval="PI1", iteration=7, points=1)
    )
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()

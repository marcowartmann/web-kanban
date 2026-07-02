from app.models import Comment, Item, User


def _user(db, email="a@x.ch", name="Anna"):
    user = User(email=email, display_name=name, password_hash=None)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _item(db, title="F"):
    item = Item(kind="feature", title=title)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_comment_roundtrip_and_author_name(db_session):
    user = _user(db_session)
    item = _item(db_session)
    comment = Comment(item_id=item.id, author_id=user.id, body="Hello")
    db_session.add(comment)
    db_session.commit()
    db_session.refresh(comment)
    assert comment.id is not None
    assert comment.created_at is not None
    assert comment.updated_at is None
    assert comment.author_name == "Anna"


def test_orm_cascades(db_session):
    user = _user(db_session)
    item = _item(db_session)
    parent = Comment(item_id=item.id, author_id=user.id, body="parent")
    db_session.add(parent)
    db_session.commit()
    reply = Comment(item_id=item.id, author_id=user.id, parent_id=parent.id, body="reply")
    db_session.add(reply)
    db_session.commit()

    # Deleting the parent removes its replies (ORM delete-orphan).
    db_session.delete(parent)
    db_session.commit()
    assert db_session.query(Comment).count() == 0

    solo = Comment(item_id=item.id, author_id=user.id, body="solo")
    db_session.add(solo)
    db_session.commit()
    # Deleting the item removes its comments.
    db_session.delete(item)
    db_session.commit()
    assert db_session.query(Comment).count() == 0

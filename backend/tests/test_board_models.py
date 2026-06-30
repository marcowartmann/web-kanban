from app.models import Board, Lane


def test_board_has_ordered_lanes(db_session):
    board = Board(name="Main", kinds="feature,story", position=0)
    board.lanes.append(Lane(name="Analyzing", position=1))
    board.lanes.append(Lane(name="Funnel", position=0))
    db_session.add(board)
    db_session.commit()
    loaded = db_session.get(Board, board.id)
    assert [lane.name for lane in loaded.lanes] == ["Funnel", "Analyzing"]


def test_deleting_board_cascades_to_lanes(db_session):
    board = Board(name="Main", kinds="risk", position=0)
    board.lanes.append(Lane(name="New", position=0))
    db_session.add(board)
    db_session.commit()
    db_session.delete(board)
    db_session.commit()
    assert db_session.query(Lane).count() == 0

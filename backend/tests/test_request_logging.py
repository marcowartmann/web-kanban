import json
import logging
import re

from fastapi.testclient import TestClient

from app.main import app
from app.request_logging import JsonFormatter, access_logger


@app.get("/api/v1/_boom")
def _boom() -> None:  # pragma: no cover - exercised via TestClient
    raise RuntimeError("boom endpoint")


def _propagate(monkeypatch):
    # access_logger has propagate=False. Deliberately a no-op: pytest's
    # caplog machinery (_pytest.logging.catching_logs) already attaches its
    # capture handler directly to any non-propagating logger at the start of
    # a test's call phase, specifically to support this case. Flipping
    # propagate to True here would make the *same* record also travel to the
    # root logger, where that identical handler is attached too -- caplog
    # would then see two copies of one log call. Left in place (rather than
    # removed) so call sites read the same as the spec and the guard is
    # documented if a future pytest version changes this behavior.
    del monkeypatch


def test_response_carries_generated_request_id(client):
    resp = client.get("/api/v1/items?limit=1")
    rid = resp.headers.get("x-request-id")
    assert rid and re.fullmatch(r"[0-9a-f]{32}", rid)


def test_valid_incoming_request_id_is_echoed(client):
    resp = client.get("/api/v1/items?limit=1", headers={"X-Request-ID": "trace-Abc-123"})
    assert resp.headers["x-request-id"] == "trace-Abc-123"


def test_invalid_incoming_request_id_is_replaced(client):
    resp = client.get("/api/v1/items?limit=1", headers={"X-Request-ID": "bad id!"})
    rid = resp.headers["x-request-id"]
    assert rid != "bad id!" and re.fullmatch(r"[0-9a-f]{32}", rid)


def test_access_record_fields(client, caplog, monkeypatch):
    _propagate(monkeypatch)
    with caplog.at_level(logging.INFO, logger="app.access"):
        resp = client.get("/api/v1/items?limit=1")
    records = [r for r in caplog.records if r.name == "app.access"]
    assert len(records) == 1
    r = records[0]
    assert r.method == "GET"
    assert r.path == "/api/v1/items"
    assert r.status == 200
    assert isinstance(r.duration_ms, int)
    assert r.request_id == resp.headers["x-request-id"]


def test_health_is_exempt_from_access_log(client, caplog, monkeypatch):
    _propagate(monkeypatch)
    with caplog.at_level(logging.INFO, logger="app.access"):
        client.get("/api/health")
    assert [r for r in caplog.records if r.name == "app.access"] == []


def test_unhandled_exception_logs_error_with_request_id(db_session, caplog, monkeypatch):
    _propagate(monkeypatch)
    from app.db import get_db

    app.dependency_overrides[get_db] = lambda: db_session
    try:
        with TestClient(app, raise_server_exceptions=False) as boom_client:
            with caplog.at_level(logging.INFO, logger="app.access"):
                resp = boom_client.get(
                    "/api/v1/_boom", headers={"X-Request-ID": "boom-1"}
                )
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 500
    errors = [r for r in caplog.records if r.name == "app.access" and r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert errors[0].request_id == "boom-1"
    assert errors[0].status == 500
    assert errors[0].exc_info is not None


def test_json_formatter_output_keys():
    fmt = JsonFormatter()
    record = logging.LogRecord("app.access", logging.INFO, __file__, 1, "request", None, None)
    record.request_id = "rid1"
    record.method = "GET"
    record.path = "/x"
    record.status = 200
    record.duration_ms = 7
    line = json.loads(fmt.format(record))
    assert set(line) == {"ts", "level", "logger", "request_id", "method", "path", "status", "duration_ms"}
    assert line["level"] == "info"
    assert line["ts"].endswith("+00:00")
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        import sys

        err = logging.LogRecord(
            "app.access", logging.ERROR, __file__, 1, "unhandled exception", None, sys.exc_info()
        )
    err.request_id = "rid2"
    err.method = "GET"
    err.path = "/x"
    err.status = 500
    err.duration_ms = 3
    eline = json.loads(fmt.format(err))
    assert eline["level"] == "error"
    assert eline["message"] == "unhandled exception"
    assert "RuntimeError: boom" in eline["traceback"]

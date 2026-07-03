"""Request-ID middleware and JSON access logging (logger: app.access)."""

import json
import logging
import logging.config
import re
import time
import traceback
import uuid
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware

access_logger = logging.getLogger("app.access")

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")

HEALTH_PATH = "/api/health"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line: dict = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "request_id": getattr(record, "request_id", None),
            "method": getattr(record, "method", None),
            "path": getattr(record, "path", None),
            "status": getattr(record, "status", None),
            "duration_ms": getattr(record, "duration_ms", None),
        }
        if record.levelno >= logging.ERROR:
            line["message"] = record.getMessage()
            if record.exc_info:
                line["traceback"] = "".join(traceback.format_exception(*record.exc_info))
        return json.dumps(line)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        incoming = request.headers.get("X-Request-ID", "")
        request_id = incoming if REQUEST_ID_RE.fullmatch(incoming) else uuid.uuid4().hex
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            if request.url.path != HEALTH_PATH:
                access_logger.error(
                    "unhandled exception",
                    exc_info=True,
                    extra={
                        "request_id": request_id,
                        "method": request.method,
                        "path": request.url.path,
                        "status": 500,
                        "duration_ms": round((time.perf_counter() - start) * 1000),
                    },
                )
            raise
        response.headers["X-Request-ID"] = request_id
        if request.url.path != HEALTH_PATH:
            access_logger.info(
                "request",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": round((time.perf_counter() - start) * 1000),
                },
            )
        return response


def configure_access_logging() -> None:
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {"json_access": {"()": "app.request_logging.JsonFormatter"}},
            "handlers": {
                "access_json": {"class": "logging.StreamHandler", "formatter": "json_access"}
            },
            "loggers": {
                "app.access": {
                    "handlers": ["access_json"],
                    "level": "INFO",
                    "propagate": False,
                }
            },
        }
    )

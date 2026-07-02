"""Preview-then-confirm helper so tests exercise the real two-step flow."""

import io


def post_import(client, data: bytes, name: str = "p.csv"):
    preview = client.post(
        "/api/v1/import/preview", files={"file": (name, io.BytesIO(data), "text/csv")}
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    return client.post(
        "/api/v1/import",
        files={"file": (name, io.BytesIO(data), "text/csv")},
        data={"state_stamp": body["state_stamp"], "file_sha256": body["file_sha256"]},
    )

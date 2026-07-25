from fastapi import HTTPException


def check_writable(repo) -> None:
    """Guard write endpoints: read-only adapters (external mirrors) answer 405."""
    if repo.read_only:
        raise HTTPException(
            status_code=405,
            detail="This entity is provided by a read-only external source",
        )

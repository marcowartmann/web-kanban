from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.audit import log_event
from app.auth import require_admin
from app.catalog import ports
from app.catalog.factory import get_product_repo
from app.catalog.http import check_writable
from app.db import get_db
from app.models import User
from app.schemas import ProductCreate, ProductRead, ProductUpdate

router = APIRouter(prefix="/api/v1/products", tags=["products"])


@router.get("", response_model=list[ProductRead])
def list_products(repo: ports.ProductRepository = Depends(get_product_repo)):
    return repo.list()


@router.get("/{product_id}", response_model=ProductRead)
def get_product(product_id: int, repo: ports.ProductRepository = Depends(get_product_repo)):
    return repo.get(product_id)


@router.post("", response_model=ProductRead, status_code=201)
def create_product(
    payload: ProductCreate,
    repo: ports.ProductRepository = Depends(get_product_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    product = repo.create(name=payload.name, art_id=payload.art_id,
                          description=payload.description, team_id=payload.team_id)
    log_event(db, actor=current, event_type="product.created", entity_type="product",
              entity_id=product.id, entity_label=product.name)
    db.commit()
    return product


@router.patch("/{product_id}", response_model=ProductRead)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    repo: ports.ProductRepository = Depends(get_product_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    before = repo.get(product_id)
    changes = payload.model_dump(exclude_unset=True)
    product = repo.update(product_id, changes)
    # ids mean nothing in the log — audit the ART/team by name, not id.
    for key, field, old_value, new_value in (
        ("name", "name", before.name, product.name),
        ("description", "description", before.description, product.description),
        ("art_id", "art", before.art_name, product.art_name),
        ("team_id", "team", before.team_name, product.team_name),
    ):
        if key not in changes or old_value == new_value:
            continue
        log_event(db, actor=current, event_type="product.updated", entity_type="product",
                  entity_id=product.id, entity_label=product.name,
                  field=field, old_value=old_value, new_value=new_value)
    db.commit()
    return product


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    repo: ports.ProductRepository = Depends(get_product_repo),
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    check_writable(repo)
    product = repo.get(product_id)
    repo.delete(product_id)
    log_event(db, actor=current, event_type="product.deleted", entity_type="product",
              entity_id=product_id, entity_label=product.name)
    db.commit()

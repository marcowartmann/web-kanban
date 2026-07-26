"""Datasource seam: FastAPI dependencies returning the active repository per
entity. Today everything is Postgres; a future config switch returns an
external adapter (ServiceNow / LeanIX / Jira) here — routers never change."""
from fastapi import Depends
from sqlalchemy.orm import Session

from app.catalog import ports
from app.catalog.adapters.postgres import (
    PostgresArtRepository,
    PostgresComponentRepository,
    PostgresContractRepository,
    PostgresProductRepository,
    PostgresServiceRepository,
    PostgresSystemRepository,
    PostgresVendorRepository,
)
from app.db import get_db


def get_art_repo(db: Session = Depends(get_db)) -> ports.ArtRepository:
    return PostgresArtRepository(db)


def get_product_repo(db: Session = Depends(get_db)) -> ports.ProductRepository:
    return PostgresProductRepository(db)


def get_service_repo(db: Session = Depends(get_db)) -> ports.ServiceRepository:
    return PostgresServiceRepository(db)


def get_vendor_repo(db: Session = Depends(get_db)) -> ports.VendorRepository:
    return PostgresVendorRepository(db)


def get_component_repo(db: Session = Depends(get_db)) -> ports.ComponentRepository:
    return PostgresComponentRepository(db)


def get_system_repo(db: Session = Depends(get_db)) -> ports.SystemRepository:
    return PostgresSystemRepository(db)


def get_contract_repo(db: Session = Depends(get_db)) -> ports.ContractRepository:
    return PostgresContractRepository(db)

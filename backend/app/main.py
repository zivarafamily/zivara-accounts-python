import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routes import auth, core, imports, uploads, ledger, manual_journal, payables_safe
from app.services import accounting_sync

try:
    from app.services import payables_roundoff  # noqa: F401
except ImportError:
    payables_roundoff = None

try:
    from app.services import neo_invoice_accounting  # noqa: F401
except ImportError:
    neo_invoice_accounting = None

try:
    from app.services import existing_bank_batch_settlement  # noqa: F401
except ImportError:
    existing_bank_batch_settlement = None

try:
    from app.services.selectcityfly_bill_backfill import (
        repair_selectcityfly_missing_bill_journals,
    )
except ImportError:
    repair_selectcityfly_missing_bill_journals = None

settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
# IMPORTANT: payable-safe routes must come before core.router so vendor payment
# never auto-marks TDS paid/filed.
app.include_router(payables_safe.router)
app.include_router(core.router)
app.include_router(imports.router)
app.include_router(uploads.router)
app.include_router(ledger.router)
app.include_router(manual_journal.router)


def _sync_accounting_startup():
    if hasattr(accounting_sync, "sync_existing_accounting_masters"):
        return accounting_sync.sync_existing_accounting_masters()
    if hasattr(accounting_sync, "sync_existing_accounting_ledgers"):
        return accounting_sync.sync_existing_accounting_ledgers()
    if hasattr(accounting_sync, "sync_existing_bank_ledgers"):
        return accounting_sync.sync_existing_bank_ledgers()
    return None


@app.on_event("startup")
def sync_accounting_masters():
    _sync_accounting_startup()

    # Targeted source-truth repair only. This rebuilds SelectCityFly purchase
    # journals and explicit TDS-paid/filed state. It never creates/deletes bank
    # transactions and never calls the payable payment synchronizer directly.
    if repair_selectcityfly_missing_bill_journals:
        try:
            repair_selectcityfly_missing_bill_journals()
        except Exception:
            logging.getLogger(__name__).exception(
                "SelectCityFly Vendor Bill journal repair did not complete"
            )


app.mount(
    "/uploads",
    StaticFiles(directory=settings.upload_dir, check_dir=False),
    name="uploads",
)

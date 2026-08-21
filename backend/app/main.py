from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routes import auth, core, imports, uploads, ledger
from app.services import accounting_sync

try:
    from app.services import payables_roundoff  # noqa: F401
except ImportError:
    payables_roundoff = None

try:
    from app.services import neo_invoice_accounting  # noqa: F401
except ImportError:
    neo_invoice_accounting = None

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
app.include_router(core.router)
app.include_router(imports.router)
app.include_router(uploads.router)
app.include_router(ledger.router)


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


app.mount(
    "/uploads",
    StaticFiles(directory=settings.upload_dir, check_dir=False),
    name="uploads",
)

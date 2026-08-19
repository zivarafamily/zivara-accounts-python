from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routes import auth, core, imports, uploads, ledger
from app.services.accounting_sync import sync_existing_accounting_masters

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


@app.on_event("startup")
def sync_accounting_masters():
    # Master-ledger backfill only. No historical Payable/Expense transactions
    # are posted automatically.
    sync_existing_accounting_masters()


app.mount(
    "/uploads",
    StaticFiles(directory=settings.upload_dir, check_dir=False),
    name="uploads",
)

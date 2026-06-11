import json
from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from app.config import get_settings
from app.database import SessionLocal
from app.models import LLP, LLPPartner, Setting, User
from app.security import hash_password
from app.services.common import make_id


def run_migrations():
    backend_dir = Path(__file__).resolve().parents[2]
    alembic_cfg = Config(str(backend_dir / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")


def seed():
    run_migrations()
    settings = get_settings()
    db = SessionLocal()
    try:
        llp = db.get(LLP, "LLP001")
        if not llp:
            llp = LLP(
                id="LLP001",
                llp_name="Zivara Family Office LLP",
                short_code="ZIVARA",
                gstin="",
                pan="",
                address="",
                status="Active",
            )
            db.add(llp)

        admin = db.query(User).filter(User.email == settings.seed_admin_email).first()
        if not admin:
            admin = User(
                id="USR_ADMIN",
                name=settings.seed_admin_name,
                email=settings.seed_admin_email,
                username=settings.seed_admin_email.split("@")[0],
                password_hash=hash_password(settings.seed_admin_password),
                role="admin",
                allowed_modules=json.dumps([
                    "dashboard", "paymenttracker", "vendors", "expenses", "receipts",
                    "reimbursements", "reconciliation", "vendorledger", "catdsreport",
                    "bankaccounts", "cashbook", "llps", "partners",
                ]),
                status="Active",
            )
            db.add(admin)

        db.flush()
        link = db.query(LLPPartner).filter(LLPPartner.llp_id == llp.id, LLPPartner.user_id == admin.id).first()
        if not link:
            db.add(LLPPartner(
                id=make_id("MAP"),
                llp_id=llp.id,
                user_id=admin.id,
                role="admin",
                percentage="",
                allowed_modules=admin.allowed_modules,
                status="Active",
            ))

        defaults = {
            "CompanyName": "Zivara Family Office LLP",
            "GSTIN": "",
            "Address": "",
            "SupplierStateCode": "",
            "ActiveFY": f"{datetime.now(timezone.utc).year}-{datetime.now(timezone.utc).year + 1}",
            "DefaultGSTPct": "18",
        }
        for key, value in defaults.items():
            existing = db.query(Setting).filter(Setting.llp_id == llp.id, Setting.key == key).first()
            if not existing:
                db.add(Setting(id=make_id("SET"), llp_id=llp.id, key=key, value=value))

        db.commit()
        print(f"Seed complete: admin={settings.seed_admin_email}, llp={llp.id}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()

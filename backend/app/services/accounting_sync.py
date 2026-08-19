"""Accounting master synchronization.

Scope:
- BankAccount -> exactly one system Bank Ledger
- Vendor (with LLP) -> exactly one system Vendor Ledger

This module intentionally does NOT import or modify Neo Invoice or Neo Revenue.
"""

from datetime import datetime, timezone
import re
import uuid

from sqlalchemy import event, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import BankAccount, Vendor
from app.models.ledger import JournalLine, Ledger


def _utcnow():
    return datetime.now(timezone.utc)


def _clean_suffix(value, length=10):
    return re.sub(r"[^A-Za-z0-9]", "", str(value or ""))[-length:].upper()


def _unique_code_connection(connection, llp_id, preferred):
    ledger_table = Ledger.__table__
    base = re.sub(r"[^A-Za-z0-9]", "", str(preferred or "LEDGER").upper())[:32] or "LEDGER"
    candidate = base
    i = 2
    while connection.execute(
        select(ledger_table.c.id).where(
            ledger_table.c.llp_id == llp_id,
            ledger_table.c.ledger_code == candidate,
        )
    ).first():
        suffix = str(i)
        candidate = f"{base[:40-len(suffix)]}{suffix}"
        i += 1
    return candidate[:40]


def _unique_name_connection(connection, llp_id, preferred):
    ledger_table = Ledger.__table__
    base = str(preferred or "Ledger").strip()[:240] or "Ledger"
    candidate = base
    i = 2
    while connection.execute(
        select(ledger_table.c.id).where(
            ledger_table.c.llp_id == llp_id,
            ledger_table.c.ledger_name == candidate,
        )
    ).first():
        suffix = f" ({i})"
        candidate = f"{base[:255-len(suffix)]}{suffix}"
        i += 1
    return candidate[:255]


# ---------------------------------------------------------------------------
# Bank ledgers
# ---------------------------------------------------------------------------

def _bank_system_key(bank_id):
    return f"bank:{bank_id}"


def _bank_ledger_code(bank):
    return f"BANK{_clean_suffix(bank.id)}"[:40]


def _bank_ledger_name(bank):
    account_name = str(bank.account_name or bank.bank_name or "Bank Account").strip()
    account_no = re.sub(r"\s+", "", str(bank.account_number or ""))
    suffix = account_no[-4:] if account_no else _clean_suffix(bank.id, 6)
    return f"Bank - {account_name} ({suffix})"[:255]


def _opening_parts(value):
    try:
        amount = value or 0
        negative = amount < 0
    except TypeError:
        amount = float(value or 0)
        negative = amount < 0
    return abs(amount), ("Cr" if negative else "Dr")


def _bank_values(bank):
    opening_balance, opening_side = _opening_parts(bank.opening_balance)
    return {
        "ledger_name": _bank_ledger_name(bank),
        "group_name": "Cash & Bank",
        "account_type": "Asset",
        "opening_balance": opening_balance,
        "opening_side": opening_side,
        "status": "Active" if bank.is_active else "Inactive",
        "notes": "System-linked bank ledger. Manage bank details from Bank A/C.",
        "system_key": _bank_system_key(bank.id),
        "updated_at": _utcnow(),
    }


def _sync_bank_connection(connection, bank):
    ledger_table = Ledger.__table__
    key = _bank_system_key(bank.id)

    existing = connection.execute(
        select(ledger_table.c.id).where(
            ledger_table.c.llp_id == bank.llp_id,
            ledger_table.c.system_key == key,
        )
    ).first()

    values = _bank_values(bank)

    if existing:
        connection.execute(
            update(ledger_table)
            .where(ledger_table.c.id == existing.id)
            .values(**values)
        )
        return

    code = _unique_code_connection(connection, bank.llp_id, _bank_ledger_code(bank))
    name = _unique_name_connection(connection, bank.llp_id, values["ledger_name"])

    connection.execute(
        ledger_table.insert().values(
            id=f"LED-{uuid.uuid4().hex[:24].upper()}",
            llp_id=bank.llp_id,
            ledger_code=code,
            ledger_name=name,
            group_name=values["group_name"],
            account_type=values["account_type"],
            opening_balance=values["opening_balance"],
            opening_side=values["opening_side"],
            status=values["status"],
            notes=values["notes"],
            system_key=values["system_key"],
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
    )


@event.listens_for(BankAccount, "after_insert")
def _bank_after_insert(mapper, connection, target):
    _sync_bank_connection(connection, target)


@event.listens_for(BankAccount, "after_update")
def _bank_after_update(mapper, connection, target):
    _sync_bank_connection(connection, target)


# ---------------------------------------------------------------------------
# Vendor ledgers
# ---------------------------------------------------------------------------

def _vendor_system_key(vendor_id):
    return f"vendor:{vendor_id}"


def _vendor_ledger_code(vendor):
    return f"VEND{_clean_suffix(vendor.id)}"[:40]


def _vendor_ledger_name(vendor):
    return str(vendor.vendor_name or "Vendor").strip()[:255] or "Vendor"


def _vendor_values(vendor):
    return {
        "ledger_name": _vendor_ledger_name(vendor),
        "group_name": "Accounts Payable",
        "account_type": "Liability",
        "opening_balance": 0,
        "opening_side": "Cr",
        "status": "Active" if str(vendor.status or "Active").lower() == "active" else "Inactive",
        "notes": "System-linked vendor ledger. Manage PAN/GSTIN/category from Vendors.",
        "system_key": _vendor_system_key(vendor.id),
        "updated_at": _utcnow(),
    }


def _manual_same_name_ledger_without_history(connection, vendor):
    """Return a same-name manual ledger only if it has no journal history.

    This lets the sync safely adopt a manually-created vendor ledger, while
    never reclassifying a ledger that already has accounting transactions.
    """
    ledger_table = Ledger.__table__
    line_table = JournalLine.__table__

    row = connection.execute(
        select(
            ledger_table.c.id,
            ledger_table.c.system_key,
        ).where(
            ledger_table.c.llp_id == vendor.llp_id,
            ledger_table.c.ledger_name == _vendor_ledger_name(vendor),
        )
    ).first()

    if not row or row.system_key:
        return None

    has_history = connection.execute(
        select(line_table.c.id)
        .where(line_table.c.ledger_id == row.id)
        .limit(1)
    ).first()

    return None if has_history else row.id


def _sync_vendor_connection(connection, vendor):
    # Vendor.llp_id is nullable in the existing app. A ledger must belong to an
    # LLP, so global/unassigned vendors are intentionally skipped.
    if not vendor.llp_id:
        return

    ledger_table = Ledger.__table__
    key = _vendor_system_key(vendor.id)
    values = _vendor_values(vendor)

    existing = connection.execute(
        select(ledger_table.c.id).where(
            ledger_table.c.llp_id == vendor.llp_id,
            ledger_table.c.system_key == key,
        )
    ).first()

    if existing:
        connection.execute(
            update(ledger_table)
            .where(ledger_table.c.id == existing.id)
            .values(**values)
        )
        return

    adopt_id = _manual_same_name_ledger_without_history(connection, vendor)
    if adopt_id:
        # Preserve the user's existing ledger code while converting it into the
        # system-linked Vendor Ledger.
        connection.execute(
            update(ledger_table)
            .where(ledger_table.c.id == adopt_id)
            .values(**values)
        )
        return

    code = _unique_code_connection(connection, vendor.llp_id, _vendor_ledger_code(vendor))
    name = _unique_name_connection(connection, vendor.llp_id, values["ledger_name"])

    connection.execute(
        ledger_table.insert().values(
            id=f"LED-{uuid.uuid4().hex[:24].upper()}",
            llp_id=vendor.llp_id,
            ledger_code=code,
            ledger_name=name,
            group_name=values["group_name"],
            account_type=values["account_type"],
            opening_balance=0,
            opening_side="Cr",
            status=values["status"],
            notes=values["notes"],
            system_key=values["system_key"],
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
    )


@event.listens_for(Vendor, "after_insert")
def _vendor_after_insert(mapper, connection, target):
    _sync_vendor_connection(connection, target)


@event.listens_for(Vendor, "after_update")
def _vendor_after_update(mapper, connection, target):
    _sync_vendor_connection(connection, target)


@event.listens_for(Vendor, "after_delete")
def _vendor_after_delete(mapper, connection, target):
    if not target.llp_id:
        return

    # Never delete accounting history automatically. Retain the ledger and mark
    # it inactive, so old journal transactions remain auditable.
    ledger_table = Ledger.__table__
    connection.execute(
        update(ledger_table)
        .where(
            ledger_table.c.llp_id == target.llp_id,
            ledger_table.c.system_key == _vendor_system_key(target.id),
        )
        .values(
            status="Inactive",
            notes="Vendor master deleted. Ledger retained for accounting history.",
            updated_at=_utcnow(),
        )
    )


# ---------------------------------------------------------------------------
# Startup backfill
# ---------------------------------------------------------------------------

def _sync_existing_bank(db: Session, bank):
    key = _bank_system_key(bank.id)
    ledger = db.query(Ledger).filter(
        Ledger.llp_id == bank.llp_id,
        Ledger.system_key == key,
    ).first()

    values = _bank_values(bank)

    if ledger:
        for field, value in values.items():
            setattr(ledger, field, value)
        return

    code = _bank_ledger_code(bank)
    if db.query(Ledger).filter(
        Ledger.llp_id == bank.llp_id,
        Ledger.ledger_code == code,
    ).first():
        code = f"{code[:32]}{uuid.uuid4().hex[:8].upper()}"[:40]

    name = values["ledger_name"]
    if db.query(Ledger).filter(
        Ledger.llp_id == bank.llp_id,
        Ledger.ledger_name == name,
    ).first():
        name = f"{name[:238]} [{str(bank.id)[-8:]}]"[:255]

    db.add(Ledger(
        id=f"LED-{uuid.uuid4().hex[:24].upper()}",
        llp_id=bank.llp_id,
        ledger_code=code,
        ledger_name=name,
        group_name="Cash & Bank",
        account_type="Asset",
        opening_balance=values["opening_balance"],
        opening_side=values["opening_side"],
        status=values["status"],
        notes=values["notes"],
        system_key=key,
    ))


def _sync_existing_vendor(db: Session, vendor):
    if not vendor.llp_id:
        return

    key = _vendor_system_key(vendor.id)
    ledger = db.query(Ledger).filter(
        Ledger.llp_id == vendor.llp_id,
        Ledger.system_key == key,
    ).first()

    values = _vendor_values(vendor)

    if ledger:
        ledger.ledger_name = values["ledger_name"]
        ledger.group_name = "Accounts Payable"
        ledger.account_type = "Liability"
        ledger.opening_side = "Cr"
        ledger.status = values["status"]
        ledger.notes = values["notes"]
        return

    # Safe adoption rule: same-name manual ledger and no JournalLine history.
    manual = db.query(Ledger).filter(
        Ledger.llp_id == vendor.llp_id,
        Ledger.ledger_name == values["ledger_name"],
        Ledger.system_key == "",
    ).first()

    if manual and not db.query(JournalLine).filter(
        JournalLine.ledger_id == manual.id
    ).first():
        manual.group_name = "Accounts Payable"
        manual.account_type = "Liability"
        manual.opening_balance = 0
        manual.opening_side = "Cr"
        manual.status = values["status"]
        manual.notes = values["notes"]
        manual.system_key = key
        return

    code = _vendor_ledger_code(vendor)
    if db.query(Ledger).filter(
        Ledger.llp_id == vendor.llp_id,
        Ledger.ledger_code == code,
    ).first():
        code = f"{code[:32]}{uuid.uuid4().hex[:8].upper()}"[:40]

    name = values["ledger_name"]
    if db.query(Ledger).filter(
        Ledger.llp_id == vendor.llp_id,
        Ledger.ledger_name == name,
    ).first():
        name = f"Vendor - {name}"[:255]
        if db.query(Ledger).filter(
            Ledger.llp_id == vendor.llp_id,
            Ledger.ledger_name == name,
        ).first():
            name = f"{name[:238]} [{str(vendor.id)[-8:]}]"[:255]

    db.add(Ledger(
        id=f"LED-{uuid.uuid4().hex[:24].upper()}",
        llp_id=vendor.llp_id,
        ledger_code=code,
        ledger_name=name,
        group_name="Accounts Payable",
        account_type="Liability",
        opening_balance=0,
        opening_side="Cr",
        status=values["status"],
        notes=values["notes"],
        system_key=key,
    ))


def sync_existing_accounting_ledgers():
    """Idempotent backfill for existing Bank and Vendor masters."""
    db: Session = SessionLocal()
    try:
        try:
            db.query(Ledger.id).limit(1).all()
        except OperationalError:
            db.rollback()
            return

        for bank in db.query(BankAccount).all():
            _sync_existing_bank(db, bank)

        for vendor in db.query(Vendor).all():
            _sync_existing_vendor(db, vendor)

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

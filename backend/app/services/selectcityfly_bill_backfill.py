"""SelectCityFly April-2026 vendor-ledger repair v3.

This repair is deliberately narrow and deterministic.

Problem
-------
The selected canonical ledger:
    SelectCityFly Tour & Travels 25-26
    Ledger Code: VEND2C876042DB
is missing exactly 21 April 2026 Vendor Bill credits totalling Rs 6,00,171.

The likely cause is duplicate/legacy Vendor master linkage: the old April bills
can have a different VendorID even though VendorName is the same. A normal
"does payable_bill journal exist?" test therefore does not fix the selected
canonical ledger.

What this repair does
---------------------
1. Finds the canonical SelectCityFly Accounts Payable ledger by ledger code.
2. Derives its canonical VendorID from Ledger.system_key = "vendor:<VendorID>".
3. Verifies the exact 21 April bill numbers and exact expected total Rs 6,00,171.
4. Directly normalizes ONLY those 21 Payables to the canonical VendorID using
   SQLAlchemy Core UPDATE (this intentionally bypasses ORM payment sync events).
5. Rebuilds ONLY each payable_bill purchase journal.
6. Verifies that every rebuilt journal credits the canonical ledger.
7. Commits only after all validation passes.

It NEVER calls accounting_sync._sync_payable(), so it cannot recreate payable
payments, bank transfers or reimbursements.
"""

from __future__ import annotations

from decimal import Decimal
import logging
import re

from sqlalchemy import select, update

from app.database import SessionLocal
from app.models import LLPPayable, Vendor
from app.models.ledger import JournalEntry, JournalLine, Ledger
from app.services import accounting_sync as ac


logger = logging.getLogger(__name__)

TARGET_LEDGER_CODE = "VEND2C876042DB"
TARGET_VENDOR_NAME_TOKEN = "selectcityflytourtravels"
EXPECTED_TOTAL = Decimal("600171.00")

EXPECTED_BILLS = {
    "SCF/26-27/0111",
    "SCF/26-27/0163",
    "SCF/26-27/0164",
    "SCF/26-27/0165",
    "SCF/26-27/0166",
    "SCF/26-27/0167",
    "SCF/26-27/0168",
    "SCF/26-27/0169",
    "SCF/26-27/0170",
    "SCF/26-27/0171",
    "SCF/26-27/0172",
    "SCF/26-27/0173",
    "SCF/26-27/0174",
    "SCF/26-27/0175",
    "SCF/26-27/0176",
    "SCF/26-27/0209",
    "SCF/26-27/0231",
    "SCF/26-27/0232",
    "SCF/26-27/0233",
    "SCF/26-27/0234",
    "SCF/26-27/0261",
}


def _compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _canonical_ledger(db):
    exact = (
        db.query(Ledger)
        .filter(Ledger.ledger_code == TARGET_LEDGER_CODE)
        .all()
    )
    if len(exact) == 1:
        return exact[0]

    # Fallback only if the ledger code was changed manually.
    candidates = [
        x for x in db.query(Ledger).filter(Ledger.group_name == "Accounts Payable").all()
        if TARGET_VENDOR_NAME_TOKEN in _compact(x.ledger_name)
    ]
    if len(candidates) != 1:
        raise RuntimeError(
            f"Expected one canonical SelectCityFly Accounts Payable ledger; found {len(candidates)}"
        )
    return candidates[0]


def _canonical_vendor_id(db, ledger: Ledger) -> str:
    key = str(ledger.system_key or "")
    if key.startswith("vendor:") and key.split(":", 1)[1]:
        vendor_id = key.split(":", 1)[1]
        vendor = db.get(Vendor, vendor_id)
        if vendor:
            return vendor_id

    # Fallback: find a Vendor master in the same LLP whose exact linked ledger
    # is the selected canonical ledger.
    for vendor in db.query(Vendor).filter(Vendor.llp_id == ledger.llp_id).all():
        if TARGET_VENDOR_NAME_TOKEN not in _compact(vendor.vendor_name):
            continue
        linked = (
            db.query(Ledger)
            .filter(
                Ledger.llp_id == ledger.llp_id,
                Ledger.system_key == f"vendor:{vendor.id}",
            )
            .first()
        )
        if linked and linked.id == ledger.id:
            return vendor.id

    raise RuntimeError(
        f"Canonical ledger {ledger.ledger_name} does not resolve to a Vendor master"
    )


def _target_rows(db, llp_id: str):
    rows = (
        db.query(LLPPayable)
        .filter(
            LLPPayable.llp_id == llp_id,
            LLPPayable.bill_no.in_(EXPECTED_BILLS),
        )
        .order_by(LLPPayable.bill_date, LLPPayable.bill_no, LLPPayable.id)
        .all()
    )

    found = {str(x.bill_no or "").strip() for x in rows}
    missing = sorted(EXPECTED_BILLS - found)
    extras = sorted(found - EXPECTED_BILLS)

    if len(rows) != len(EXPECTED_BILLS) or missing or extras:
        raise RuntimeError(
            "SelectCityFly April repair validation failed: "
            f"expected {len(EXPECTED_BILLS)} exact bills, found {len(rows)}; "
            f"missing={missing}, extras={extras}"
        )

    if any(str(x.status or "").strip().lower() == "cancelled" for x in rows):
        cancelled = [x.bill_no for x in rows if str(x.status or "").strip().lower() == "cancelled"]
        raise RuntimeError(f"Repair stopped because target bills are cancelled: {cancelled}")

    total = sum((Decimal(str(x.net_payable or 0)) for x in rows), Decimal("0.00"))
    if total.quantize(Decimal("0.01")) != EXPECTED_TOTAL:
        raise RuntimeError(
            f"SelectCityFly April repair stopped: target Net Payable total is {total}, "
            f"expected {EXPECTED_TOTAL}"
        )

    return rows


def _journal_credits_ledger(db, payable_id: str, ledger_id: str) -> bool:
    journal = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.source_type == "payable_bill",
            JournalEntry.source_id == payable_id,
        )
        .first()
    )
    if not journal:
        return False

    return (
        db.query(JournalLine)
        .filter(
            JournalLine.journal_entry_id == journal.id,
            JournalLine.ledger_id == ledger_id,
            JournalLine.credit > Decimal("0.00"),
        )
        .first()
        is not None
    )


def repair_selectcityfly_missing_bill_journals() -> dict:
    """Force the exact missing April bills onto the canonical SelectCityFly ledger.

    Safe to run repeatedly. If all 21 bills are already correctly linked and
    posted, it returns repairedCount=0.
    """
    db = SessionLocal()
    try:
        ledger = _canonical_ledger(db)
        vendor_id = _canonical_vendor_id(db, ledger)
        vendor = db.get(Vendor, vendor_id)
        if not vendor:
            raise RuntimeError(f"Canonical VendorID {vendor_id} not found")

        rows = _target_rows(db, ledger.llp_id)

        needs_repair = [
            p for p in rows
            if p.vendor_id != vendor_id
            or not _journal_credits_ledger(db, p.id, ledger.id)
        ]

        if not needs_repair:
            result = {
                "vendor": vendor.vendor_name,
                "ledgerCode": ledger.ledger_code,
                "targetBillCount": len(rows),
                "targetTotal": float(EXPECTED_TOTAL),
                "repairedCount": 0,
                "message": "All 21 April bills are already correctly linked to the canonical ledger.",
            }
            logger.warning("SelectCityFly repair v3: %s", result)
            return result

        connection = db.connection()

        # Normalize VendorID directly to avoid triggering LLPPayable after_update
        # payment synchronization.
        ids = [p.id for p in needs_repair]
        connection.execute(
            update(LLPPayable.__table__)
            .where(LLPPayable.__table__.c.id.in_(ids))
            .values(
                vendor_id=vendor_id,
                vendor_name=vendor.vendor_name,
            )
        )

        # Reload target rows with the canonical VendorID.
        db.expire_all()
        repaired_rows = (
            db.query(LLPPayable)
            .filter(LLPPayable.id.in_(ids))
            .order_by(LLPPayable.bill_date, LLPPayable.bill_no, LLPPayable.id)
            .all()
        )

        repaired = []
        for payable in repaired_rows:
            # Rebuild ONLY purchase/bill journal.
            ac._sync_payable_bill(connection, payable)
            db.flush()

            if not _journal_credits_ledger(db, payable.id, ledger.id):
                raise RuntimeError(
                    f"Bill {payable.bill_no} did not credit canonical ledger "
                    f"{ledger.ledger_code} after rebuild"
                )

            repaired.append(
                {
                    "BillNo": payable.bill_no,
                    "BillDate": payable.bill_date.isoformat() if payable.bill_date else "",
                    "NetPayable": float(payable.net_payable or 0),
                }
            )

        db.commit()

        repaired_total = sum(
            (Decimal(str(x["NetPayable"])) for x in repaired),
            Decimal("0.00"),
        ).quantize(Decimal("0.01"))

        result = {
            "vendor": vendor.vendor_name,
            "ledgerCode": ledger.ledger_code,
            "targetBillCount": len(rows),
            "targetTotal": float(EXPECTED_TOTAL),
            "repairedCount": len(repaired),
            "repairedTotal": float(repaired_total),
            "repairedBills": repaired,
            "message": "Canonical SelectCityFly April bill journals rebuilt successfully.",
        }
        logger.warning("SelectCityFly repair v3 COMPLETED: %s", result)
        return result

    except Exception:
        db.rollback()
        logger.exception("SelectCityFly repair v3 FAILED")
        raise
    finally:
        db.close()

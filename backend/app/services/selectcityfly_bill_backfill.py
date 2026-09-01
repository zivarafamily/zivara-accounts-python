"""SelectCityFly April-2026 vendor-ledger repair v4.

This version does not rely on the normal payable vendor-ledger resolver.
It directly rebuilds the exact 21 April Vendor Bill purchase journals against
the canonical selected ledger VEND2C876042DB.

Only payable_bill journals are deleted/recreated.
Bank transactions, payable payments and reimbursements are never touched.
"""

from __future__ import annotations

from decimal import Decimal
import json
import logging
import re

from sqlalchemy import select, update

from app.database import SessionLocal
from app.models import LLPPayable, Vendor
from app.models.ledger import JournalEntry, JournalLine, Ledger
from app.services import accounting_sync as ac


logger = logging.getLogger(__name__)

TARGET_LEDGER_CODE = "VEND2C876042DB"
TARGET_VENDOR_TOKEN = "selectcityflytourtravels"
EXPECTED_TOTAL = Decimal("600171.00")

EXPECTED_BILLS = [
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
]


def _d(value):
    return ac._d(value)


def _compact(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _items(payable):
    raw = getattr(payable, "line_items", None)
    if isinstance(raw, list):
        return raw
    try:
        data = json.loads(raw or "[]")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _roundoff(payable):
    items = _items(payable)
    if not items:
        return Decimal("0.00")
    return _d(items[0].get("RoundOffAmount", 0))


def _selected_ledger(connection, llp_id, ledger_id):
    if not ledger_id:
        return None
    row = connection.execute(
        select(Ledger.__table__.c.id).where(
            Ledger.__table__.c.id == ledger_id,
            Ledger.__table__.c.llp_id == llp_id,
        )
    ).first()
    return row[0] if row else None


def _roundoff_ledger(connection, llp_id):
    return ac._ensure_ledger(
        connection,
        llp_id=llp_id,
        system_key="roundoff",
        name="Round Off",
        group_name="Administrative Expenses",
        account_type="Expense",
        code="ROUNDOFF",
        opening_balance=0,
        opening_side="Dr",
        notes="System ledger for bill rounding differences.",
        adopt_same_name=True,
    )


def _canonical_ledger(db):
    rows = db.query(Ledger).filter(Ledger.ledger_code == TARGET_LEDGER_CODE).all()
    if len(rows) != 1:
        raise RuntimeError(
            f"Expected exactly one ledger with code {TARGET_LEDGER_CODE}; found {len(rows)}"
        )
    ledger = rows[0]
    if "accounts payable" not in str(ledger.group_name or "").lower():
        raise RuntimeError(
            f"{TARGET_LEDGER_CODE} is not an Accounts Payable ledger"
        )
    return ledger


def _canonical_vendor_id(db, ledger):
    key = str(ledger.system_key or "")
    if key.startswith("vendor:"):
        vendor_id = key.split(":", 1)[1]
        if db.get(Vendor, vendor_id):
            return vendor_id
    return ""


def _target_payables(db, ledger):
    rows = (
        db.query(LLPPayable)
        .filter(
            LLPPayable.llp_id == ledger.llp_id,
            LLPPayable.bill_no.in_(EXPECTED_BILLS),
        )
        .all()
    )
    by_bill = {}
    for row in rows:
        bill = str(row.bill_no or "").strip()
        if bill in by_bill:
            raise RuntimeError(f"Duplicate payable rows found for {bill}")
        by_bill[bill] = row

    missing = [bill for bill in EXPECTED_BILLS if bill not in by_bill]
    if missing:
        raise RuntimeError(f"Target Vendor Bills are missing from Payables table: {missing}")

    ordered = [by_bill[bill] for bill in EXPECTED_BILLS]
    wrong_vendor = [
        p.bill_no for p in ordered
        if TARGET_VENDOR_TOKEN not in _compact(p.vendor_name)
    ]
    if wrong_vendor:
        raise RuntimeError(
            f"Target bill numbers do not belong to SelectCityFly: {wrong_vendor}"
        )

    return ordered


def _write_bill_to_canonical_ledger(connection, payable, vendor_ledger_id):
    """Rebuild only the purchase journal for one payable."""

    source_type = "payable_bill"
    ac._delete_journal(connection, payable.llp_id, source_type, payable.id)

    if str(payable.status or "").strip().lower() == "cancelled":
        return

    gross = _d(payable.gross_amount)
    gst = _d(payable.gst_amount)
    tcs = _d(payable.tcs_amount)
    actual_tds = min(_d(payable.tds_deducted_amount), gross)
    vendor_credit = _d(payable.net_payable)

    items = _items(payable)
    lines = []
    taxable_from_items = Decimal("0.00")

    for item in items:
        taxable = _d(item.get("TaxableAmount") or item.get("taxable"))
        if taxable <= 0:
            continue

        taxable_from_items += taxable
        ledger_id = _selected_ledger(
            connection,
            payable.llp_id,
            item.get("LedgerID"),
        )
        if not ledger_id:
            ledger_id = ac._expense_ledger(
                connection,
                payable.llp_id,
                payable.expense_type,
                payable.vendor_category,
            )
        lines.append(
            (
                ledger_id,
                taxable,
                0,
                item.get("Particulars") or payable.description or payable.bill_no,
            )
        )

    if taxable_from_items <= 0:
        expense_component = max(gross - gst - tcs, Decimal("0.00"))
        expense_ledger = ac._expense_ledger(
            connection,
            payable.llp_id,
            payable.expense_type,
            payable.vendor_category,
        )
        lines.append(
            (
                expense_ledger,
                expense_component,
                0,
                payable.description or payable.bill_no,
            )
        )

    if gst > 0:
        gst_ledger = ac._tax_ledger(
            connection,
            payable.llp_id,
            "GSTINPUT",
            "GST Input",
            "Duties & Taxes",
            "Asset",
            "Dr",
        )
        lines.append((gst_ledger, gst, 0, "Input GST"))

    if tcs > 0:
        tcs_ledger = ac._tax_ledger(
            connection,
            payable.llp_id,
            "TCSREC",
            "TCS Receivable",
            "Duties & Taxes",
            "Asset",
            "Dr",
        )
        lines.append((tcs_ledger, tcs, 0, "TCS Receivable"))

    if actual_tds > 0:
        tds_ledger = ac._tax_ledger(
            connection,
            payable.llp_id,
            "TDSPAY",
            "TDS Payable",
            "Duties & Taxes",
            "Liability",
            "Cr",
        )
        lines.append((tds_ledger, 0, actual_tds, "TDS Payable"))

    ro = _roundoff(payable)
    if ro:
        roundoff_ledger = _roundoff_ledger(connection, payable.llp_id)
        if ro > 0:
            lines.append((roundoff_ledger, ro, 0, "Round Off"))
        else:
            lines.append((roundoff_ledger, 0, abs(ro), "Round Off"))

    # Force the liability credit to the ledger the user is actually viewing.
    lines.append(
        (
            vendor_ledger_id,
            0,
            vendor_credit,
            payable.vendor_name or "SelectCityFly",
        )
    )

    journal_id = ac._write_journal(
        connection,
        llp_id=payable.llp_id,
        entry_date=payable.bill_date,
        voucher_type="Purchase",
        voucher_no=payable.bill_no or payable.id,
        narration=payable.description or f"Vendor bill {payable.bill_no}",
        source_type=source_type,
        source_id=payable.id,
        lines=lines,
    )

    if not journal_id:
        debit_total = sum((_d(x[1]) for x in lines), Decimal("0.00"))
        credit_total = sum((_d(x[2]) for x in lines), Decimal("0.00"))
        raise RuntimeError(
            f"Could not write {payable.bill_no}: journal unbalanced "
            f"Dr={debit_total} Cr={credit_total}"
        )


def repair_selectcityfly_missing_bill_journals():
    db = SessionLocal()
    try:
        ledger = _canonical_ledger(db)
        payables = _target_payables(db, ledger)
        connection = db.connection()

        vendor_id = _canonical_vendor_id(db, ledger)

        # If the canonical ledger is linked to a Vendor master, also normalize the
        # old April Payables to that VendorID. Core UPDATE avoids ORM payment events.
        if vendor_id:
            ids = [p.id for p in payables]
            connection.execute(
                update(LLPPayable.__table__)
                .where(LLPPayable.__table__.c.id.in_(ids))
                .values(vendor_id=vendor_id)
            )
            db.expire_all()
            payables = _target_payables(db, ledger)

        # Force rebuild all 21 target purchase journals. This is idempotent because
        # _write_journal deletes the existing payable_bill journal for each source_id
        # before writing exactly one replacement.
        for payable in payables:
            _write_bill_to_canonical_ledger(connection, payable, ledger.id)

        db.flush()

        # Verify exact canonical-ledger credit for the 21 target journals.
        target_ids = [p.id for p in payables]
        journals = (
            db.query(JournalEntry)
            .filter(
                JournalEntry.llp_id == ledger.llp_id,
                JournalEntry.source_type == "payable_bill",
                JournalEntry.source_id.in_(target_ids),
            )
            .all()
        )
        journal_ids = [j.id for j in journals]

        credits = (
            db.query(JournalLine)
            .filter(
                JournalLine.journal_entry_id.in_(journal_ids),
                JournalLine.ledger_id == ledger.id,
                JournalLine.credit > Decimal("0.00"),
            )
            .all()
        )

        credit_total = sum(
            (Decimal(str(x.credit or 0)) for x in credits),
            Decimal("0.00"),
        ).quantize(Decimal("0.01"))

        if len(journals) != 21:
            raise RuntimeError(
                f"Expected 21 rebuilt payable_bill journals, found {len(journals)}"
            )
        if len(credits) != 21:
            raise RuntimeError(
                f"Expected 21 SelectCityFly credit lines, found {len(credits)}"
            )
        if credit_total != EXPECTED_TOTAL:
            raise RuntimeError(
                f"Rebuilt SelectCityFly April credits total {credit_total}; "
                f"expected {EXPECTED_TOTAL}"
            )

        db.commit()

        result = {
            "ok": True,
            "ledger": ledger.ledger_name,
            "ledgerCode": ledger.ledger_code,
            "repairedCount": 21,
            "repairedCreditTotal": float(credit_total),
            "billNumbers": EXPECTED_BILLS,
            "message": (
                "21 April SelectCityFly purchase journals were force-rebuilt "
                "against the canonical vendor ledger."
            ),
        }
        logger.warning("SELECTCITYFLY REPAIR V4 COMPLETED: %s", result)
        return result

    except Exception:
        db.rollback()
        logger.exception("SELECTCITYFLY REPAIR V4 FAILED")
        raise
    finally:
        db.close()

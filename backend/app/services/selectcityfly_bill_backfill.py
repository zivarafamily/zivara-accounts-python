"""SelectCityFly April-2026 vendor-ledger repair v6.

This version fixes the actual historical-data problem revealed by Reports >
Vendor Ledger:

Some April bills have TDSDeductedAmount > 0 even though TDSAmount == 0.
The Vendor Ledger report can still display those bills because it is built
directly from LLPPayable rows. Ledger Master cannot display a Vendor Bill until
a balanced JournalEntry/JournalLine exists.

V6 therefore:
- targets the exact 21 missing April SelectCityFly bills
- forces the liability line to canonical ledger VEND2C876042DB
- NEVER treats deducted TDS as greater than the bill's declared TDSAmount
- derives invoice round-off from NetPayable + TDSAmount - GrossAmount
- rebuilds only payable_bill purchase journals
- never creates/deletes bank transactions or payment metadata
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


def _d(v):
    return ac._d(v)


def _compact(v):
    return re.sub(r"[^a-z0-9]+", "", str(v or "").strip().lower())


def _items(payable):
    try:
        data = json.loads(payable.line_items or "[]")
        return data if isinstance(data, list) else []
    except Exception:
        return []


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
        notes="System ledger for invoice rounding differences.",
        adopt_same_name=True,
    )


def _canonical_ledger(db):
    rows = db.query(Ledger).filter(Ledger.ledger_code == TARGET_LEDGER_CODE).all()
    if len(rows) != 1:
        raise RuntimeError(
            f"Expected exactly one ledger {TARGET_LEDGER_CODE}; found {len(rows)}"
        )
    ledger = rows[0]
    if "accounts payable" not in str(ledger.group_name or "").lower():
        raise RuntimeError(f"{TARGET_LEDGER_CODE} is not Accounts Payable")
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
    for p in rows:
        bill = str(p.bill_no or "").strip()
        if bill in by_bill:
            raise RuntimeError(f"Duplicate payable row: {bill}")
        by_bill[bill] = p

    missing = [x for x in EXPECTED_BILLS if x not in by_bill]
    if missing:
        raise RuntimeError(f"Missing source payables: {missing}")

    ordered = [by_bill[x] for x in EXPECTED_BILLS]
    wrong = [p.bill_no for p in ordered if TARGET_VENDOR_TOKEN not in _compact(p.vendor_name)]
    if wrong:
        raise RuntimeError(f"Wrong vendor on target bill(s): {wrong}")

    total = sum((_d(p.net_payable) for p in ordered), Decimal("0.00")).quantize(Decimal("0.01"))
    if total != EXPECTED_TOTAL:
        raise RuntimeError(f"Target bills total {total}, expected {EXPECTED_TOTAL}")

    return ordered


def _build_lines(connection, p, vendor_ledger_id):
    gross = _d(p.gross_amount)
    gst = _d(p.gst_amount)
    tcs = _d(p.tcs_amount)
    declared_tds = max(_d(p.tds_amount), Decimal("0.00"))
    stale_deducted_tds = max(_d(p.tds_deducted_amount), Decimal("0.00"))

    # CRITICAL FIX:
    # deducted TDS can never exceed declared TDS.
    # Historical April rows show deducted TDS even when declared TDS is zero.
    actual_tds = min(stale_deducted_tds, declared_tds, gross)

    net = _d(p.net_payable)

    # Existing net-payable data is trusted because Reports > Vendor Ledger
    # reconciles correctly. Derive the invoice round-off from that truth.
    roundoff = (net + declared_tds - gross).quantize(Decimal("0.01"))

    if abs(roundoff) > Decimal("10.00"):
        raise RuntimeError(
            f"{p.bill_no}: derived round-off {roundoff} is unexpectedly large"
        )

    # If TDS was declared but not actually deducted yet, vendor liability is
    # correspondingly higher than NetPayable.
    vendor_credit = (net + declared_tds - actual_tds).quantize(Decimal("0.01"))

    lines = []
    items = _items(p)
    taxable_from_items = Decimal("0.00")

    for item in items:
        taxable = _d(item.get("TaxableAmount") or item.get("taxable"))
        if taxable <= 0:
            continue
        taxable_from_items += taxable
        ledger_id = _selected_ledger(connection, p.llp_id, item.get("LedgerID"))
        if not ledger_id:
            ledger_id = ac._expense_ledger(
                connection, p.llp_id, p.expense_type, p.vendor_category
            )
        lines.append(
            (
                ledger_id,
                taxable,
                Decimal("0.00"),
                item.get("Particulars") or p.description or p.bill_no,
            )
        )

    if taxable_from_items <= 0:
        expense_component = max(gross - gst - tcs, Decimal("0.00"))
        expense_ledger = ac._expense_ledger(
            connection, p.llp_id, p.expense_type, p.vendor_category
        )
        lines.append(
            (expense_ledger, expense_component, Decimal("0.00"), p.description or p.bill_no)
        )

    if gst > 0:
        gst_ledger = ac._tax_ledger(
            connection, p.llp_id, "GSTINPUT", "GST Input",
            "Duties & Taxes", "Asset", "Dr"
        )
        lines.append((gst_ledger, gst, Decimal("0.00"), "Input GST"))

    if tcs > 0:
        tcs_ledger = ac._tax_ledger(
            connection, p.llp_id, "TCSREC", "TCS Receivable",
            "Duties & Taxes", "Asset", "Dr"
        )
        lines.append((tcs_ledger, tcs, Decimal("0.00"), "TCS Receivable"))

    if actual_tds > 0:
        tds_ledger = ac._tax_ledger(
            connection, p.llp_id, "TDSPAY", "TDS Payable",
            "Duties & Taxes", "Liability", "Cr"
        )
        lines.append((tds_ledger, Decimal("0.00"), actual_tds, "TDS Payable"))

    if roundoff:
        rl = _roundoff_ledger(connection, p.llp_id)
        if roundoff > 0:
            lines.append((rl, roundoff, Decimal("0.00"), "Invoice Round Off"))
        else:
            lines.append((rl, Decimal("0.00"), abs(roundoff), "Invoice Round Off"))

    lines.append(
        (
            vendor_ledger_id,
            Decimal("0.00"),
            vendor_credit,
            p.vendor_name or "SelectCityFly",
        )
    )

    debit_total = sum((_d(x[1]) for x in lines), Decimal("0.00")).quantize(Decimal("0.01"))
    credit_total = sum((_d(x[2]) for x in lines), Decimal("0.00")).quantize(Decimal("0.01"))

    # If old line-item taxable values do not add back to Gross, use a small
    # balancing line only for genuine historical data differences.
    imbalance = (credit_total - debit_total).quantize(Decimal("0.01"))
    if imbalance:
        if abs(imbalance) > Decimal("10.00"):
            raise RuntimeError(
                f"{p.bill_no}: journal imbalance is {imbalance} "
                f"(Dr {debit_total} / Cr {credit_total})"
            )
        rl = _roundoff_ledger(connection, p.llp_id)
        if imbalance > 0:
            lines.append((rl, imbalance, Decimal("0.00"), "Historical Bill Adjustment"))
        else:
            lines.append((rl, Decimal("0.00"), abs(imbalance), "Historical Bill Adjustment"))

    debit_total = sum((_d(x[1]) for x in lines), Decimal("0.00")).quantize(Decimal("0.01"))
    credit_total = sum((_d(x[2]) for x in lines), Decimal("0.00")).quantize(Decimal("0.01"))
    if debit_total != credit_total:
        raise RuntimeError(
            f"{p.bill_no}: final journal not balanced: Dr {debit_total} / Cr {credit_total}"
        )

    return lines, actual_tds, roundoff, vendor_credit


def repair_selectcityfly_missing_bill_journals():
    db = SessionLocal()
    try:
        ledger = _canonical_ledger(db)
        payables = _target_payables(db, ledger)
        connection = db.connection()

        vendor_id = _canonical_vendor_id(db, ledger)
        if vendor_id:
            connection.execute(
                update(LLPPayable.__table__)
                .where(LLPPayable.__table__.c.id.in_([p.id for p in payables]))
                .values(vendor_id=vendor_id)
            )

        # Sanitize impossible historical TDS deducted values in source data.
        for p in payables:
            declared_tds = max(_d(p.tds_amount), Decimal("0.00"))
            deducted_tds = max(_d(p.tds_deducted_amount), Decimal("0.00"))
            safe_tds = min(deducted_tds, declared_tds)
            if safe_tds != deducted_tds:
                connection.execute(
                    update(LLPPayable.__table__)
                    .where(LLPPayable.__table__.c.id == p.id)
                    .values(tds_deducted_amount=safe_tds)
                )

        db.expire_all()
        payables = _target_payables(db, ledger)

        rebuilt = []
        for p in payables:
            ac._delete_journal(connection, p.llp_id, "payable_bill", p.id)
            lines, actual_tds, roundoff, vendor_credit = _build_lines(
                connection, p, ledger.id
            )
            jid = ac._write_journal(
                connection,
                llp_id=p.llp_id,
                entry_date=p.bill_date,
                voucher_type="Purchase",
                voucher_no=p.bill_no or p.id,
                narration=p.description or f"Vendor bill {p.bill_no}",
                source_type="payable_bill",
                source_id=p.id,
                lines=lines,
            )
            if not jid:
                raise RuntimeError(f"{p.bill_no}: journal writer returned no journal")
            rebuilt.append(
                {
                    "BillNo": p.bill_no,
                    "BillDate": p.bill_date.isoformat() if p.bill_date else "",
                    "NetPayable": float(_d(p.net_payable)),
                    "EffectiveTDS": float(actual_tds),
                    "DerivedRoundOff": float(roundoff),
                }
            )

        db.flush()

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
            raise RuntimeError(f"Expected 21 journals, found {len(journals)}")
        if len(credits) != 21:
            raise RuntimeError(f"Expected 21 vendor credits, found {len(credits)}")
        if credit_total != EXPECTED_TOTAL:
            raise RuntimeError(
                f"Vendor credits total {credit_total}, expected {EXPECTED_TOTAL}"
            )

        db.commit()

        result = {
            "ok": True,
            "ledger": ledger.ledger_name,
            "ledgerCode": ledger.ledger_code,
            "repairedCount": 21,
            "repairedCreditTotal": float(credit_total),
            "rebuilt": rebuilt,
            "message": (
                "SelectCityFly April bills rebuilt from Payables truth; "
                "impossible historical TDS-deducted values were sanitized."
            ),
        }
        logger.warning("SELECTCITYFLY REPAIR V6 COMPLETED: %s", result)
        return result

    except Exception:
        db.rollback()
        logger.exception("SELECTCITYFLY REPAIR V6 FAILED")
        raise
    finally:
        db.close()

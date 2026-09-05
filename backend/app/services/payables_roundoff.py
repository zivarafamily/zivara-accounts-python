"""Payables form v3 accounting compatibility.

Keeps line-level expense posting and invoice round-off support, while separating
TDS PAYABLE from TDS PAID / FILED.

Important rule:
- p.tds_amount = TDS payable on the invoice.
- p.tds_deducted_amount = TDS explicitly marked paid/filed in Payment Tracker.
- Vendor liability is reduced only by TDS explicitly marked paid/filed.

This fixes a prior imbalance where a bill with TDS payable but TDS not yet
marked paid/filed could lose its purchase journal entirely.

Neo Invoice and Neo Revenue are intentionally untouched.
"""
import json
from decimal import Decimal

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.models import LLPPayable
from app.models.ledger import Ledger
from app.services import accounting_sync as ac


def _d(v):
    try:
        return Decimal(str(v or 0))
    except Exception:
        return Decimal("0.00")


def _items(p):
    try:
        data = json.loads(p.line_items or "[]")
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _roundoff(p):
    items = _items(p)
    if not items:
        return Decimal("0.00")
    return _d(items[0].get("RoundOffAmount", 0))


def _status(net, paid, current):
    if str(current or "") == "Cancelled":
        return "Cancelled"
    if paid > net + Decimal("0.005"):
        return "Overpaid"
    if paid >= net - Decimal("0.005") and net > 0:
        return "Paid"
    if paid > 0:
        return "Part Paid"
    return "Pending"


@event.listens_for(Session, "before_flush")
def payable_roundoff_before_flush(session, flush_context, instances):
    for p in set(session.new).union(session.dirty):
        if not isinstance(p, LLPPayable):
            continue
        # NetPayable remains the commercial net after declared TDS.
        net = max(
            _d(p.gross_amount) - _d(p.tds_amount) + _roundoff(p),
            Decimal("0.00"),
        )
        p.net_payable = net
        p.status = _status(net, _d(p.paid_amount), p.status)


def _selected_ledger(connection, llp_id, ledger_id):
    if not ledger_id:
        return None
    row = connection.execute(
        select(Ledger.__table__).where(
            Ledger.__table__.c.id == ledger_id,
            Ledger.__table__.c.llp_id == llp_id,
        )
    ).mappings().first()
    return row["id"] if row else None


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


def _totals(lines):
    debit = sum((ac._d(x[1]) for x in lines), Decimal("0.00"))
    credit = sum((ac._d(x[2]) for x in lines), Decimal("0.00"))
    return debit.quantize(Decimal("0.01")), credit.quantize(Decimal("0.01"))


def sync_payable_bill_v3(connection, p):
    source_type = "payable_bill"
    if p.status == "Cancelled" or not ac._eligible(p.bill_date):
        ac._delete_journal(connection, p.llp_id, source_type, p.id)
        return

    gross = ac._d(p.gross_amount)
    gst = ac._d(p.gst_amount)
    tcs = ac._d(p.tcs_amount)
    declared_tds = max(ac._d(p.tds_amount), Decimal("0.00"))
    marked_paid_tds = max(ac._d(p.tds_deducted_amount), Decimal("0.00"))

    # Only TDS explicitly marked paid/filed reduces the vendor liability.
    actual_tds = min(marked_paid_tds, declared_tds, gross)

    # NetPayable is gross - declared TDS +/- round-off. Add back the unpaid TDS
    # portion so the vendor ledger still carries that liability until the user
    # explicitly marks TDS paid/filed.
    net = ac._d(p.net_payable)
    vendor_credit = max(net + declared_tds - actual_tds, Decimal("0.00"))

    vendor_ledger = ac._payable_vendor_ledger(connection, p)
    items = _items(p)

    lines = []
    taxable_from_items = Decimal("0.00")
    for item in items:
        taxable = ac._d(item.get("TaxableAmount") or item.get("taxable"))
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
                0,
                item.get("Particulars") or p.description or p.bill_no,
            )
        )

    if taxable_from_items <= 0:
        expense_component = max(gross - gst - tcs, Decimal("0.00"))
        expense_ledger = ac._expense_ledger(
            connection, p.llp_id, p.expense_type, p.vendor_category
        )
        lines.append((expense_ledger, expense_component, 0, p.description or p.bill_no))

    if gst > 0:
        gst_ledger = ac._tax_ledger(
            connection,
            p.llp_id,
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
            p.llp_id,
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
            p.llp_id,
            "TDSPAY",
            "TDS Payable",
            "Duties & Taxes",
            "Liability",
            "Cr",
        )
        lines.append((tds_ledger, 0, actual_tds, "TDS Payable"))

    ro = _roundoff(p)
    if ro:
        rl = _roundoff_ledger(connection, p.llp_id)
        if ro > 0:
            lines.append((rl, ro, 0, "Round Off"))
        else:
            lines.append((rl, 0, abs(ro), "Round Off"))

    lines.append((vendor_ledger, 0, vendor_credit, p.vendor_name))

    # Historical line-item data can occasionally differ by a few paise/rupees
    # from stored bill totals. Never silently drop a bill journal because of a
    # small source-data difference; balance it through the existing Round Off
    # ledger. Large differences remain blocked for safety.
    debit_total, credit_total = _totals(lines)
    imbalance = (credit_total - debit_total).quantize(Decimal("0.01"))
    if imbalance:
        if abs(imbalance) > Decimal("10.00"):
            # Leave the source row untouched; the repair log will surface this.
            return None
        rl = _roundoff_ledger(connection, p.llp_id)
        if imbalance > 0:
            lines.append((rl, imbalance, 0, "Historical Bill Adjustment"))
        else:
            lines.append((rl, 0, abs(imbalance), "Historical Bill Adjustment"))

    return ac._write_journal(
        connection,
        llp_id=p.llp_id,
        entry_date=p.bill_date,
        voucher_type="Purchase",
        voucher_no=p.bill_no or p.id,
        narration=p.description or f"Vendor bill {p.bill_no}",
        source_type=source_type,
        source_id=p.id,
        lines=lines,
    )


# Existing accounting event handlers resolve this global function at runtime.
ac._sync_payable_bill = sync_payable_bill_v3

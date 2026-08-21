"""Accounting-only bridge for NEW Neo invoices.

Safety goals:
- Does not modify NeoInvoice or NeoRevenue data.
- Does not back-post existing/historical Neo invoices.
- Only invoices CREATED after this module is deployed are marked for accounting.
- Draft / Proforma / Cancelled invoices have no financial journal.
- Sent / Paid regular invoices create/update:
    Dr Neo Wealth Receivable
       Cr Neo Wealth Revenue
       Cr GST Output (where applicable)

Expected TDS is deliberately NOT posted at invoice creation.
TDS should be recognized when the receipt is recorded:
    Dr Bank
    Dr TDS Receivable
       Cr Neo Wealth Receivable

No schema migration is required.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import uuid

from sqlalchemy import delete, event, select
from sqlalchemy.engine import Connection

from app.models import NeoInvoice
from app.models.ledger import JournalEntry, JournalLine
from app.services import accounting_sync as ac

ACCOUNTING_START_DATE = date(2026, 4, 1)
SOURCE_TYPE = "neo_invoice"
MARKER_SOURCE_TYPE = "neo_invoice_accounting_marker"


def _utcnow():
    return datetime.now(timezone.utc)


def _d(value) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0.00")


def _eligible_invoice(inv: NeoInvoice) -> bool:
    if not inv.llp_id or not inv.invoice_date:
        return False
    if inv.invoice_date < ACCOUNTING_START_DATE:
        return False
    if bool(inv.is_proforma):
        return False
    return str(inv.status or "").strip() in {"Sent", "Paid"}


def _has_marker(connection: Connection, invoice_id: str) -> bool:
    return connection.execute(
        select(JournalEntry.__table__.c.id).where(
            JournalEntry.__table__.c.source_type == MARKER_SOURCE_TYPE,
            JournalEntry.__table__.c.source_id == invoice_id,
        ).limit(1)
    ).first() is not None


def _create_marker(connection: Connection, inv: NeoInvoice):
    if _has_marker(connection, inv.id) or not inv.llp_id:
        return
    connection.execute(
        JournalEntry.__table__.insert().values(
            id=f"JRN-{uuid.uuid4().hex[:24].upper()}",
            llp_id=inv.llp_id,
            entry_date=inv.invoice_date,
            voucher_type="System Marker",
            voucher_no=str(inv.invoice_no or inv.id)[:80],
            narration="Neo invoice accounting marker - no financial effect",
            source_type=MARKER_SOURCE_TYPE,
            source_id=inv.id,
            created_by="system",
            created_at=_utcnow(),
        )
    )


def _delete_marker(connection: Connection, inv: NeoInvoice):
    rows = connection.execute(
        select(JournalEntry.__table__.c.id).where(
            JournalEntry.__table__.c.source_type == MARKER_SOURCE_TYPE,
            JournalEntry.__table__.c.source_id == inv.id,
        )
    ).all()
    ids = [r.id for r in rows]
    if ids:
        connection.execute(delete(JournalLine.__table__).where(JournalLine.__table__.c.journal_entry_id.in_(ids)))
        connection.execute(delete(JournalEntry.__table__).where(JournalEntry.__table__.c.id.in_(ids)))


def _receivable_ledger(connection: Connection, llp_id: str) -> str:
    return ac._ensure_ledger(
        connection,
        llp_id=llp_id,
        system_key="neo:receivable",
        name="Neo Wealth Receivable",
        group_name="Accounts Receivable",
        account_type="Asset",
        code="NEOAR",
        opening_balance=0,
        opening_side="Dr",
        notes="System receivable ledger for Neo Wealth invoices.",
        adopt_same_name=True,
    )


def _revenue_ledger(connection: Connection, llp_id: str) -> str:
    return ac._ensure_ledger(
        connection,
        llp_id=llp_id,
        system_key="neo:revenue",
        name="Neo Wealth Revenue",
        group_name="Income",
        account_type="Income",
        code="NEOREV",
        opening_balance=0,
        opening_side="Cr",
        notes="System income ledger for Neo Wealth invoices.",
        adopt_same_name=True,
    )


def _gst_output_ledger(connection: Connection, llp_id: str, kind: str) -> str:
    safe = str(kind or "GST").upper()
    return ac._ensure_ledger(
        connection,
        llp_id=llp_id,
        system_key=f"neo:gst-output:{safe.lower()}",
        name=f"GST Output - {safe}",
        group_name="Duties & Taxes",
        account_type="Liability",
        code=f"GSTOUT{safe}",
        opening_balance=0,
        opening_side="Cr",
        notes=f"System output GST ledger for Neo invoices ({safe}).",
        adopt_same_name=True,
    )


def _sync_invoice_journal(connection: Connection, inv: NeoInvoice):
    # Existing invoices never get picked up merely because the service starts.
    # Only invoices carrying our post-deployment marker are managed here.
    if not _has_marker(connection, inv.id):
        return

    if not _eligible_invoice(inv):
        if inv.llp_id:
            ac._delete_journal(connection, inv.llp_id, SOURCE_TYPE, inv.id)
        return

    total = _d(inv.amount)
    gst = max(_d(inv.gst_amount), Decimal("0.00"))
    if total <= 0:
        total = _d(inv.taxable_amount) + gst
    if total <= 0:
        ac._delete_journal(connection, inv.llp_id, SOURCE_TYPE, inv.id)
        return

    revenue = max(total - gst, Decimal("0.00"))
    receivable = _receivable_ledger(connection, inv.llp_id)
    revenue_ledger = _revenue_ledger(connection, inv.llp_id)
    narration = inv.narration or inv.particulars or f"Neo Wealth invoice {inv.invoice_no or inv.id}"

    lines = [
        (receivable, total, 0, inv.buyer_name or "Neo Wealth"),
        (revenue_ledger, 0, revenue, inv.particulars or "Neo Wealth Revenue"),
    ]

    if gst > 0:
        gst_type = str(inv.gst_type or "IGST").strip().upper()
        if "CGST" in gst_type and "SGST" in gst_type:
            cgst = (gst / Decimal("2")).quantize(Decimal("0.01"))
            sgst = gst - cgst
            lines.append((_gst_output_ledger(connection, inv.llp_id, "CGST"), 0, cgst, "Output CGST"))
            lines.append((_gst_output_ledger(connection, inv.llp_id, "SGST"), 0, sgst, "Output SGST"))
        else:
            lines.append((_gst_output_ledger(connection, inv.llp_id, "IGST"), 0, gst, "Output IGST"))

    ac._write_journal(
        connection,
        llp_id=inv.llp_id,
        entry_date=inv.invoice_date,
        voucher_type="Sales",
        voucher_no=inv.invoice_no or inv.id,
        narration=narration,
        source_type=SOURCE_TYPE,
        source_id=inv.id,
        lines=lines,
    )


@event.listens_for(NeoInvoice, "after_insert")
def neo_invoice_after_insert(mapper, connection, target):
    _create_marker(connection, target)
    _sync_invoice_journal(connection, target)


@event.listens_for(NeoInvoice, "after_update")
def neo_invoice_after_update(mapper, connection, target):
    _sync_invoice_journal(connection, target)


@event.listens_for(NeoInvoice, "after_delete")
def neo_invoice_after_delete(mapper, connection, target):
    if target.llp_id:
        ac._delete_journal(connection, target.llp_id, SOURCE_TYPE, target.id)
    _delete_marker(connection, target)

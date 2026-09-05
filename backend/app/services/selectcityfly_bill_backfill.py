"""SelectCityFly vendor-ledger repair v7.

Repairs ALL active SelectCityFly Vendor Bill purchase journals from current
LLPPayable source truth.

Rules:
- TDSAmount remains the invoice TDS payable.
- TDSDeductedAmount is treated as paid/filed ONLY when Payment Tracker contains
  an explicit [[TDS_PAYMENT_V1:...]] marker. Otherwise it is reset to zero for
  SelectCityFly so old automatic vendor-payment logic cannot falsely mark TDS
  paid/filed.
- Vendor payment fields and bank transactions are never changed.
- Every active SelectCityFly bill gets one balanced payable_bill journal.
"""
from __future__ import annotations

from decimal import Decimal
import json
import logging
import re

from sqlalchemy import select

from app.database import SessionLocal
from app.models import LLPPayable, Vendor
from app.models.ledger import JournalEntry, JournalLine, Ledger
from app.services import accounting_sync as ac

logger = logging.getLogger(__name__)

TARGET_VENDOR_TOKEN = "selectcityflytourtravels"
TDS_PAYMENT_META_PREFIX = "[[TDS_PAYMENT_V1:"
META_SUFFIX = "]]"


def _compact(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _read_tds_meta(notes):
    text = str(notes or "")
    start = text.find(TDS_PAYMENT_META_PREFIX)
    if start < 0:
        return None
    end = text.find(META_SUFFIX, start + len(TDS_PAYMENT_META_PREFIX))
    if end < 0:
        return None
    try:
        return json.loads(text[start + len(TDS_PAYMENT_META_PREFIX):end])
    except Exception:
        return None


def _explicit_paid_filed_tds(p):
    meta = _read_tds_meta(p.notes)
    if not meta:
        return Decimal("0.00")
    declared = max(ac._d(p.tds_amount), Decimal("0.00"))
    explicit = max(ac._d(meta.get("billPaidFiled")), Decimal("0.00"))
    return min(explicit, declared)


def _canonical_vendor(db, llp_id):
    matches = [
        v for v in db.query(Vendor).filter(Vendor.llp_id == llp_id).all()
        if TARGET_VENDOR_TOKEN in _compact(v.vendor_name)
    ]
    return matches[0] if len(matches) == 1 else None


def repair_selectcityfly_missing_bill_journals():
    db = SessionLocal()
    try:
        payables = [
            p for p in db.query(LLPPayable).all()
            if p.bill_date
            and ac._eligible(p.bill_date)
            and str(p.status or "") != "Cancelled"
            and TARGET_VENDOR_TOKEN in _compact(p.vendor_name)
        ]
        if not payables:
            return {"ok": True, "repairedCount": 0, "message": "No SelectCityFly payables found"}

        llp_ids = sorted({p.llp_id for p in payables if p.llp_id})
        if len(llp_ids) != 1:
            raise RuntimeError(f"Expected one LLP for SelectCityFly; found {llp_ids}")

        vendor = _canonical_vendor(db, llp_ids[0])
        connection = db.connection()

        # Restore explicit-only TDS-paid/filed state and canonical VendorID.
        for p in payables:
            explicit = _explicit_paid_filed_tds(p)
            p.tds_deducted_amount = explicit
            if vendor:
                p.vendor_id = vendor.id

        db.flush()

        rebuilt = []
        for p in payables:
            jid = ac._sync_payable_bill(connection, p)
            if not jid:
                # ac._sync_payable_bill may return None after already writing on
                # some versions; verify existence before treating as a failure.
                existing = connection.execute(
                    select(JournalEntry.__table__.c.id).where(
                        JournalEntry.__table__.c.llp_id == p.llp_id,
                        JournalEntry.__table__.c.source_type == "payable_bill",
                        JournalEntry.__table__.c.source_id == p.id,
                    )
                ).first()
                if not existing:
                    raise RuntimeError(f"{p.bill_no}: payable bill journal was not created")
            rebuilt.append(p.bill_no)

        db.flush()

        ids = [p.id for p in payables]
        journals = db.query(JournalEntry).filter(
            JournalEntry.llp_id == llp_ids[0],
            JournalEntry.source_type == "payable_bill",
            JournalEntry.source_id.in_(ids),
        ).all()
        if len(journals) != len(payables):
            raise RuntimeError(
                f"SelectCityFly source has {len(payables)} active bills but ledger has {len(journals)} payable_bill journals"
            )

        # Validate every rebuilt journal balances.
        for j in journals:
            lines = db.query(JournalLine).filter(JournalLine.journal_entry_id == j.id).all()
            dr = sum((ac._d(x.debit) for x in lines), Decimal("0.00"))
            cr = sum((ac._d(x.credit) for x in lines), Decimal("0.00"))
            if dr.quantize(Decimal("0.01")) != cr.quantize(Decimal("0.01")):
                raise RuntimeError(f"Unbalanced journal after repair: {j.voucher_no} Dr {dr} Cr {cr}")

        db.commit()
        result = {
            "ok": True,
            "repairedCount": len(payables),
            "bills": rebuilt,
            "message": (
                "All active SelectCityFly Vendor Bill journals rebuilt. "
                "TDS paid/filed preserved only when explicitly marked in Payment Tracker. "
                "Bank transactions and vendor payment metadata were untouched."
            ),
        }
        logger.warning("SELECTCITYFLY REPAIR V7 COMPLETED: %s", result)
        return result
    except Exception:
        db.rollback()
        logger.exception("SELECTCITYFLY REPAIR V7 FAILED")
        raise
    finally:
        db.close()

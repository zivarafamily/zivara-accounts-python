"""Targeted, idempotent repair for missing SelectCityFly Vendor Bill journals.

Why this exists
---------------
The SelectCityFly vendor ledger contains the bank settlements, but some older
Vendor Bills (April 2026) were created before those bill journals were posted
to Ledger/Journal.

This repair:
- scans only SelectCityFly Vendor Bills dated on/after 01-Apr-2026
- checks for an existing JournalEntry with source_type="payable_bill"
- creates ONLY the missing bill journal
- never syncs / recreates payments, bank transactions or reimbursements
- is safe to run on every startup because existing payable_bill journals are skipped

The actual journal posting is delegated to accounting_sync._sync_payable_bill.
Because payables_roundoff is imported before this repair is run, the active
round-off / selected-line-ledger accounting implementation is respected.
"""

from __future__ import annotations

from datetime import date
import logging
import re

from sqlalchemy import select

from app.database import SessionLocal
from app.models import LLPPayable
from app.models.ledger import JournalEntry
from app.services import accounting_sync as ac


logger = logging.getLogger(__name__)

ACCOUNTING_START = date(2026, 4, 1)
TARGET_VENDOR_TOKEN = "selectcityflytourtravels"


def _compact(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def _is_selectcityfly(payable: LLPPayable) -> bool:
    return TARGET_VENDOR_TOKEN in _compact(payable.vendor_name)


def repair_selectcityfly_missing_bill_journals() -> dict:
    """Backfill missing SelectCityFly payable_bill journals only.

    Returns a small diagnostic dictionary for Render logs.
    Running the function again should produce repairedCount=0 once complete.
    """
    db = SessionLocal()
    try:
        candidates = [
            p
            for p in (
                db.query(LLPPayable)
                .filter(LLPPayable.bill_date >= ACCOUNTING_START)
                .order_by(LLPPayable.bill_date, LLPPayable.bill_no, LLPPayable.id)
                .all()
            )
            if str(p.status or "").strip().lower() != "cancelled"
            and _is_selectcityfly(p)
        ]

        if not candidates:
            result = {
                "vendor": "SelectCityFly",
                "candidateCount": 0,
                "missingCount": 0,
                "repairedCount": 0,
                "repairedBills": [],
            }
            logger.info("SelectCityFly bill-journal repair: %s", result)
            return result

        ids = [p.id for p in candidates]
        existing_ids = {
            row[0]
            for row in (
                db.query(JournalEntry.source_id)
                .filter(
                    JournalEntry.source_type == "payable_bill",
                    JournalEntry.source_id.in_(ids),
                )
                .all()
            )
        }

        missing = [p for p in candidates if p.id not in existing_ids]
        repaired = []
        connection = db.connection()

        for payable in missing:
            # IMPORTANT: bill journal only. Do NOT call ac._sync_payable(),
            # because that would also touch payments/reimbursements.
            ac._sync_payable_bill(connection, payable)

            created = connection.execute(
                select(JournalEntry.__table__.c.id).where(
                    JournalEntry.__table__.c.llp_id == payable.llp_id,
                    JournalEntry.__table__.c.source_type == "payable_bill",
                    JournalEntry.__table__.c.source_id == payable.id,
                )
            ).first()

            if created:
                repaired.append(
                    {
                        "PayableID": payable.id,
                        "BillNo": payable.bill_no or "",
                        "BillDate": payable.bill_date.isoformat() if payable.bill_date else "",
                        "Vendor": payable.vendor_name or "",
                        "NetPayable": float(payable.net_payable or 0),
                    }
                )

        db.commit()

        result = {
            "vendor": "SelectCityFly",
            "candidateCount": len(candidates),
            "missingCount": len(missing),
            "repairedCount": len(repaired),
            "repairedBills": repaired,
        }
        logger.info("SelectCityFly bill-journal repair completed: %s", result)
        return result

    except Exception:
        db.rollback()
        logger.exception("SelectCityFly bill-journal repair failed")
        raise
    finally:
        db.close()

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_llp_id, require_roles
from app.models import User
from app.models.ledger import JournalEntry, JournalLine, Ledger
from app.services.common import audit, dec, iso, make_id, money, parse_date


router = APIRouter(prefix="/manual-journals", tags=["manual-journals"])


def _require_manual_journal(db: Session, llp_id: str, journal_id: str) -> JournalEntry:
    item = db.get(JournalEntry, journal_id)
    if not item or item.llp_id != llp_id:
        raise HTTPException(status_code=404, detail="Journal not found")
    if str(item.source_type or "").strip().lower() != "manual":
        raise HTTPException(
            status_code=409,
            detail="Only manual journals can be edited or deleted here. Change system-generated entries from their originating module.",
        )
    return item


def _validate_lines(db: Session, llp_id: str, lines: list[dict]):
    if len(lines) < 2:
        raise HTTPException(status_code=400, detail="A journal entry needs at least two lines")

    total_debit = sum(dec(line.get("Debit")) for line in lines)
    total_credit = sum(dec(line.get("Credit")) for line in lines)

    if total_debit <= 0 or total_credit <= 0 or total_debit != total_credit:
        raise HTTPException(
            status_code=400,
            detail="Journal debit and credit totals must be equal and greater than zero",
        )

    for line in lines:
        ledger = db.get(Ledger, line.get("LedgerID"))
        if not ledger or ledger.llp_id != llp_id:
            raise HTTPException(status_code=400, detail="Invalid ledger selected")

        debit = dec(line.get("Debit"))
        credit = dec(line.get("Credit"))

        if debit < 0 or credit < 0:
            raise HTTPException(status_code=400, detail="Debit and credit cannot be negative")
        if debit > 0 and credit > 0:
            raise HTTPException(
                status_code=400,
                detail="A journal line cannot contain both debit and credit",
            )
        if debit <= 0 and credit <= 0:
            raise HTTPException(
                status_code=400,
                detail="Each journal line must contain a debit or credit amount",
            )

    return total_debit, total_credit


def _journal_dict(db: Session, item: JournalEntry, include_lines: bool = False):
    lines = (
        db.query(JournalLine)
        .filter(JournalLine.journal_entry_id == item.id)
        .order_by(JournalLine.id)
        .all()
    )

    total_debit = sum(dec(line.debit) for line in lines)
    total_credit = sum(dec(line.credit) for line in lines)

    result = {
        "JournalID": item.id,
        "Date": iso(item.entry_date),
        "VoucherType": item.voucher_type,
        "VoucherNo": item.voucher_no or "",
        "Narration": item.narration or "",
        "SourceType": item.source_type or "",
        "SourceID": item.source_id or "",
        "CreatedBy": item.created_by or "",
        "CreatedAt": iso(item.created_at),
        "TotalDebit": money(total_debit),
        "TotalCredit": money(total_credit),
        "Editable": str(item.source_type or "").strip().lower() == "manual",
    }

    if include_lines:
        result["Lines"] = []
        for line in lines:
            ledger = db.get(Ledger, line.ledger_id)
            result["Lines"].append({
                "LineID": line.id,
                "LedgerID": line.ledger_id,
                "LedgerName": ledger.ledger_name if ledger else "",
                "Debit": money(line.debit),
                "Credit": money(line.credit),
                "Particulars": line.particulars or "",
            })

    return result


@router.get("")
def list_manual_journals(
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    _: User = Depends(require_roles("super_admin", "admin", "managing_partner")),
):
    rows = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.llp_id == llp_id,
            JournalEntry.source_type == "manual",
        )
        .order_by(
            JournalEntry.entry_date.desc(),
            JournalEntry.created_at.desc(),
            JournalEntry.id.desc(),
        )
        .all()
    )
    return {"ok": True, "data": [_journal_dict(db, item) for item in rows]}


@router.get("/{journal_id}")
def get_manual_journal(
    journal_id: str,
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    _: User = Depends(require_roles("super_admin", "admin", "managing_partner")),
):
    item = _require_manual_journal(db, llp_id, journal_id)
    return {"ok": True, "data": _journal_dict(db, item, include_lines=True)}


@router.put("/{journal_id}")
def update_manual_journal(
    journal_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(require_roles("super_admin", "admin", "managing_partner")),
):
    item = _require_manual_journal(db, llp_id, journal_id)
    lines = payload.get("Lines") or payload.get("lines") or []
    _validate_lines(db, llp_id, lines)

    item.entry_date = parse_date(payload.get("Date"))
    item.voucher_type = payload.get("VoucherType") or "Journal"
    item.voucher_no = payload.get("VoucherNo") or ""
    item.narration = payload.get("Narration") or ""

    db.query(JournalLine).filter(
        JournalLine.journal_entry_id == item.id
    ).delete(synchronize_session=False)

    for line in lines:
        db.add(JournalLine(
            id=make_id("JLN"),
            journal_entry_id=item.id,
            ledger_id=line["LedgerID"],
            debit=dec(line.get("Debit")),
            credit=dec(line.get("Credit")),
            particulars=line.get("Particulars") or item.narration or "",
        ))

    audit(db, user.email, "journal", "update", item.id)
    db.commit()
    return {"ok": True, "data": _journal_dict(db, item, include_lines=True)}


@router.delete("/{journal_id}")
def delete_manual_journal(
    journal_id: str,
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(require_roles("super_admin", "admin", "managing_partner")),
):
    item = _require_manual_journal(db, llp_id, journal_id)

    db.query(JournalLine).filter(
        JournalLine.journal_entry_id == item.id
    ).delete(synchronize_session=False)

    db.delete(item)
    audit(db, user.email, "journal", "delete", journal_id)
    db.commit()
    return {"ok": True}

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user, get_llp_id, require_llp_id, require_roles
from app.models import BankAccount, CashBookEntry, User
from app.models.ledger import JournalEntry, JournalLine, Ledger
from app.services.common import audit, dec, iso, make_id, money, parse_date


router = APIRouter(tags=["ledger"])


DEFAULT_LEDGERS = [
    ("CASH", "Cash in Hand", "Cash & Bank", "Asset", "cash"),
    ("BANKCHG", "Bank Charges", "Administrative Expenses", "Expense", ""),
    ("OFFEXP", "Office Expenses", "Administrative Expenses", "Expense", ""),
    ("PROFEE", "Professional Fees", "Administrative Expenses", "Expense", ""),
    ("RENT", "Rent", "Administrative Expenses", "Expense", ""),
    ("SALARY", "Salary", "Employee Costs", "Expense", ""),
    ("TRAVEL", "Travel Expenses", "Administrative Expenses", "Expense", ""),
    ("AR", "Accounts Receivable", "Current Assets", "Asset", ""),
    ("AP", "Accounts Payable", "Current Liabilities", "Liability", ""),
    ("GSTIN", "GST Input", "Duties & Taxes", "Asset", ""),
    ("GSTOUT", "GST Output", "Duties & Taxes", "Liability", ""),
    ("TDSREC", "TDS Receivable", "Duties & Taxes", "Asset", ""),
    ("TDSPAY", "TDS Payable", "Duties & Taxes", "Liability", ""),
    ("CAPITAL", "Partner Capital", "Capital", "Equity", ""),
    ("PARTCUR", "Partner Current Account", "Capital", "Equity", ""),
    ("OTHINC", "Other Income", "Other Income", "Income", ""),
    ("OTHEXP", "Other Expenses", "Other Expenses", "Expense", ""),
]


def _ledger_dict(row: Ledger):
    return {
        "LedgerID": row.id,
        "LLPID": row.llp_id,
        "LedgerCode": row.ledger_code,
        "LedgerName": row.ledger_name,
        "GroupName": row.group_name,
        "AccountType": row.account_type,
        "OpeningBalance": money(row.opening_balance),
        "OpeningSide": row.opening_side,
        "Status": row.status,
        "Notes": row.notes,
        "SystemKey": row.system_key,
        "CreatedAt": iso(row.created_at),
        "UpdatedAt": iso(row.updated_at),
    }


def _unique_code(db: Session, llp_id: str, requested: str, exclude_id: str = ""):
    base = "".join(ch for ch in (requested or "LEDGER").upper() if ch.isalnum())[:20] or "LEDGER"
    candidate = base
    index = 2
    while db.query(Ledger).filter(
        Ledger.llp_id == llp_id,
        Ledger.ledger_code == candidate,
        Ledger.id != exclude_id,
    ).first():
        suffix = str(index)
        candidate = f"{base[:20-len(suffix)]}{suffix}"
        index += 1
    return candidate


def _ensure_ledger(
    db: Session,
    llp_id: str,
    name: str,
    group_name: str,
    account_type: str,
    system_key: str,
    opening_balance=Decimal("0.00"),
    opening_side="Dr",
):
    item = db.query(Ledger).filter(Ledger.llp_id == llp_id, Ledger.system_key == system_key).first()
    if item:
        return item
    item = db.query(Ledger).filter(Ledger.llp_id == llp_id, Ledger.ledger_name == name).first()
    if item:
        if not item.system_key:
            item.system_key = system_key
        return item
    item = Ledger(
        id=make_id("LED"),
        llp_id=llp_id,
        ledger_code=_unique_code(db, llp_id, system_key or name),
        ledger_name=name,
        group_name=group_name,
        account_type=account_type,
        opening_balance=dec(opening_balance),
        opening_side=opening_side if opening_side in {"Dr", "Cr"} else "Dr",
        status="Active",
        notes="",
        system_key=system_key,
    )
    db.add(item)
    db.flush()
    return item


def _source_ledger(db: Session, llp_id: str, cash: CashBookEntry):
    bank = db.get(BankAccount, cash.paid_by) if cash.paid_by else None
    if bank:
        return _ensure_ledger(
            db,
            llp_id,
            f"Bank - {bank.account_name}",
            "Cash & Bank",
            "Asset",
            f"bank:{bank.id}",
            opening_balance=bank.opening_balance,
            opening_side="Dr",
        )
    return _ensure_ledger(db, llp_id, "Cash in Hand", "Cash & Bank", "Asset", "cash")


def _delete_source_journal(db: Session, llp_id: str, source_type: str, source_id: str):
    old = db.query(JournalEntry).filter(
        JournalEntry.llp_id == llp_id,
        JournalEntry.source_type == source_type,
        JournalEntry.source_id == source_id,
    ).first()
    if not old:
        return
    db.query(JournalLine).filter(JournalLine.journal_entry_id == old.id).delete(synchronize_session=False)
    db.delete(old)
    db.flush()


def _save_journal(db: Session, llp_id: str, user_email: str, payload: dict):
    lines = payload.get("Lines") or payload.get("lines") or []
    if len(lines) < 2:
        raise HTTPException(status_code=400, detail="A journal entry needs at least two lines")

    total_debit = sum(dec(line.get("Debit")) for line in lines)
    total_credit = sum(dec(line.get("Credit")) for line in lines)
    if total_debit <= 0 or total_credit <= 0 or total_debit != total_credit:
        raise HTTPException(status_code=400, detail="Journal debit and credit totals must be equal and greater than zero")

    for line in lines:
        ledger = db.get(Ledger, line.get("LedgerID"))
        if not ledger or ledger.llp_id != llp_id:
            raise HTTPException(status_code=400, detail="Invalid ledger selected")
        if dec(line.get("Debit")) > 0 and dec(line.get("Credit")) > 0:
            raise HTTPException(status_code=400, detail="A journal line cannot contain both debit and credit")

    item = JournalEntry(
        id=payload.get("JournalID") or make_id("JRN"),
        llp_id=llp_id,
        entry_date=parse_date(payload.get("Date")),
        voucher_type=payload.get("VoucherType") or "Journal",
        voucher_no=payload.get("VoucherNo") or "",
        narration=payload.get("Narration") or "",
        source_type=payload.get("SourceType") or "manual",
        source_id=payload.get("SourceID") or "",
        created_by=user_email,
    )
    db.add(item)
    db.flush()

    for line in lines:
        db.add(JournalLine(
            id=make_id("JLN"),
            journal_entry_id=item.id,
            ledger_id=line["LedgerID"],
            debit=dec(line.get("Debit")),
            credit=dec(line.get("Credit")),
            particulars=line.get("Particulars") or payload.get("Narration") or "",
        ))
    db.flush()
    return item


@router.get("/ledgers")
def list_ledgers(
    db: Session = Depends(get_db),
    llp_id: str | None = Depends(get_llp_id),
    _: User = Depends(current_user),
):
    q = db.query(Ledger)
    if llp_id:
        q = q.filter(Ledger.llp_id == llp_id)
    return {"ok": True, "data": [_ledger_dict(x) for x in q.order_by(Ledger.group_name, Ledger.ledger_name).all()]}


@router.post("/ledgers/seed-defaults")
def seed_default_ledgers(
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(require_roles("super_admin", "admin", "managing_partner")),
):
    created_before = db.query(Ledger).filter(Ledger.llp_id == llp_id).count()
    for code, name, group_name, account_type, system_key in DEFAULT_LEDGERS:
        existing = db.query(Ledger).filter(Ledger.llp_id == llp_id, Ledger.ledger_name == name).first()
        if existing:
            continue
        db.add(Ledger(
            id=make_id("LED"),
            llp_id=llp_id,
            ledger_code=_unique_code(db, llp_id, code),
            ledger_name=name,
            group_name=group_name,
            account_type=account_type,
            opening_balance=Decimal("0.00"),
            opening_side="Dr",
            status="Active",
            notes="",
            system_key=system_key,
        ))
        db.flush()
    audit(db, user.email, "ledgers", "seed-defaults", llp_id)
    db.commit()
    return {"ok": True, "created": db.query(Ledger).filter(Ledger.llp_id == llp_id).count() - created_before}


@router.post("/ledgers")
def add_ledger(
    payload: dict,
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(require_roles("super_admin", "admin", "managing_partner")),
):
    name = str(payload.get("LedgerName") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Ledger Name is required")
    if db.query(Ledger).filter(Ledger.llp_id == llp_id, Ledger.ledger_name == name).first():
        raise HTTPException(status_code=409, detail="Ledger name already exists")
    item = Ledger(
        id=payload.get("LedgerID") or make_id("LED"),
        llp_id=llp_id,
        ledger_code=_unique_code(db, llp_id, payload.get("LedgerCode") or name),
        ledger_name=name,
        group_name=payload.get("GroupName") or "Other",
        account_type=payload.get("AccountType") or "Asset",
        opening_balance=dec(payload.get("OpeningBalance")),
        opening_side=payload.get("OpeningSide") if payload.get("OpeningSide") in {"Dr", "Cr"} else "Dr",
        status=payload.get("Status") or "Active",
        notes=payload.get("Notes") or "",
        system_key="",
    )
    db.add(item)
    audit(db, user.email, "ledgers", "create", item.id)
    db.commit()
    return {"ok": True, "data": _ledger_dict(item)}


@router.put("/ledgers/{ledger_id}")
def update_ledger(
    ledger_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("super_admin", "admin", "managing_partner")),
):
    item = db.get(Ledger, ledger_id)
    if not item:
        raise HTTPException(status_code=404, detail="Ledger not found")
    if "LedgerName" in payload:
        name = str(payload.get("LedgerName") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Ledger Name is required")
        dup = db.query(Ledger).filter(Ledger.llp_id == item.llp_id, Ledger.ledger_name == name, Ledger.id != ledger_id).first()
        if dup:
            raise HTTPException(status_code=409, detail="Ledger name already exists")
        item.ledger_name = name
    if "LedgerCode" in payload:
        item.ledger_code = _unique_code(db, item.llp_id, payload.get("LedgerCode") or item.ledger_code, ledger_id)
    if "GroupName" in payload:
        item.group_name = payload.get("GroupName") or "Other"
    if "AccountType" in payload:
        item.account_type = payload.get("AccountType") or item.account_type
    if "OpeningBalance" in payload:
        item.opening_balance = dec(payload.get("OpeningBalance"))
    if "OpeningSide" in payload:
        item.opening_side = payload.get("OpeningSide") if payload.get("OpeningSide") in {"Dr", "Cr"} else item.opening_side
    if "Status" in payload:
        item.status = payload.get("Status") or item.status
    if "Notes" in payload:
        item.notes = payload.get("Notes") or ""
    audit(db, user.email, "ledgers", "update", item.id)
    db.commit()
    return {"ok": True, "data": _ledger_dict(item)}


@router.delete("/ledgers/{ledger_id}")
def delete_ledger(
    ledger_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("super_admin", "admin", "managing_partner")),
):
    item = db.get(Ledger, ledger_id)
    if not item:
        raise HTTPException(status_code=404, detail="Ledger not found")
    if item.system_key:
        raise HTTPException(status_code=409, detail="System ledger cannot be deleted")
    if db.query(JournalLine).filter(JournalLine.ledger_id == ledger_id).first():
        raise HTTPException(status_code=409, detail="Ledger has journal transactions and cannot be deleted")
    db.delete(item)
    audit(db, user.email, "ledgers", "delete", ledger_id)
    db.commit()
    return {"ok": True}


@router.get("/ledger-journal")
def ledger_statement(
    ledger_id: str = "",
    db: Session = Depends(get_db),
    llp_id: str | None = Depends(get_llp_id),
    _: User = Depends(current_user),
):
    if not ledger_id:
        raise HTTPException(status_code=400, detail="ledger_id is required")
    ledger = db.get(Ledger, ledger_id)
    if not ledger or (llp_id and ledger.llp_id != llp_id):
        raise HTTPException(status_code=404, detail="Ledger not found")

    rows = (
        db.query(JournalLine, JournalEntry)
        .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
        .filter(JournalLine.ledger_id == ledger_id)
        .order_by(JournalEntry.entry_date, JournalEntry.created_at, JournalEntry.id)
        .all()
    )

    running = dec(ledger.opening_balance) * (Decimal("1") if ledger.opening_side == "Dr" else Decimal("-1"))
    data = []
    for line, entry in rows:
        running += dec(line.debit) - dec(line.credit)
        data.append({
            "JournalID": entry.id,
            "Date": iso(entry.entry_date),
            "VoucherType": entry.voucher_type,
            "VoucherNo": entry.voucher_no,
            "Narration": entry.narration,
            "SourceType": entry.source_type,
            "SourceID": entry.source_id,
            "Debit": money(line.debit),
            "Credit": money(line.credit),
            "Particulars": line.particulars,
            "RunningBalance": money(abs(running)),
            "BalanceSide": "Dr" if running >= 0 else "Cr",
        })
    return {"ok": True, "ledger": _ledger_dict(ledger), "data": data}


@router.post("/ledger-journal")
def add_manual_journal(
    payload: dict,
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(require_roles("super_admin", "admin", "managing_partner")),
):
    item = _save_journal(db, llp_id, user.email, payload)
    audit(db, user.email, "journal", "create", item.id)
    db.commit()
    return {"ok": True, "JournalID": item.id}


@router.post("/ledger-post-cash")
def post_cash_to_ledger(
    payload: dict,
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(current_user),
):
    entry_id = payload.get("EntryID")
    counter_ledger_id = payload.get("LedgerID")
    cash = db.get(CashBookEntry, entry_id)
    if not cash or cash.llp_id != llp_id:
        raise HTTPException(status_code=404, detail="Bank/Cash transaction not found")
    counter = db.get(Ledger, counter_ledger_id)
    if not counter or counter.llp_id != llp_id:
        raise HTTPException(status_code=400, detail="Select a valid ledger")

    source = _source_ledger(db, llp_id, cash)
    amount_in = dec(cash.amount_in)
    amount_out = dec(cash.amount_out)
    if amount_in <= 0 and amount_out <= 0:
        raise HTTPException(status_code=400, detail="Transaction has no amount")

    _delete_source_journal(db, llp_id, "cash_book", cash.id)

    if amount_in > 0:
        lines = [
            {"LedgerID": source.id, "Debit": amount_in, "Credit": 0, "Particulars": cash.description},
            {"LedgerID": counter.id, "Debit": 0, "Credit": amount_in, "Particulars": cash.description},
        ]
    else:
        lines = [
            {"LedgerID": counter.id, "Debit": amount_out, "Credit": 0, "Particulars": cash.description},
            {"LedgerID": source.id, "Debit": 0, "Credit": amount_out, "Particulars": cash.description},
        ]

    journal = _save_journal(db, llp_id, user.email, {
        "Date": iso(cash.entry_date),
        "VoucherType": "Bank" if source.system_key.startswith("bank:") else "Cash",
        "VoucherNo": cash.reference_id or cash.id,
        "Narration": cash.description,
        "SourceType": "cash_book",
        "SourceID": cash.id,
        "Lines": lines,
    })
    audit(db, user.email, "journal", "post-cash", journal.id)
    db.commit()
    return {"ok": True, "JournalID": journal.id, "LedgerID": counter.id}


def _bank_transaction_dict(db: Session, cash: CashBookEntry):
    bank = db.get(BankAccount, cash.paid_by) if cash.paid_by else None
    journal = db.query(JournalEntry).filter(
        JournalEntry.llp_id == cash.llp_id,
        JournalEntry.source_type == "cash_book",
        JournalEntry.source_id == cash.id,
    ).first()

    ledger_id = ""
    ledger_name = ""
    if journal:
        lines = db.query(JournalLine).filter(
            JournalLine.journal_entry_id == journal.id
        ).all()
        source_key = f"bank:{bank.id}" if bank else "cash"
        for line in lines:
            ledger = db.get(Ledger, line.ledger_id)
            if ledger and ledger.system_key != source_key:
                ledger_id = ledger.id
                ledger_name = ledger.ledger_name
                break

    return {
        "EntryID": cash.id,
        "LLPID": cash.llp_id,
        "Date": iso(cash.entry_date),
        "Type": cash.entry_type,
        "OpeningBalance": money(cash.opening_balance),
        "AmountIn": money(cash.amount_in),
        "AmountOut": money(cash.amount_out),
        "ClosingBalance": money(cash.closing_balance),
        "ReferenceType": cash.reference_type,
        "ReferenceID": cash.reference_id,
        "Description": cash.description,
        "BankAccountID": bank.id if bank else "",
        "BankAccountName": bank.account_name if bank else "",
        "BankName": bank.bank_name if bank else "",
        "LedgerID": ledger_id,
        "LedgerName": ledger_name,
        "JournalID": journal.id if journal else "",
    }


def _recalculate_bank_ledger_balance(db: Session, bank: BankAccount):
    rows = db.query(CashBookEntry).filter(
        CashBookEntry.llp_id == bank.llp_id,
        CashBookEntry.paid_by == bank.id,
    ).order_by(
        CashBookEntry.entry_date,
        CashBookEntry.created_at,
        CashBookEntry.id,
    ).all()

    balance = dec(bank.opening_balance)
    for row in rows:
        row.opening_balance = balance
        balance = balance + dec(row.amount_in) - dec(row.amount_out)
        row.closing_balance = balance

    bank.current_balance = balance


def _post_cash_journal(
    db: Session,
    cash: CashBookEntry,
    counter: Ledger,
    user_email: str,
):
    source = _source_ledger(db, cash.llp_id, cash)

    amount_in = dec(cash.amount_in)
    amount_out = dec(cash.amount_out)

    if amount_in <= 0 and amount_out <= 0:
        raise HTTPException(status_code=400, detail="Transaction has no amount")

    _delete_source_journal(
        db,
        cash.llp_id,
        "cash_book",
        cash.id,
    )

    if amount_in > 0:
        lines = [
            {
                "LedgerID": source.id,
                "Debit": amount_in,
                "Credit": 0,
                "Particulars": cash.description,
            },
            {
                "LedgerID": counter.id,
                "Debit": 0,
                "Credit": amount_in,
                "Particulars": cash.description,
            },
        ]
    else:
        lines = [
            {
                "LedgerID": counter.id,
                "Debit": amount_out,
                "Credit": 0,
                "Particulars": cash.description,
            },
            {
                "LedgerID": source.id,
                "Debit": 0,
                "Credit": amount_out,
                "Particulars": cash.description,
            },
        ]

    return _save_journal(
        db,
        cash.llp_id,
        user_email,
        {
            "Date": iso(cash.entry_date),
            "VoucherType": (
                "Bank"
                if source.system_key.startswith("bank:")
                else "Cash"
            ),
            "VoucherNo": cash.reference_id or cash.id,
            "Narration": cash.description,
            "SourceType": "cash_book",
            "SourceID": cash.id,
            "Lines": lines,
        },
    )


@router.get("/bank-transactions")
def bank_transactions(
    bank_account_id: str = "",
    db: Session = Depends(get_db),
    llp_id: str | None = Depends(get_llp_id),
    _: User = Depends(current_user),
):
    q = db.query(CashBookEntry)

    if llp_id:
        q = q.filter(CashBookEntry.llp_id == llp_id)

    if bank_account_id:
        bank = db.get(BankAccount, bank_account_id)
        if not bank or (llp_id and bank.llp_id != llp_id):
            raise HTTPException(
                status_code=404,
                detail="Bank account not found",
            )
        q = q.filter(CashBookEntry.paid_by == bank_account_id)
    else:
        bank_ids = [
            row.id
            for row in (
                db.query(BankAccount)
                .filter(BankAccount.llp_id == llp_id)
                .all()
                if llp_id
                else db.query(BankAccount).all()
            )
        ]
        if not bank_ids:
            return {"ok": True, "data": []}
        q = q.filter(CashBookEntry.paid_by.in_(bank_ids))

    rows = q.order_by(
        CashBookEntry.entry_date.desc(),
        CashBookEntry.created_at.desc(),
    ).all()

    return {
        "ok": True,
        "data": [
            _bank_transaction_dict(db, row)
            for row in rows
        ],
    }


@router.put("/bank-transactions/{entry_id}")
def update_bank_transaction(
    entry_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(current_user),
):
    cash = db.get(CashBookEntry, entry_id)
    if not cash or cash.llp_id != llp_id:
        raise HTTPException(
            status_code=404,
            detail="Bank transaction not found",
        )

    old_bank = (
        db.get(BankAccount, cash.paid_by)
        if cash.paid_by
        else None
    )

    bank_id = payload.get("BankAccountID") or cash.paid_by
    bank = db.get(BankAccount, bank_id) if bank_id else None

    if not bank or bank.llp_id != llp_id:
        raise HTTPException(
            status_code=400,
            detail="Select a valid bank account",
        )

    counter = db.get(Ledger, payload.get("LedgerID"))
    if not counter or counter.llp_id != llp_id:
        raise HTTPException(
            status_code=400,
            detail="Select a valid ledger",
        )

    amount_in = dec(payload.get("AmountIn"))
    amount_out = dec(payload.get("AmountOut"))

    if amount_in <= 0 and amount_out <= 0:
        raise HTTPException(
            status_code=400,
            detail="Enter either Amount In or Amount Out",
        )
    if amount_in > 0 and amount_out > 0:
        raise HTTPException(
            status_code=400,
            detail="Use either Amount In or Amount Out, not both",
        )

    cash.entry_date = parse_date(payload.get("Date"))
    cash.entry_type = payload.get("Type") or "Payment"
    cash.amount_in = amount_in
    cash.amount_out = amount_out
    cash.reference_type = payload.get("ReferenceType") or "Manual"
    cash.reference_id = payload.get("ReferenceID") or ""
    cash.description = payload.get("Description") or ""
    cash.paid_by = bank.id

    db.flush()

    if old_bank:
        _recalculate_bank_ledger_balance(db, old_bank)

    if not old_bank or old_bank.id != bank.id:
        _recalculate_bank_ledger_balance(db, bank)
    else:
        _recalculate_bank_ledger_balance(db, bank)

    journal = _post_cash_journal(
        db,
        cash,
        counter,
        user.email,
    )

    audit(
        db,
        user.email,
        "banktransactions",
        "update",
        cash.id,
    )
    db.commit()

    return {
        "ok": True,
        "data": _bank_transaction_dict(db, cash),
        "JournalID": journal.id,
    }


@router.delete("/bank-transactions/{entry_id}")
def delete_bank_transaction(
    entry_id: str,
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(require_roles(
        "super_admin",
        "admin",
        "managing_partner",
    )),
):
    cash = db.get(CashBookEntry, entry_id)

    if not cash or cash.llp_id != llp_id:
        raise HTTPException(
            status_code=404,
            detail="Bank transaction not found",
        )

    bank = (
        db.get(BankAccount, cash.paid_by)
        if cash.paid_by
        else None
    )

    _delete_source_journal(
        db,
        cash.llp_id,
        "cash_book",
        cash.id,
    )

    db.delete(cash)
    db.flush()

    if bank:
        _recalculate_bank_ledger_balance(db, bank)

    audit(
        db,
        user.email,
        "banktransactions",
        "delete",
        entry_id,
    )
    db.commit()

    return {
        "ok": True,
        "message": "Bank transaction deleted",
    }

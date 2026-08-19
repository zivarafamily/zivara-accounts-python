"""Final accounting integration for Zivara Accounts.

Accounting scope only. This module deliberately does NOT import or modify
NeoInvoice or NeoRevenue.

Accounting start date: 01-Apr-2026.
Existing master data is synchronized at startup, but old Payables / Expenses
are NOT back-posted. Future inserts/updates dated on/after 01-Apr-2026 are
synchronized automatically.

Connections:
- BankAccount -> Bank system Ledger
- Vendor -> Vendor / Accounts Payable system Ledger
- Partner -> Partner Current Account system Ledger
- LLPPayable -> Bill journal + payment transaction/journal + reimbursement
- Expense -> Approved expense journal + reimbursement transaction/journal
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import re
import uuid

from sqlalchemy import and_, delete, event, or_, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import (
    BankAccount,
    CashBookEntry,
    Expense,
    LLPPayable,
    Partner,
    Vendor,
)
from app.models.ledger import JournalEntry, JournalLine, Ledger


ACCOUNTING_START_DATE = date(2026, 4, 1)

GENERATED_REFERENCE_TYPES = {
    "Payable Payment",
    "Payable Reimbursement",
    "Expense Reimbursement",
}


def _utcnow():
    return datetime.now(timezone.utc)


def _d(value) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal("0.00")


def _eligible(value) -> bool:
    if not value:
        return False
    if isinstance(value, datetime):
        value = value.date()
    return value >= ACCOUNTING_START_DATE


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")[:80]


def _clean_code(value: str, fallback="LEDGER") -> str:
    result = re.sub(r"[^A-Za-z0-9]", "", str(value or "").upper())[:32]
    return result or fallback


def _unique_code(connection, llp_id: str, preferred: str) -> str:
    table = Ledger.__table__
    base = _clean_code(preferred)
    candidate = base
    i = 2
    while connection.execute(
        select(table.c.id).where(
            table.c.llp_id == llp_id,
            table.c.ledger_code == candidate,
        )
    ).first():
        suffix = str(i)
        candidate = f"{base[:40-len(suffix)]}{suffix}"
        i += 1
    return candidate[:40]


def _unique_name(connection, llp_id: str, preferred: str, exclude_id: str = "") -> str:
    table = Ledger.__table__
    base = str(preferred or "Ledger").strip()[:240] or "Ledger"
    candidate = base
    i = 2
    while connection.execute(
        select(table.c.id).where(
            table.c.llp_id == llp_id,
            table.c.ledger_name == candidate,
            table.c.id != exclude_id,
        )
    ).first():
        suffix = f" ({i})"
        candidate = f"{base[:255-len(suffix)]}{suffix}"
        i += 1
    return candidate[:255]


def _ledger_has_history(connection, ledger_id: str) -> bool:
    return connection.execute(
        select(JournalLine.__table__.c.id)
        .where(JournalLine.__table__.c.ledger_id == ledger_id)
        .limit(1)
    ).first() is not None


def _ensure_ledger(
    connection,
    *,
    llp_id: str,
    system_key: str,
    name: str,
    group_name: str,
    account_type: str,
    code: str,
    opening_balance=None,
    opening_side=None,
    status="Active",
    notes="",
    adopt_same_name=False,
    sync_opening=False,
):
    table = Ledger.__table__

    existing = connection.execute(
        select(table).where(
            table.c.llp_id == llp_id,
            table.c.system_key == system_key,
        )
    ).mappings().first()

    if existing:
        safe_name = _unique_name(connection, llp_id, name, existing["id"])
        values = {
            "ledger_name": safe_name,
            "group_name": group_name,
            "account_type": account_type,
            "status": status,
            "notes": notes,
            "updated_at": _utcnow(),
        }
        if sync_opening and opening_balance is not None:
            values["opening_balance"] = _d(opening_balance)
        if sync_opening and opening_side:
            values["opening_side"] = opening_side
        connection.execute(
            update(table).where(table.c.id == existing["id"]).values(**values)
        )
        return existing["id"]

    if adopt_same_name:
        manual = connection.execute(
            select(table).where(
                table.c.llp_id == llp_id,
                table.c.ledger_name == name[:255],
                table.c.system_key == "",
            )
        ).mappings().first()
        if manual and not _ledger_has_history(connection, manual["id"]):
            values = {
                "group_name": group_name,
                "account_type": account_type,
                "status": status,
                "notes": notes,
                "system_key": system_key,
                "updated_at": _utcnow(),
            }
            if opening_balance is not None:
                values["opening_balance"] = _d(opening_balance)
            if opening_side:
                values["opening_side"] = opening_side
            connection.execute(
                update(table).where(table.c.id == manual["id"]).values(**values)
            )
            return manual["id"]

    ledger_id = f"LED-{uuid.uuid4().hex[:24].upper()}"
    ledger_code = _unique_code(connection, llp_id, code)
    ledger_name = _unique_name(connection, llp_id, name)

    connection.execute(
        table.insert().values(
            id=ledger_id,
            llp_id=llp_id,
            ledger_code=ledger_code,
            ledger_name=ledger_name,
            group_name=group_name,
            account_type=account_type,
            opening_balance=_d(opening_balance),
            opening_side=opening_side or "Dr",
            status=status,
            notes=notes,
            system_key=system_key,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
    )
    return ledger_id


def _delete_journal(connection, llp_id: str, source_type: str, source_id: str):
    e = JournalEntry.__table__
    l = JournalLine.__table__
    ids = [
        row.id
        for row in connection.execute(
            select(e.c.id).where(
                e.c.llp_id == llp_id,
                e.c.source_type == source_type,
                e.c.source_id == source_id,
            )
        ).all()
    ]
    if ids:
        connection.execute(delete(l).where(l.c.journal_entry_id.in_(ids)))
        connection.execute(delete(e).where(e.c.id.in_(ids)))


def _write_journal(
    connection,
    *,
    llp_id: str,
    entry_date,
    voucher_type: str,
    voucher_no: str,
    narration: str,
    source_type: str,
    source_id: str,
    lines,
):
    _delete_journal(connection, llp_id, source_type, source_id)

    clean = []
    for ledger_id, debit, credit, particulars in lines:
        debit = _d(debit)
        credit = _d(credit)
        if debit == 0 and credit == 0:
            continue
        clean.append((ledger_id, debit, credit, particulars or narration))

    if not clean:
        return None

    total_debit = sum((x[1] for x in clean), Decimal("0"))
    total_credit = sum((x[2] for x in clean), Decimal("0"))
    if total_debit != total_credit:
        # Never write an unbalanced journal.
        return None

    journal_id = f"JRN-{uuid.uuid4().hex[:24].upper()}"
    JournalEntry.__table__
    connection.execute(
        JournalEntry.__table__.insert().values(
            id=journal_id,
            llp_id=llp_id,
            entry_date=entry_date,
            voucher_type=voucher_type,
            voucher_no=str(voucher_no or "")[:80],
            narration=narration or "",
            source_type=source_type,
            source_id=source_id,
            created_by="system",
            created_at=_utcnow(),
        )
    )

    for ledger_id, debit, credit, particulars in clean:
        connection.execute(
            JournalLine.__table__.insert().values(
                id=f"JLN-{uuid.uuid4().hex[:24].upper()}",
                journal_entry_id=journal_id,
                ledger_id=ledger_id,
                debit=debit,
                credit=credit,
                particulars=particulars or "",
            )
        )
    return journal_id


# ---------------------------------------------------------------------------
# Master ledgers
# ---------------------------------------------------------------------------

def _bank_ledger(connection, bank) -> str:
    amount = _d(bank.opening_balance)
    side = "Cr" if amount < 0 else "Dr"
    amount = abs(amount)
    account_no = re.sub(r"\s+", "", str(bank.account_number or ""))
    suffix = account_no[-4:] if account_no else str(bank.id)[-6:]
    return _ensure_ledger(
        connection,
        llp_id=bank.llp_id,
        system_key=f"bank:{bank.id}",
        name=f"Bank - {bank.account_name or bank.bank_name} ({suffix})",
        group_name="Cash & Bank",
        account_type="Asset",
        code=f"BANK{str(bank.id)[-10:]}",
        opening_balance=amount,
        opening_side=side,
        status="Active" if bank.is_active else "Inactive",
        notes="System-linked bank ledger. Manage bank details from Bank A/C.",
        sync_opening=True,
    )


def _vendor_ledger(connection, vendor) -> str | None:
    if not vendor or not vendor.llp_id:
        return None
    return _ensure_ledger(
        connection,
        llp_id=vendor.llp_id,
        system_key=f"vendor:{vendor.id}",
        name=vendor.vendor_name or "Vendor",
        group_name="Accounts Payable",
        account_type="Liability",
        code=f"VEND{str(vendor.id)[-10:]}",
        opening_balance=0,
        opening_side="Cr",
        status="Active" if str(vendor.status or "Active").lower() == "active" else "Inactive",
        notes="System-linked vendor ledger. Manage PAN/GSTIN/category from Vendors.",
        adopt_same_name=True,
    )


def _partner_ledger(connection, partner) -> str | None:
    if not partner or not partner.llp_id:
        return None
    return _ensure_ledger(
        connection,
        llp_id=partner.llp_id,
        system_key=f"partner:{partner.id}",
        name=partner.partner_name or "Partner",
        group_name="Partner Current Accounts",
        account_type="Liability",
        code=f"PART{str(partner.id)[-10:]}",
        opening_balance=0,
        opening_side="Cr",
        status="Active" if str(partner.status or "Active").lower() == "active" else "Inactive",
        notes="System-linked Partner Current Account.",
        adopt_same_name=True,
    )


def _cash_ledger(connection, llp_id):
    return _ensure_ledger(
        connection,
        llp_id=llp_id,
        system_key="cash",
        name="Cash in Hand",
        group_name="Cash & Bank",
        account_type="Asset",
        code="CASH",
        opening_balance=0,
        opening_side="Dr",
        notes="System cash ledger.",
        adopt_same_name=True,
    )


def _tax_ledger(connection, llp_id, key, name, group, account_type, side):
    return _ensure_ledger(
        connection,
        llp_id=llp_id,
        system_key=f"tax:{key}",
        name=name,
        group_name=group,
        account_type=account_type,
        code=key.upper(),
        opening_balance=0,
        opening_side=side,
        notes="System tax ledger.",
        adopt_same_name=True,
    )


def _clearing_ledger(connection, llp_id):
    return _ensure_ledger(
        connection,
        llp_id=llp_id,
        system_key="clearing:bank-payment",
        name="Bank Payment Clearing",
        group_name="Cash & Bank",
        account_type="Asset",
        code="BANKCLEAR",
        opening_balance=0,
        opening_side="Dr",
        notes="Used only when a payment has no resolvable bank account. Clear it through Transactions.",
        adopt_same_name=True,
    )


def _person_ledger(connection, llp_id: str, name: str):
    name = str(name or "").strip()
    if not name:
        name = "Unallocated Reimbursement"

    partner_table = Partner.__table__
    partner = connection.execute(
        select(partner_table).where(
            partner_table.c.llp_id == llp_id,
            partner_table.c.partner_name == name,
        )
    ).mappings().first()

    if partner:
        class Obj: pass
        obj = Obj()
        for k, v in partner.items():
            setattr(obj, k, v)
        return _partner_ledger(connection, obj)

    return _ensure_ledger(
        connection,
        llp_id=llp_id,
        system_key=f"person:{_slug(name)}",
        name=name,
        group_name="Other Current Liabilities",
        account_type="Liability",
        code=f"PERS{_clean_code(name)}",
        opening_balance=0,
        opening_side="Cr",
        notes="System liability ledger for personal payment / reimbursement.",
        adopt_same_name=True,
    )


EXPENSE_LEDGER_MAP = {
    "travel agency": ("Travel Expenses", "Administrative Expenses", "Expense"),
    "travel": ("Travel Expenses", "Administrative Expenses", "Expense"),
    "hotel": ("Hotel Expenses", "Administrative Expenses", "Expense"),
    "food": ("Food Expenses", "Administrative Expenses", "Expense"),
    "office": ("Office Expenses", "Administrative Expenses", "Expense"),
    "office purchase": ("Office Expenses", "Administrative Expenses", "Expense"),
    "ca / professional": ("Professional Fees", "Administrative Expenses", "Expense"),
    "consultant": ("Consultancy Expenses", "Administrative Expenses", "Expense"),
    "contractor": ("Contractor Expenses", "Administrative Expenses", "Expense"),
    "software": ("Software Expenses", "Administrative Expenses", "Expense"),
    "rent": ("Rent", "Administrative Expenses", "Expense"),
    "salaryadvance": ("Staff Advances", "Current Assets", "Asset"),
    "salary advance": ("Staff Advances", "Current Assets", "Asset"),
    "salary": ("Salary", "Employee Costs", "Expense"),
}


def _expense_ledger(connection, llp_id: str, expense_type: str, category: str):
    candidates = [str(expense_type or "").strip().lower(), str(category or "").strip().lower()]
    chosen = None
    for candidate in candidates:
        if candidate in EXPENSE_LEDGER_MAP:
            chosen = EXPENSE_LEDGER_MAP[candidate]
            break

    if not chosen:
        raw = str(expense_type or category or "Other").strip()
        if raw.lower() in {"", "vendor bill", "vendor", "misc"}:
            raw = str(category or "Other").strip() or "Other"
        name = raw if "expense" in raw.lower() or raw.lower() in {"rent", "salary"} else f"{raw} Expenses"
        chosen = (name, "Other Expenses", "Expense")

    name, group, account_type = chosen
    return _ensure_ledger(
        connection,
        llp_id=llp_id,
        system_key=f"expense:{_slug(name)}",
        name=name,
        group_name=group,
        account_type=account_type,
        code=f"EXP{_clean_code(name)}",
        opening_balance=0,
        opening_side="Dr",
        notes="System expense/advance ledger generated from accounting transactions.",
        adopt_same_name=True,
    )


# ---------------------------------------------------------------------------
# Bank / cash transaction helpers
# ---------------------------------------------------------------------------

def _bank_row(connection, llp_id: str, value: str = ""):
    table = BankAccount.__table__
    value = str(value or "").strip()

    if value:
        row = connection.execute(
            select(table).where(
                table.c.llp_id == llp_id,
                or_(
                    table.c.id == value,
                    table.c.account_name == value,
                    table.c.bank_name == value,
                    table.c.account_number == value,
                ),
            )
        ).mappings().first()
        if row:
            return row

    active = connection.execute(
        select(table).where(
            table.c.llp_id == llp_id,
            table.c.is_active == True,  # noqa: E712
        )
    ).mappings().all()
    return active[0] if len(active) == 1 else None


def _bank_ledger_from_row(connection, row):
    if not row:
        return None
    class Obj: pass
    obj = Obj()
    for k, v in row.items():
        setattr(obj, k, v)
    return _bank_ledger(connection, obj)


def _recalc_bank(connection, bank_id: str):
    if not bank_id:
        return
    bank_table = BankAccount.__table__
    cash_table = CashBookEntry.__table__

    bank = connection.execute(
        select(bank_table).where(bank_table.c.id == bank_id)
    ).mappings().first()
    if not bank:
        return

    balance = _d(bank["opening_balance"])
    entries = connection.execute(
        select(cash_table).where(
            cash_table.c.llp_id == bank["llp_id"],
            cash_table.c.paid_by == bank_id,
        ).order_by(
            cash_table.c.entry_date,
            cash_table.c.created_at,
            cash_table.c.id,
        )
    ).mappings().all()

    for entry in entries:
        opening = balance
        balance = opening + _d(entry["amount_in"]) - _d(entry["amount_out"])
        connection.execute(
            update(cash_table)
            .where(cash_table.c.id == entry["id"])
            .values(opening_balance=opening, closing_balance=balance)
        )

    connection.execute(
        update(bank_table)
        .where(bank_table.c.id == bank_id)
        .values(current_balance=balance)
    )


def _delete_generated_cash(connection, llp_id: str, reference_type: str, reference_id: str):
    table = CashBookEntry.__table__
    rows = connection.execute(
        select(table.c.id, table.c.paid_by).where(
            table.c.llp_id == llp_id,
            table.c.reference_type == reference_type,
            table.c.reference_id == reference_id,
        )
    ).all()
    for row in rows:
        _delete_journal(connection, llp_id, "cash_book", row.id)
        connection.execute(delete(table).where(table.c.id == row.id))
        _recalc_bank(connection, row.paid_by)


def _sync_generated_bank_payment(
    connection,
    *,
    llp_id: str,
    reference_type: str,
    reference_id: str,
    entry_date,
    amount: Decimal,
    bank_value: str,
    counter_ledger_id: str,
    reference_no: str,
    description: str,
):
    table = CashBookEntry.__table__
    old = connection.execute(
        select(table).where(
            table.c.llp_id == llp_id,
            table.c.reference_type == reference_type,
            table.c.reference_id == reference_id,
        )
    ).mappings().first()

    bank = _bank_row(connection, llp_id, bank_value)
    if not bank or amount <= 0:
        if old:
            _delete_journal(connection, llp_id, "cash_book", old["id"])
            connection.execute(delete(table).where(table.c.id == old["id"]))
            _recalc_bank(connection, old["paid_by"])
        return False

    bank_id = bank["id"]
    cash_id = old["id"] if old else f"CASH-{uuid.uuid4().hex[:24].upper()}"

    values = dict(
        llp_id=llp_id,
        entry_date=entry_date,
        entry_type="Payment",
        opening_balance=0,
        amount_in=0,
        amount_out=amount,
        closing_balance=0,
        reference_type=reference_type,
        reference_id=reference_id,
        description=description,
        paid_by=bank_id,
    )

    if old:
        old_bank = old["paid_by"]
        connection.execute(update(table).where(table.c.id == cash_id).values(**values))
        if old_bank and old_bank != bank_id:
            _recalc_bank(connection, old_bank)
    else:
        connection.execute(
            table.insert().values(
                id=cash_id,
                created_at=_utcnow(),
                **values,
            )
        )

    _recalc_bank(connection, bank_id)
    bank_ledger_id = _bank_ledger_from_row(connection, bank)

    _write_journal(
        connection,
        llp_id=llp_id,
        entry_date=entry_date,
        voucher_type="Bank",
        voucher_no=reference_no or reference_id,
        narration=description,
        source_type="cash_book",
        source_id=cash_id,
        lines=[
            (counter_ledger_id, amount, 0, description),
            (bank_ledger_id, 0, amount, description),
        ],
    )
    return True


def _write_clearing_payment(
    connection,
    *,
    llp_id,
    source_type,
    source_id,
    entry_date,
    amount,
    counter_ledger_id,
    voucher_no,
    narration,
):
    clearing = _clearing_ledger(connection, llp_id)
    _write_journal(
        connection,
        llp_id=llp_id,
        entry_date=entry_date,
        voucher_type="Payment",
        voucher_no=voucher_no,
        narration=narration,
        source_type=source_type,
        source_id=source_id,
        lines=[
            (counter_ledger_id, amount, 0, narration),
            (clearing, 0, amount, narration),
        ],
    )


# ---------------------------------------------------------------------------
# Payables
# ---------------------------------------------------------------------------

def _vendor_for_payable(connection, p):
    table = Vendor.__table__
    if p.vendor_id:
        row = connection.execute(select(table).where(table.c.id == p.vendor_id)).mappings().first()
    else:
        row = connection.execute(
            select(table).where(
                table.c.llp_id == p.llp_id,
                table.c.vendor_name == p.vendor_name,
            )
        ).mappings().first()
    if not row:
        return None
    class Obj: pass
    obj = Obj()
    for k, v in row.items():
        setattr(obj, k, v)
    return obj


def _payable_vendor_ledger(connection, p):
    vendor = _vendor_for_payable(connection, p)
    if vendor:
        return _vendor_ledger(connection, vendor)

    return _ensure_ledger(
        connection,
        llp_id=p.llp_id,
        system_key=f"vendor-name:{_slug(p.vendor_name)}",
        name=p.vendor_name or "Unknown Vendor",
        group_name="Accounts Payable",
        account_type="Liability",
        code=f"VEND{_clean_code(p.vendor_name)}",
        opening_balance=0,
        opening_side="Cr",
        notes="Vendor liability ledger created from a payable without VendorID.",
        adopt_same_name=True,
    )


def _sync_payable_bill(connection, p):
    source_type = "payable_bill"
    if p.status == "Cancelled" or not _eligible(p.bill_date):
        _delete_journal(connection, p.llp_id, source_type, p.id)
        return

    gross = _d(p.gross_amount)
    gst = _d(p.gst_amount)
    tcs = _d(p.tcs_amount)
    actual_tds = min(_d(p.tds_deducted_amount), gross)
    expense_component = max(gross - gst - tcs, Decimal("0"))
    vendor_credit = max(gross - actual_tds, Decimal("0"))

    expense_ledger = _expense_ledger(connection, p.llp_id, p.expense_type, p.vendor_category)
    vendor_ledger = _payable_vendor_ledger(connection, p)

    lines = [(expense_ledger, expense_component, 0, p.description or p.bill_no)]

    if gst > 0:
        gst_ledger = _tax_ledger(connection, p.llp_id, "GSTINPUT", "GST Input", "Duties & Taxes", "Asset", "Dr")
        lines.append((gst_ledger, gst, 0, "Input GST"))

    if tcs > 0:
        tcs_ledger = _tax_ledger(connection, p.llp_id, "TCSREC", "TCS Receivable", "Duties & Taxes", "Asset", "Dr")
        lines.append((tcs_ledger, tcs, 0, "TCS Receivable"))

    if actual_tds > 0:
        tds_ledger = _tax_ledger(connection, p.llp_id, "TDSPAY", "TDS Payable", "Duties & Taxes", "Liability", "Cr")
        lines.append((tds_ledger, 0, actual_tds, "TDS Payable"))

    lines.append((vendor_ledger, 0, vendor_credit, p.vendor_name))

    _write_journal(
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


def _sync_payable_payment(connection, p):
    # Remove all alternative system payment postings first; the current state
    # below will recreate exactly one correct representation.
    _delete_journal(connection, p.llp_id, "payable_payment_personal", p.id)
    _delete_journal(connection, p.llp_id, "payable_payment_clearing", p.id)

    if p.status == "Cancelled" or _d(p.paid_amount) <= 0 or not _eligible(p.payment_date):
        _delete_generated_cash(connection, p.llp_id, "Payable Payment", p.id)
        return

    amount = _d(p.paid_amount)
    vendor_ledger = _payable_vendor_ledger(connection, p)
    paid_by_type = str(p.paid_by_type or "Company").strip().lower()
    narration = f"Payment of {p.bill_no or p.id} to {p.vendor_name}"

    if paid_by_type == "company":
        if str(p.payment_mode or "Bank").strip().lower() in {"cash", "petty cash"}:
            _delete_generated_cash(connection, p.llp_id, "Payable Payment", p.id)
            cash_ledger = _cash_ledger(connection, p.llp_id)
            _write_journal(
                connection,
                llp_id=p.llp_id,
                entry_date=p.payment_date,
                voucher_type="Payment",
                voucher_no=p.reference_no or p.id,
                narration=narration,
                source_type="payable_payment_clearing",
                source_id=p.id,
                lines=[
                    (vendor_ledger, amount, 0, narration),
                    (cash_ledger, 0, amount, narration),
                ],
            )
            return

        posted = _sync_generated_bank_payment(
            connection,
            llp_id=p.llp_id,
            reference_type="Payable Payment",
            reference_id=p.id,
            entry_date=p.payment_date,
            amount=amount,
            bank_value=p.bank_account,
            counter_ledger_id=vendor_ledger,
            reference_no=p.reference_no,
            description=narration,
        )
        if not posted:
            _write_clearing_payment(
                connection,
                llp_id=p.llp_id,
                source_type="payable_payment_clearing",
                source_id=p.id,
                entry_date=p.payment_date,
                amount=amount,
                counter_ledger_id=vendor_ledger,
                voucher_no=p.reference_no or p.id,
                narration=narration,
            )
        return

    _delete_generated_cash(connection, p.llp_id, "Payable Payment", p.id)
    settlement_name = p.reimburse_to or p.paid_by_name or "Personal Payment"
    person_ledger = _person_ledger(connection, p.llp_id, settlement_name)
    _write_journal(
        connection,
        llp_id=p.llp_id,
        entry_date=p.payment_date,
        voucher_type="Journal",
        voucher_no=p.reference_no or p.id,
        narration=f"{p.vendor_name} paid personally by {settlement_name}",
        source_type="payable_payment_personal",
        source_id=p.id,
        lines=[
            (vendor_ledger, amount, 0, p.vendor_name),
            (person_ledger, 0, amount, settlement_name),
        ],
    )


def _sync_payable_reimbursement(connection, p):
    _delete_journal(connection, p.llp_id, "payable_reimbursement_clearing", p.id)

    if (
        str(p.paid_by_type or "Company").strip().lower() == "company"
        or str(p.reimbursement_status or "") != "Reimbursed"
        or _d(p.paid_amount) <= 0
        or not _eligible(p.reimbursement_date)
    ):
        _delete_generated_cash(connection, p.llp_id, "Payable Reimbursement", p.id)
        return

    amount = _d(p.paid_amount)
    settlement_name = p.reimburse_to or p.paid_by_name or "Personal Payment"
    person_ledger = _person_ledger(connection, p.llp_id, settlement_name)
    narration = f"Reimbursement to {settlement_name} for {p.vendor_name} / {p.bill_no}"

    posted = _sync_generated_bank_payment(
        connection,
        llp_id=p.llp_id,
        reference_type="Payable Reimbursement",
        reference_id=p.id,
        entry_date=p.reimbursement_date,
        amount=amount,
        bank_value=p.bank_account,
        counter_ledger_id=person_ledger,
        reference_no=p.reimbursement_ref,
        description=narration,
    )
    if not posted:
        _write_clearing_payment(
            connection,
            llp_id=p.llp_id,
            source_type="payable_reimbursement_clearing",
            source_id=p.id,
            entry_date=p.reimbursement_date,
            amount=amount,
            counter_ledger_id=person_ledger,
            voucher_no=p.reimbursement_ref or p.id,
            narration=narration,
        )


def _sync_payable(connection, p):
    _sync_payable_bill(connection, p)
    _sync_payable_payment(connection, p)
    _sync_payable_reimbursement(connection, p)


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------

def _sync_expense_journal(connection, e):
    if str(e.status or "") not in {"Approved", "Reimbursed", "Paid", "Recovered"} or not _eligible(e.expense_date):
        _delete_journal(connection, e.llp_id, "expense", e.id)
        return

    amount = _d(e.amount)
    gst = min(_d(e.gst_amount), amount)
    expense_component = max(amount - gst, Decimal("0"))
    expense_ledger = _expense_ledger(connection, e.llp_id, e.expense_type, e.category)
    settlement_name = e.reimburse_to or e.paid_by or e.employee_name or "Personal Payment"
    person_ledger = _person_ledger(connection, e.llp_id, settlement_name)

    lines = [(expense_ledger, expense_component, 0, e.description or e.id)]
    if gst > 0:
        gst_ledger = _tax_ledger(connection, e.llp_id, "GSTINPUT", "GST Input", "Duties & Taxes", "Asset", "Dr")
        lines.append((gst_ledger, gst, 0, "Input GST"))
    lines.append((person_ledger, 0, amount, settlement_name))

    _write_journal(
        connection,
        llp_id=e.llp_id,
        entry_date=e.expense_date,
        voucher_type="Expense",
        voucher_no=e.id,
        narration=e.description or e.vendor_or_person or "Expense",
        source_type="expense",
        source_id=e.id,
        lines=lines,
    )


def _sync_expense_reimbursement(connection, e):
    _delete_journal(connection, e.llp_id, "expense_reimbursement_clearing", e.id)

    if str(e.status or "") != "Reimbursed" or not _eligible(e.reimburse_date):
        _delete_generated_cash(connection, e.llp_id, "Expense Reimbursement", e.id)
        return

    amount = _d(e.amount)
    settlement_name = e.reimburse_to or e.paid_by or e.employee_name or "Personal Payment"
    person_ledger = _person_ledger(connection, e.llp_id, settlement_name)
    narration = f"Expense reimbursement to {settlement_name}: {e.description or e.id}"

    mode = str(e.reimburse_mode or "").strip().lower()
    if mode == "petty cash" or str(e.reimburse_account or "").strip().lower() == "petty cash":
        _delete_generated_cash(connection, e.llp_id, "Expense Reimbursement", e.id)
        cash_ledger = _cash_ledger(connection, e.llp_id)
        _write_journal(
            connection,
            llp_id=e.llp_id,
            entry_date=e.reimburse_date,
            voucher_type="Payment",
            voucher_no=e.reimburse_ref or e.id,
            narration=narration,
            source_type="expense_reimbursement_clearing",
            source_id=e.id,
            lines=[
                (person_ledger, amount, 0, narration),
                (cash_ledger, 0, amount, narration),
            ],
        )
        return

    posted = _sync_generated_bank_payment(
        connection,
        llp_id=e.llp_id,
        reference_type="Expense Reimbursement",
        reference_id=e.id,
        entry_date=e.reimburse_date,
        amount=amount,
        bank_value=e.reimburse_account,
        counter_ledger_id=person_ledger,
        reference_no=e.reimburse_ref,
        description=narration,
    )
    if not posted:
        _write_clearing_payment(
            connection,
            llp_id=e.llp_id,
            source_type="expense_reimbursement_clearing",
            source_id=e.id,
            entry_date=e.reimburse_date,
            amount=amount,
            counter_ledger_id=person_ledger,
            voucher_no=e.reimburse_ref or e.id,
            narration=narration,
        )


def _sync_expense(connection, e):
    _sync_expense_journal(connection, e)
    _sync_expense_reimbursement(connection, e)


# ---------------------------------------------------------------------------
# SQLAlchemy event registration
# ---------------------------------------------------------------------------

@event.listens_for(BankAccount, "after_insert")
@event.listens_for(BankAccount, "after_update")
def _bank_changed(mapper, connection, target):
    _bank_ledger(connection, target)
    _recalc_bank(connection, target.id)


@event.listens_for(Vendor, "after_insert")
@event.listens_for(Vendor, "after_update")
def _vendor_changed(mapper, connection, target):
    _vendor_ledger(connection, target)


@event.listens_for(Vendor, "after_delete")
def _vendor_deleted(mapper, connection, target):
    if not target.llp_id:
        return
    table = Ledger.__table__
    connection.execute(
        update(table).where(
            table.c.llp_id == target.llp_id,
            table.c.system_key == f"vendor:{target.id}",
        ).values(
            status="Inactive",
            notes="Vendor master deleted. Ledger retained for accounting history.",
            updated_at=_utcnow(),
        )
    )


@event.listens_for(Partner, "after_insert")
@event.listens_for(Partner, "after_update")
def _partner_changed(mapper, connection, target):
    _partner_ledger(connection, target)


@event.listens_for(LLPPayable, "after_insert")
@event.listens_for(LLPPayable, "after_update")
def _payable_changed(mapper, connection, target):
    _sync_payable(connection, target)


@event.listens_for(LLPPayable, "after_delete")
def _payable_deleted(mapper, connection, target):
    for source_type in (
        "payable_bill",
        "payable_payment_personal",
        "payable_payment_clearing",
        "payable_reimbursement_clearing",
    ):
        _delete_journal(connection, target.llp_id, source_type, target.id)
    _delete_generated_cash(connection, target.llp_id, "Payable Payment", target.id)
    _delete_generated_cash(connection, target.llp_id, "Payable Reimbursement", target.id)


@event.listens_for(Expense, "after_insert")
@event.listens_for(Expense, "after_update")
def _expense_changed(mapper, connection, target):
    _sync_expense(connection, target)


@event.listens_for(Expense, "after_delete")
def _expense_deleted(mapper, connection, target):
    _delete_journal(connection, target.llp_id, "expense", target.id)
    _delete_journal(connection, target.llp_id, "expense_reimbursement_clearing", target.id)
    _delete_generated_cash(connection, target.llp_id, "Expense Reimbursement", target.id)


# ---------------------------------------------------------------------------
# Startup master sync (NO transaction backfill)
# ---------------------------------------------------------------------------

def sync_existing_accounting_masters():
    """Create/sync Bank, Vendor and Partner ledgers only.

    Intentionally does not back-post existing Payables or Expenses.
    """
    db: Session = SessionLocal()
    try:
        try:
            db.query(Ledger.id).limit(1).all()
        except OperationalError:
            db.rollback()
            return

        connection = db.connection()

        for bank in db.query(BankAccount).all():
            _bank_ledger(connection, bank)

        for vendor in db.query(Vendor).all():
            _vendor_ledger(connection, vendor)

        for partner in db.query(Partner).all():
            _partner_ledger(connection, partner)

        # Ensure core accounting ledgers are available per LLP that has a bank,
        # vendor or partner.
        llp_ids = {
            x.llp_id for x in db.query(BankAccount).all() if x.llp_id
        } | {
            x.llp_id for x in db.query(Vendor).all() if x.llp_id
        } | {
            x.llp_id for x in db.query(Partner).all() if x.llp_id
        }

        for llp_id in llp_ids:
            _cash_ledger(connection, llp_id)
            _tax_ledger(connection, llp_id, "GSTINPUT", "GST Input", "Duties & Taxes", "Asset", "Dr")
            _tax_ledger(connection, llp_id, "TDSPAY", "TDS Payable", "Duties & Taxes", "Liability", "Cr")
            _tax_ledger(connection, llp_id, "TCSREC", "TCS Receivable", "Duties & Taxes", "Asset", "Dr")

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from openpyxl import load_workbook
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import (
    BankAccount,
    CashBookEntry,
    Expense,
    LLP,
    LLPPartner,
    LLPPayable,
    Partner,
    Receipt,
    Setting,
    User,
    Vendor,
)
from app.security import hash_password
from app.services.common import audit, make_id, normalize_key, parse_date
from app.services.payables import calculate_amounts, payable_status

router = APIRouter(prefix="/imports", tags=["imports"])


def _text(value):
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    return str(value).strip()


def _value(row, *keys):
    for key in keys:
        if key in row:
            return row.get(key)
    wanted = {normalize_key(key) for key in keys}
    for key, value in row.items():
        if normalize_key(key) in wanted:
            return value
    return None


def _money(value):
    if value in (None, ""):
        return Decimal("0.00")
    try:
        return Decimal(str(value).replace(",", "").strip() or "0").quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return Decimal("0.00")


def _bool(value):
    return not _text(value).lower().startswith(("n", "false", "0", "inactive"))


def _rows(workbook, sheet_name):
    if sheet_name not in workbook.sheetnames:
        return []
    sheet = workbook[sheet_name]
    headers = [_text(cell.value) for cell in sheet[1]]
    rows = []
    for values in sheet.iter_rows(min_row=2, values_only=True):
        item = {}
        for header, value in zip(headers, values):
            if header:
                item[header] = value
        if any(_text(v) for v in item.values()):
            rows.append(item)
    return rows


def _summary():
    return {"imported": 0, "skipped": 0, "errors": []}


def _skip(summary, row_no, message):
    summary["skipped"] += 1
    summary["errors"].append({"row": row_no, "message": message})


def _llp_by_key(db, value):
    key = normalize_key(value)
    if not key:
        return None
    return next(
        (
            r
            for r in db.query(LLP).all()
            if normalize_key(r.id) == key
            or normalize_key(r.llp_name) == key
            or normalize_key(r.short_code) == key
        ),
        None,
    )


def _llp_id(db, row):
    llp = (
        _llp_by_key(db, _value(row, "LLPID", "LLP ID", "llpId"))
        or _llp_by_key(db, _value(row, "LLPName", "LLP Name", "llpName"))
        or _llp_by_key(db, _value(row, "ShortCode", "Short Code", "shortCode"))
    )
    return llp.id if llp else None


def _user_by_row(db, row):
    user_id = _text(_value(row, "UserID", "User ID"))
    username = _text(_value(row, "Username", "UserName", "User Name")).lower()
    if user_id:
        item = db.get(User, user_id)
        if item:
            return item
    if username:
        return db.query(User).filter(User.username == username).first()
    return None


def _vendor(db, llp_id, vendor_name):
    name_key = normalize_key(vendor_name)
    if not name_key:
        return None
    return next(
        (
            v
            for v in db.query(Vendor).filter((Vendor.llp_id == llp_id) | (Vendor.llp_id.is_(None))).all()
            if normalize_key(v.vendor_name) == name_key
        ),
        None,
    )


def _commit(db, summary, module, ref_id, user_email):
    try:
        audit(db, user_email, module, "import", ref_id)
        db.commit()
        summary["imported"] += 1
    except IntegrityError as exc:
        db.rollback()
        summary["skipped"] += 1
        summary["errors"].append({"row": ref_id, "message": str(exc.orig)})


@router.post("/accounts-workbook")
async def import_accounts_workbook(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    filename = (file.filename or "").lower()
    if not filename.endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Upload an Excel .xlsx file")

    content = await file.read()
    workbook = load_workbook(BytesIO(content), data_only=True)
    result = {name: _summary() for name in [
        "Settings",
        "LLPs",
        "Users",
        "Partners",
        "LLPPartners",
        "Vendors",
        "BankAccounts",
        "LLPPayables",
        "Expenses",
        "Receipts",
        "CashBook",
    ]}

    for index, row in enumerate(_rows(workbook, "Settings"), start=2):
        key = _text(row.get("Key"))
        if not key:
            _skip(result["Settings"], index, "Missing Key")
            continue
        db.merge(Setting(id=make_id("SET"), key=key, value=_text(row.get("Value"))))
        _commit(db, result["Settings"], "settings", key, user.email)

    for index, row in enumerate(_rows(workbook, "LLPs"), start=2):
        llp_id = _text(row.get("LLPID")) or make_id("LLP")
        if not _text(row.get("LLPName")):
            _skip(result["LLPs"], index, "Missing LLPName")
            continue
        existing = db.get(LLP, llp_id)
        item = existing or LLP(id=llp_id, llp_name="")
        item.llp_name = _text(row.get("LLPName"))
        item.short_code = _text(row.get("ShortCode")) or llp_id
        item.gstin = _text(row.get("GSTIN"))
        item.pan = _text(row.get("PAN"))
        item.address = _text(row.get("Address"))
        item.status = _text(row.get("Status")) or "Active"
        db.add(item)
        _commit(db, result["LLPs"], "llps", item.id, user.email)

    for index, row in enumerate(_rows(workbook, "Users"), start=2):
        username = _text(row.get("Username")).lower()
        if not username:
            _skip(result["Users"], index, "Missing Username")
            continue
        item = db.query(User).filter(User.username == username).first() or User(
            id=_text(row.get("UserID")) or make_id("USR"),
            username=username,
            email=username,
            password_hash=hash_password("ChangeMe123!"),
        )
        item.name = _text(row.get("Name")) or username
        item.email = _text(row.get("Email")) or username
        item.role = _text(row.get("Role")) or "viewer"
        item.allowed_modules = _text(row.get("AllowedModules"))
        item.status = _text(row.get("Status")) or "Active"
        db.add(item)
        _commit(db, result["Users"], "users", item.id, user.email)

    for index, row in enumerate(_rows(workbook, "Partners"), start=2):
        item = db.get(Partner, _text(row.get("PartnerID"))) if _text(row.get("PartnerID")) else None
        item = item or Partner(id=_text(row.get("PartnerID")) or make_id("PTR"), partner_name="")
        item.partner_name = _text(row.get("PartnerName"))
        item.llp_id = _llp_id(db, row)
        item.email = _text(row.get("Email"))
        item.mobile = _text(row.get("Mobile"))
        item.status = _text(row.get("Status")) or "Active"
        db.add(item)
        _commit(db, result["Partners"], "partners", item.id, user.email)

    for index, row in enumerate(_rows(workbook, "LLPPartners"), start=2):
        llp_id = _llp_id(db, row)
        target = _user_by_row(db, row)
        if not llp_id or not target:
            _skip(result["LLPPartners"], index, "Missing matching LLP or Username")
            continue
        item = db.get(LLPPartner, _text(row.get("MappingID"))) if _text(row.get("MappingID")) else None
        item = item or LLPPartner(id=_text(row.get("MappingID")) or make_id("MAP"), llp_id=llp_id, user_id=target.id)
        item.role = _text(row.get("Role")) or "partner"
        item.percentage = _text(row.get("Percentage"))
        item.allowed_modules = _text(row.get("AllowedModules"))
        item.status = _text(row.get("Status")) or "Active"
        db.add(item)
        _commit(db, result["LLPPartners"], "llp_partners", item.id, user.email)

    for index, row in enumerate(_rows(workbook, "Vendors"), start=2):
        item = db.get(Vendor, _text(row.get("VendorID"))) if _text(row.get("VendorID")) else None
        item = item or Vendor(id=_text(row.get("VendorID")) or make_id("VND"), vendor_name="")
        item.vendor_name = _text(row.get("VendorName"))
        item.llp_id = _llp_id(db, row)
        item.category = _text(row.get("Category"))
        item.gstin = _text(row.get("GSTIN"))
        item.pan = _text(row.get("PAN"))
        item.state = _text(row.get("State"))
        item.notes = _text(row.get("Notes"))
        item.status = _text(row.get("Status")) or "Active"
        db.add(item)
        _commit(db, result["Vendors"], "vendors", item.id, user.email)

    for index, row in enumerate(_rows(workbook, "BankAccounts"), start=2):
        llp_id = _llp_id(db, row)
        if not llp_id:
            _skip(result["BankAccounts"], index, "Missing matching LLP")
            continue
        item = db.get(BankAccount, _text(row.get("AccountID"))) if _text(row.get("AccountID")) else None
        item = item or BankAccount(id=_text(row.get("AccountID")) or make_id("BANK"), llp_id=llp_id, account_name="", bank_name="", account_number="")
        item.llp_id = llp_id
        item.account_name = _text(row.get("AccountName"))
        item.bank_name = _text(row.get("BankName"))
        item.account_number = _text(row.get("AccountNumber"))
        item.ifsc = _text(row.get("IFSC"))
        item.account_type = _text(row.get("AccountType")) or "Current"
        item.branch = _text(row.get("Branch"))
        item.opening_balance = _money(row.get("OpeningBalance"))
        item.current_balance = _money(row.get("CurrentBalance")) or item.opening_balance
        item.is_active = _bool(row.get("IsActive"))
        item.notes = _text(row.get("Notes"))
        db.add(item)
        _commit(db, result["BankAccounts"], "bankaccounts", item.id, user.email)

    for index, row in enumerate(_rows(workbook, "LLPPayables"), start=2):
        llp_id = _llp_id(db, row)
        if not llp_id:
            _skip(result["LLPPayables"], index, "Missing matching LLP")
            continue
        vendor = _vendor(db, llp_id, row.get("VendorName"))
        merged = {key: row.get(key) for key in row}
        taxable, gst, gross, tds_rate, tds, net = calculate_amounts(merged)
        item = db.get(LLPPayable, _text(row.get("PayableID"))) if _text(row.get("PayableID")) else None
        item = item or LLPPayable(id=_text(row.get("PayableID")) or make_id("PAY"), llp_id=llp_id, vendor_name="", bill_no="", normalized_bill_no="")
        item.llp_id = llp_id
        item.vendor_id = vendor.id if vendor else None
        item.vendor_name = _text(row.get("VendorName"))
        item.vendor_category = _text(row.get("VendorCategory"))
        item.vendor_gstin = _text(row.get("VendorGSTIN"))
        item.vendor_pan = _text(row.get("VendorPAN"))
        item.bill_no = _text(row.get("BillNo"))
        item.normalized_bill_no = normalize_key(item.bill_no)
        item.bill_date = parse_date(row.get("BillDate"))
        item.due_date = parse_date(row.get("DueDate"))
        item.expense_type = _text(row.get("ExpenseType")) or "Vendor Bill"
        item.description = _text(row.get("Description"))
        item.taxable_amount, item.gst_amount, item.gross_amount = taxable, gst, gross
        item.tds_section = _text(row.get("TDSSection"))
        item.tds_rate, item.tds_amount, item.net_payable = tds_rate, tds, net
        item.paid_amount = _money(row.get("PaidAmount"))
        item.payment_date = parse_date(row.get("PaymentDate"))
        item.payment_mode = _text(row.get("PaymentMode")) or "Bank"
        item.bank_account = _text(row.get("BankAccount"))
        item.reference_no = _text(row.get("ReferenceNo"))
        item.challan_no = _text(row.get("ChallanNo"))
        item.challan_date = parse_date(row.get("ChallanDate"))
        item.interest_amount = _money(row.get("InterestAmount"))
        item.status = payable_status(item.net_payable, item.paid_amount, _text(row.get("Status")))
        item.notes = _text(row.get("Notes"))
        db.add(item)
        _commit(db, result["LLPPayables"], "payables", item.id, user.email)

    for index, row in enumerate(_rows(workbook, "Expenses"), start=2):
        llp_id = _llp_id(db, row)
        if not llp_id:
            _skip(result["Expenses"], index, "Missing matching LLP")
            continue
        item = db.get(Expense, _text(row.get("ExpenseID"))) if _text(row.get("ExpenseID")) else None
        item = item or Expense(id=_text(row.get("ExpenseID")) or make_id("EXP"), llp_id=llp_id)
        item.llp_id = llp_id
        item.expense_date = parse_date(row.get("Date"))
        item.expense_type = _text(row.get("ExpenseType")) or "Misc"
        item.category = _text(row.get("Category"))
        item.paid_by = _text(row.get("PaidBy"))
        item.charge_to = _text(row.get("ChargeTo"))
        item.reimburse_to = _text(row.get("ReimburseTo"))
        item.payment_mode = _text(row.get("PaymentMode")) or "Cash"
        item.taxable_value = _money(row.get("TaxableValue"))
        item.cgst_amount = _money(row.get("CGSTAmount"))
        item.sgst_amount = _money(row.get("SGSTAmount"))
        item.igst_amount = _money(row.get("IGSTAmount"))
        item.gst_amount = _money(row.get("GSTAmount"))
        item.amount = _money(row.get("Amount"))
        item.vendor_or_person = _text(row.get("VendorOrPerson"))
        item.description = _text(row.get("Description"))
        item.bill_available = _bool(row.get("BillAvailable"))
        item.bill_link = _text(row.get("BillLink"))
        item.employee_name = _text(row.get("EmployeeName"))
        item.billing_month = _text(row.get("BillingMonth"))
        item.travel_id = _text(row.get("TravelID"))
        item.partner_allocations = _text(row.get("PartnerAllocations"))
        item.notes = _text(row.get("Notes"))
        item.status = _text(row.get("Status")) or "Draft"
        item.reimburse_mode = _text(row.get("ReimburseMode"))
        item.reimburse_account = _text(row.get("ReimburseAccount"))
        item.reimburse_date = parse_date(row.get("ReimburseDate"))
        item.reimburse_ref = _text(row.get("ReimburseRef"))
        item.reimburse_by = _text(row.get("ReimburseBy"))
        item.approved_by = _text(row.get("ApprovedBy"))
        db.add(item)
        _commit(db, result["Expenses"], "expenses", item.id, user.email)

    for index, row in enumerate(_rows(workbook, "Receipts"), start=2):
        llp_id = _llp_id(db, row)
        if not llp_id:
            _skip(result["Receipts"], index, "Missing matching LLP")
            continue
        item = db.get(Receipt, _text(row.get("ReceiptID"))) if _text(row.get("ReceiptID")) else None
        item = item or Receipt(id=_text(row.get("ReceiptID")) or make_id("REC"), llp_id=llp_id)
        item.llp_id = llp_id
        item.receipt_date = parse_date(row.get("Date"))
        item.reference_type = _text(row.get("ReferenceType"))
        item.reference_no = _text(row.get("ReferenceNo") or row.get("InvoiceNo"))
        item.month = _text(row.get("Month"))
        item.amount_received = _money(row.get("AmountReceived"))
        item.receipt_mode = _text(row.get("ReceiptMode")) or "Bank"
        item.bank_account = _text(row.get("BankAccount"))
        item.notes = _text(row.get("Notes"))
        db.add(item)
        _commit(db, result["Receipts"], "receipts", item.id, user.email)

    for index, row in enumerate(_rows(workbook, "CashBook"), start=2):
        llp_id = _llp_id(db, row)
        if not llp_id:
            _skip(result["CashBook"], index, "Missing matching LLP")
            continue
        item = db.get(CashBookEntry, _text(row.get("EntryID"))) if _text(row.get("EntryID")) else None
        item = item or CashBookEntry(id=_text(row.get("EntryID")) or make_id("CASH"), llp_id=llp_id)
        item.llp_id = llp_id
        item.entry_date = parse_date(row.get("Date"))
        item.entry_type = _text(row.get("Type")) or "Payment"
        item.opening_balance = _money(row.get("OpeningBalance"))
        item.amount_in = _money(row.get("AmountIn"))
        item.amount_out = _money(row.get("AmountOut"))
        item.closing_balance = _money(row.get("ClosingBalance")) or (item.opening_balance + item.amount_in - item.amount_out)
        item.reference_type = _text(row.get("ReferenceType")) or "Manual"
        item.reference_id = _text(row.get("ReferenceID"))
        item.description = _text(row.get("Description"))
        item.paid_by = _text(row.get("PaidBy"))
        db.add(item)
        _commit(db, result["CashBook"], "cashbook", item.id, user.email)

    return {"ok": True, "message": "Workbook import complete", "summary": result}

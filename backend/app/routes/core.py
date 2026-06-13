import json
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user, get_llp_id, require_llp_id, require_roles
from app.models import (
    BankAccount,
    CashBookEntry,
    Expense,
    LLP,
    LLPPartner,
    LLPPayable,
    NeoInvoice,
    Partner,
    Receipt,
    User,
    Vendor,
)
from app.security import hash_password
from app.services.common import audit, dec, export_rows, iso, llp_name, make_id, money, normalize_key, parse_date, yes_no
from app.services.expenses import create_expense, latest_cash_balance, reimburse_expense, serialize_expense
from app.services.neo_invoices import apply_neo_invoice_payload, create_neo_invoice, serialize_neo_invoice
from app.services.payables import calculate_amounts, create_payable, payable_status, serialize_payable

router = APIRouter(tags=["core"])


def _payload(payload: dict | None):
    return payload or {}


def _llp_or_default(db: Session, llp_id: str | None):
    if llp_id:
        return llp_id
    first = db.query(LLP).first()
    if not first:
        raise HTTPException(status_code=400, detail="No LLP available")
    return first.id


def _modules(value):
    if isinstance(value, list):
        return ",".join(value)
    return value or ""


@router.get("/health")
def health():
    return {"ok": True, "timestamp": datetime.now(timezone.utc).isoformat()}


@router.get("/users")
def list_users(db: Session = Depends(get_db), _: User = Depends(require_roles("super_admin", "admin", "managing_partner"))):
    return {"ok": True, "data": [{
        "UserID": u.id, "Name": u.name, "Username": u.username, "Email": u.email,
        "Role": u.role, "AllowedModules": u.allowed_modules, "Status": u.status,
        "SignatureURL": u.signature_url,
        "CreatedAt": iso(u.created_at), "UpdatedAt": iso(u.updated_at)
    } for u in db.query(User).all()]}


@router.post("/users")
def create_user(payload: dict, db: Session = Depends(get_db), user: User = Depends(require_roles("super_admin", "admin", "managing_partner"))):
    p = _payload(payload)
    item = User(
        id=p.get("UserID") or make_id("USR"),
        name=p.get("Name") or p.get("name") or "",
        email=p.get("Email") or p.get("email") or p.get("Username") or p.get("username"),
        username=(p.get("Username") or p.get("username") or "").lower(),
        password_hash=hash_password(p.get("Password") or p.get("password") or "ChangeMe123!"),
        role=p.get("Role") or p.get("role") or "viewer",
        allowed_modules=_modules(p.get("AllowedModules") or p.get("allowed_modules")),
        signature_url=p.get("SignatureURL") or "",
        status=p.get("Status") or "Active",
    )
    db.add(item)
    audit(db, user.email, "users", "create", item.id)
    db.commit()
    return {"ok": True, "message": "User saved", "data": {"UserID": item.id}}


@router.put("/users/{id}")
def update_user(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(require_roles("super_admin", "admin", "managing_partner"))):
    item = db.get(User, id)
    if not item:
        raise HTTPException(status_code=404, detail="User not found")
    for attr, keys in {"name": ["Name"], "username": ["Username"], "email": ["Email"], "role": ["Role"], "status": ["Status"]}.items():
        for key in keys:
            if key in payload:
                setattr(item, attr, payload[key])
    if "SignatureURL" in payload:
        item.signature_url = payload["SignatureURL"] or ""
    if "AllowedModules" in payload:
        item.allowed_modules = _modules(payload["AllowedModules"])
    if payload.get("Password"):
        item.password_hash = hash_password(payload["Password"])
    audit(db, user.email, "users", "update", id)
    db.commit()
    return {"ok": True, "message": "User updated"}


@router.get("/llps")
def list_llps(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.query(LLP).all()
    return {"ok": True, "data": [{
        "LLPID": r.id, "llpId": r.id, "LLPName": r.llp_name, "llpName": r.llp_name,
        "ShortCode": r.short_code, "shortCode": r.short_code, "GSTIN": r.gstin, "gstin": r.gstin,
        "PAN": r.pan, "Address": r.address, "Status": r.status, "CreatedAt": iso(r.created_at)
    } for r in rows]}


@router.get("/llps/for-user")
def llps_for_user(username: str = "", db: Session = Depends(get_db), user: User = Depends(current_user)):
    target = db.query(User).filter(User.username == (username or user.username)).first() or user
    links = db.query(LLPPartner).filter(LLPPartner.user_id == target.id, LLPPartner.status == "Active").all()
    data = [{"llpId": l.llp_id, "LLPName": l.llp.llp_name, "llpName": l.llp.llp_name, "shortCode": l.llp.short_code, "gstin": l.llp.gstin, "role": l.role, "allowedModules": l.allowed_modules} for l in links]
    return {"ok": True, "data": data}


@router.post("/llps")
def create_llp(payload: dict, db: Session = Depends(get_db), user: User = Depends(require_roles("super_admin", "admin", "managing_partner"))):
    item = LLP(id=payload.get("LLPID") or make_id("LLP"), llp_name=payload.get("LLPName") or "", short_code=payload.get("ShortCode") or "", gstin=payload.get("GSTIN") or "", pan=payload.get("PAN") or "", address=payload.get("Address") or "", status=payload.get("Status") or "Active")
    db.add(item)
    audit(db, user.email, "llps", "create", item.id)
    db.commit()
    return {"ok": True, "data": {"LLPID": item.id}}


@router.put("/llps/{id}")
def update_llp(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(require_roles("super_admin", "admin", "managing_partner"))):
    item = db.get(LLP, id)
    if not item:
        raise HTTPException(status_code=404, detail="LLP not found")
    mapping = {"LLPName": "llp_name", "ShortCode": "short_code", "GSTIN": "gstin", "PAN": "pan", "Address": "address", "Status": "status"}
    for key, attr in mapping.items():
        if key in payload:
            setattr(item, attr, payload[key])
    audit(db, user.email, "llps", "update", id)
    db.commit()
    return {"ok": True}


@router.get("/vendors")
def vendors(db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    q = db.query(Vendor)
    if llp_id:
        q = q.filter((Vendor.llp_id == llp_id) | (Vendor.llp_id.is_(None)))
    return {"ok": True, "data": [{
        "VendorID": v.id, "LLPID": v.llp_id or "", "LLPName": llp_name(db, v.llp_id),
        "VendorName": v.vendor_name, "Category": v.category, "GSTIN": v.gstin,
        "PAN": v.pan, "State": v.state, "Notes": v.notes, "Status": v.status, "CreatedAt": iso(v.created_at)
    } for v in q.all()]}


@router.get("/partners")
def partners(db: Session = Depends(get_db), _: User = Depends(current_user)):
    rows = db.query(Partner).all()
    return {"ok": True, "data": [{
        "PartnerID": p.id, "PartnerName": p.partner_name, "LLPID": p.llp_id or "",
        "LLPName": llp_name(db, p.llp_id), "Email": p.email, "Mobile": p.mobile,
        "Status": p.status, "CreatedAt": iso(p.created_at)
    } for p in rows]}


@router.post("/partners")
def create_partner(payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = Partner(
        id=payload.get("PartnerID") or make_id("PTR"),
        partner_name=payload.get("PartnerName") or "",
        llp_id=payload.get("LLPID") or None,
        email=payload.get("Email") or "",
        mobile=payload.get("Mobile") or "",
        status=payload.get("Status") or "Active",
    )
    db.add(item)
    audit(db, user.email, "partners", "create", item.id)
    db.commit()
    return {"ok": True, "data": {"PartnerID": item.id}}


@router.put("/partners/{id}")
def update_partner(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Partner, id)
    if not item:
        raise HTTPException(status_code=404, detail="Partner not found")
    mapping = {"PartnerName": "partner_name", "LLPID": "llp_id", "Email": "email", "Mobile": "mobile", "Status": "status"}
    for key, attr in mapping.items():
        if key in payload:
            setattr(item, attr, payload[key] or None if attr == "llp_id" else payload[key])
    audit(db, user.email, "partners", "update", id)
    db.commit()
    return {"ok": True}


@router.get("/llp-partners")
def llp_partners(db: Session = Depends(get_db), _: User = Depends(current_user)):
    rows = db.query(LLPPartner).all()
    return {"ok": True, "data": [{
        "MappingID": r.id, "LLPID": r.llp_id, "LLPName": r.llp.llp_name,
        "UserID": r.user_id, "Username": r.user.username, "Role": r.role,
        "Percentage": r.percentage, "AllowedModules": r.allowed_modules,
        "Status": r.status, "CreatedAt": iso(r.created_at)
    } for r in rows]}


@router.post("/llp-partners")
def create_llp_partner(payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    target = db.query(User).filter(User.username == payload.get("Username")).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    item = LLPPartner(
        id=payload.get("MappingID") or make_id("MAP"),
        llp_id=payload.get("LLPID"),
        user_id=target.id,
        role=payload.get("Role") or "partner",
        percentage=str(payload.get("Percentage") or ""),
        allowed_modules=_modules(payload.get("AllowedModules")),
        status=payload.get("Status") or "Active",
    )
    db.add(item)
    audit(db, user.email, "llp_partners", "create", item.id)
    db.commit()
    return {"ok": True, "data": {"MappingID": item.id}}


@router.put("/llp-partners/{id}")
def update_llp_partner(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(LLPPartner, id)
    if not item:
        raise HTTPException(status_code=404, detail="Mapping not found")
    if "Role" in payload:
        item.role = payload["Role"]
    if "Percentage" in payload:
        item.percentage = str(payload["Percentage"] or "")
    if "AllowedModules" in payload:
        item.allowed_modules = _modules(payload["AllowedModules"])
    if "Status" in payload:
        item.status = payload["Status"]
    audit(db, user.email, "llp_partners", "update", id)
    db.commit()
    return {"ok": True}


@router.post("/vendors")
def create_vendor(payload: dict, db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), user: User = Depends(current_user)):
    item = Vendor(id=payload.get("VendorID") or make_id("VND"), llp_id=_llp_or_default(db, llp_id), vendor_name=payload.get("VendorName") or "", category=payload.get("Category") or "", gstin=payload.get("GSTIN") or "", pan=payload.get("PAN") or "", state=payload.get("State") or "", notes=payload.get("Notes") or "", status=payload.get("Status") or "Active")
    db.add(item)
    audit(db, user.email, "vendors", "create", item.id)
    db.commit()
    return {"ok": True, "message": "Vendor saved", "data": {"VendorID": item.id}}


@router.put("/vendors/{id}")
def update_vendor(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Vendor, id)
    if not item:
        raise HTTPException(status_code=404, detail="Vendor not found")
    mapping = {"VendorName": "vendor_name", "Category": "category", "GSTIN": "gstin", "PAN": "pan", "State": "state", "Notes": "notes", "Status": "status"}
    for key, attr in mapping.items():
        if key in payload:
            setattr(item, attr, payload[key])
    audit(db, user.email, "vendors", "update", id)
    db.commit()
    return {"ok": True}


@router.get("/payables")
def payables(db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    q = db.query(LLPPayable)
    if llp_id:
        q = q.filter(LLPPayable.llp_id == llp_id)
    rows = [serialize_payable(db, p) for p in q.all()]
    summary = {"billCount": len(rows), "grossAmount": sum(r["GrossAmount"] for r in rows), "tdsAmount": sum(r["TDSAmount"] for r in rows), "netPayable": sum(r["NetPayable"] for r in rows), "paidAmount": sum(r["PaidAmount"] for r in rows), "balanceAmount": sum(r["BalanceAmount"] for r in rows)}
    return {"ok": True, "data": rows, "summary": summary}


@router.post("/payables")
def add_payable(payload: dict, db: Session = Depends(get_db), llp_id: str = Depends(require_llp_id), user: User = Depends(current_user)):
    return {"ok": True, "message": "Payable saved", "data": create_payable(db, payload, llp_id, user.email)}


@router.put("/payables/{id}")
def update_payable(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(LLPPayable, id)
    if not item:
        raise HTTPException(status_code=404, detail="Payable not found")
    merged = serialize_payable(db, item) | payload
    taxable, gst, gross, tds_rate, tds, net = calculate_amounts(merged)
    item.vendor_name = merged.get("VendorName") or item.vendor_name
    item.bill_no = merged.get("BillNo") or item.bill_no
    item.normalized_bill_no = normalize_key(item.bill_no)
    item.bill_date = parse_date(merged.get("BillDate"))
    item.due_date = parse_date(merged.get("DueDate"))
    item.taxable_amount, item.gst_amount, item.gross_amount = taxable, gst, gross
    item.tds_rate, item.tds_amount, item.net_payable = tds_rate, tds, net
    item.paid_amount = dec(merged.get("PaidAmount"))
    item.status = payable_status(net, item.paid_amount, merged.get("Status"))
    item.payment_date = parse_date(merged.get("PaymentDate"))
    item.reference_no = merged.get("ReferenceNo") or ""
    item.notes = merged.get("Notes") or ""
    audit(db, user.email, "payables", "update", id)
    db.commit()
    return {"ok": True, "message": "Payable updated"}


@router.post("/payables/{id}/mark-paid")
def mark_paid(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(LLPPayable, id)
    if not item:
        raise HTTPException(status_code=404, detail="Payable not found")
    item.paid_amount = dec(payload.get("PaidAmount")) or dec(item.net_payable)
    item.payment_date = parse_date(payload.get("PaymentDate")) or datetime.now(timezone.utc).date()
    item.payment_mode = payload.get("PaymentMode") or item.payment_mode
    item.bank_account = payload.get("BankAccount") or item.bank_account
    item.reference_no = payload.get("ReferenceNo") or item.reference_no
    item.status = payable_status(item.net_payable, item.paid_amount)
    audit(db, user.email, "payables", "payment", id)
    db.commit()
    return {"ok": True, "message": "Payable marked paid"}


@router.get("/expenses")
def expenses(db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    q = db.query(Expense)
    if llp_id:
        q = q.filter(Expense.llp_id == llp_id)
    return {"ok": True, "data": [serialize_expense(db, e) for e in q.all()]}


@router.post("/expenses")
def add_expense(payload: dict, db: Session = Depends(get_db), llp_id: str = Depends(require_llp_id), user: User = Depends(current_user)):
    return create_expense(db, payload, llp_id, user.email)


@router.put("/expenses/{id}")
def update_expense(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Expense, id)
    if not item:
        raise HTTPException(status_code=404, detail="Expense not found")
    mapping = {"Date": ("expense_date", parse_date), "ExpenseType": ("expense_type", str), "Category": ("category", str), "PaidBy": ("paid_by", str), "PaymentMode": ("payment_mode", str), "Amount": ("amount", dec), "Description": ("description", str), "Status": ("status", str)}
    for key, (attr, fn) in mapping.items():
        if key in payload:
            setattr(item, attr, fn(payload[key]))
    audit(db, user.email, "expenses", "update", id)
    db.commit()
    return {"ok": True, "message": "Expense updated"}


@router.delete("/expenses/{id}")
def delete_expense(id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Expense, id)
    if not item:
        raise HTTPException(status_code=404, detail="Expense not found")
    db.delete(item)
    audit(db, user.email, "expenses", "delete", id)
    db.commit()
    return {"ok": True, "message": "Expense deleted"}


@router.post("/expenses/{id}/approve")
def approve_expense(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Expense, id)
    if not item:
        raise HTTPException(status_code=404, detail="Expense not found")
    item.status = "Approved"
    item.approved_by = payload.get("ApprovedBy") or user.email
    item.approved_at = datetime.now(timezone.utc)
    audit(db, user.email, "expenses", "approve", id)
    db.commit()
    return {"ok": True, "message": "Expense approved"}


@router.post("/expenses/{id}/reimburse")
def reimburse(id: str, payload: dict, db: Session = Depends(get_db), llp_id: str = Depends(require_llp_id), user: User = Depends(current_user)):
    return reimburse_expense(db, id, payload, llp_id, user.email)


@router.get("/receipts")
def receipts(db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    q = db.query(Receipt)
    if llp_id:
        q = q.filter(Receipt.llp_id == llp_id)
    return {"ok": True, "data": [{"ReceiptID": r.id, "LLPID": r.llp_id, "LLPName": llp_name(db, r.llp_id), "Date": iso(r.receipt_date), "ReferenceType": r.reference_type, "ReferenceNo": r.reference_no, "Month": r.month, "AmountReceived": money(r.amount_received), "ReceiptMode": r.receipt_mode, "BankAccount": r.bank_account, "Notes": r.notes, "CreatedAt": iso(r.created_at)} for r in q.all()]}


@router.post("/receipts")
def add_receipt(payload: dict, db: Session = Depends(get_db), llp_id: str = Depends(require_llp_id), user: User = Depends(current_user)):
    item = Receipt(id=payload.get("ReceiptID") or make_id("REC"), llp_id=llp_id, receipt_date=parse_date(payload.get("Date")), reference_type=payload.get("ReferenceType") or "", reference_no=payload.get("ReferenceNo") or "", month=payload.get("Month") or "", amount_received=dec(payload.get("AmountReceived")), receipt_mode=payload.get("ReceiptMode") or "Bank", bank_account=payload.get("BankAccount") or "", notes=payload.get("Notes") or "")
    db.add(item)
    audit(db, user.email, "receipts", "create", item.id)
    db.commit()
    return {"ok": True, "message": "Receipt saved", "data": {"ReceiptID": item.id}}


@router.get("/neo-invoices")
def neo_invoices(db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    q = db.query(NeoInvoice)
    if llp_id:
        q = q.filter(NeoInvoice.llp_id == llp_id)
    return {"ok": True, "data": [serialize_neo_invoice(r) for r in q.order_by(NeoInvoice.invoice_date.desc(), NeoInvoice.created_at.desc()).all()]}


@router.post("/neo-invoices")
def add_neo_invoice(payload: dict, db: Session = Depends(get_db), llp_id: str = Depends(require_llp_id), user: User = Depends(current_user)):
    if not payload.get("InvoiceNo"):
        raise HTTPException(status_code=400, detail="InvoiceNo is required")
    if not payload.get("BillingMonth"):
        raise HTTPException(status_code=400, detail="BillingMonth is required")
    existing = db.query(NeoInvoice).filter(NeoInvoice.llp_id == llp_id, NeoInvoice.invoice_no == payload["InvoiceNo"]).first()
    if existing:
        raise HTTPException(status_code=409, detail="Invoice number already exists")
    item = create_neo_invoice(db, payload, llp_id)
    audit(db, user.email, "neoinvoices", "create", item.id)
    db.commit()
    return {"ok": True, "message": "NeoInvoice saved", "data": serialize_neo_invoice(item)}


@router.put("/neo-invoices/{id}")
def update_neo_invoice(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(NeoInvoice, id)
    if not item:
        raise HTTPException(status_code=404, detail="NeoInvoice not found")
    if payload.get("InvoiceNo") and payload["InvoiceNo"] != item.invoice_no:
        duplicate = db.query(NeoInvoice).filter(NeoInvoice.llp_id == item.llp_id, NeoInvoice.invoice_no == payload["InvoiceNo"], NeoInvoice.id != id).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Invoice number already exists")
    apply_neo_invoice_payload(db, item, payload, item.llp_id)
    audit(db, user.email, "neoinvoices", "update", id)
    db.commit()
    return {"ok": True, "message": "NeoInvoice updated", "data": serialize_neo_invoice(item)}


@router.put("/receipts/{id}")
def update_receipt(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Receipt, id)
    if not item:
        raise HTTPException(status_code=404, detail="Receipt not found")
    item.amount_received = dec(payload.get("AmountReceived", item.amount_received))
    item.notes = payload.get("Notes", item.notes)
    audit(db, user.email, "receipts", "update", id)
    db.commit()
    return {"ok": True}


@router.delete("/receipts/{id}")
def delete_receipt(id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(Receipt, id)
    if not item:
        raise HTTPException(status_code=404, detail="Receipt not found")
    db.delete(item)
    audit(db, user.email, "receipts", "delete", id)
    db.commit()
    return {"ok": True}


@router.get("/bank-accounts")
def bank_accounts(db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    q = db.query(BankAccount)
    if llp_id:
        q = q.filter(BankAccount.llp_id == llp_id)
    return {"ok": True, "data": [{"AccountID": a.id, "LLPID": a.llp_id, "LLPName": llp_name(db, a.llp_id), "AccountName": a.account_name, "BankName": a.bank_name, "AccountNumber": a.account_number, "IFSC": a.ifsc, "AccountType": a.account_type, "Branch": a.branch, "OpeningBalance": money(a.opening_balance), "CurrentBalance": money(a.current_balance), "IsActive": "Yes" if a.is_active else "No", "Notes": a.notes, "CreatedAt": iso(a.created_at), "UpdatedAt": iso(a.updated_at)} for a in q.all()]}


@router.post("/bank-accounts")
def add_bank(payload: dict, db: Session = Depends(get_db), llp_id: str = Depends(require_llp_id), user: User = Depends(current_user)):
    item = BankAccount(id=payload.get("AccountID") or make_id("BANK"), llp_id=llp_id, account_name=payload.get("AccountName") or "", bank_name=payload.get("BankName") or "", account_number=str(payload.get("AccountNumber") or ""), ifsc=payload.get("IFSC") or "", account_type=payload.get("AccountType") or "Current", branch=payload.get("Branch") or "", opening_balance=dec(payload.get("OpeningBalance")), current_balance=dec(payload.get("CurrentBalance") or payload.get("OpeningBalance")), is_active=not str(payload.get("IsActive", "Yes")).lower().startswith("n"), notes=payload.get("Notes") or "")
    db.add(item)
    audit(db, user.email, "bankaccounts", "create", item.id)
    db.commit()
    return {"ok": True, "data": {"AccountID": item.id}}


@router.put("/bank-accounts/{id}")
def update_bank(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(BankAccount, id)
    if not item:
        raise HTTPException(status_code=404, detail="Bank account not found")
    if "CurrentBalance" in payload:
        item.current_balance = dec(payload["CurrentBalance"])
    if "Notes" in payload:
        item.notes = payload["Notes"]
    audit(db, user.email, "bankaccounts", "update", id)
    db.commit()
    return {"ok": True}


@router.get("/cash-book")
def cash_book(db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    q = db.query(CashBookEntry)
    if llp_id:
        q = q.filter(CashBookEntry.llp_id == llp_id)
    return {"ok": True, "data": [{"EntryID": c.id, "LLPID": c.llp_id, "LLPName": llp_name(db, c.llp_id), "Date": iso(c.entry_date), "Type": c.entry_type, "OpeningBalance": money(c.opening_balance), "AmountIn": money(c.amount_in), "AmountOut": money(c.amount_out), "ClosingBalance": money(c.closing_balance), "ReferenceType": c.reference_type, "ReferenceID": c.reference_id, "Description": c.description, "PaidBy": c.paid_by, "CreatedAt": iso(c.created_at)} for c in q.order_by(CashBookEntry.created_at).all()]}


@router.post("/cash-book")
def add_cash(payload: dict, db: Session = Depends(get_db), llp_id: str = Depends(require_llp_id), user: User = Depends(current_user)):
    opening = dec(payload.get("OpeningBalance")) if payload.get("OpeningBalance") not in (None, "") else latest_cash_balance(db, llp_id)
    amount_in = dec(payload.get("AmountIn"))
    amount_out = dec(payload.get("AmountOut"))
    item = CashBookEntry(id=payload.get("EntryID") or make_id("CASH"), llp_id=llp_id, entry_date=parse_date(payload.get("Date")), entry_type=payload.get("Type") or "Payment", opening_balance=opening, amount_in=amount_in, amount_out=amount_out, closing_balance=opening + amount_in - amount_out, reference_type=payload.get("ReferenceType") or "Manual", reference_id=payload.get("ReferenceID") or "", description=payload.get("Description") or "", paid_by=payload.get("PaidBy") or "")
    db.add(item)
    audit(db, user.email, "cashbook", "create", item.id)
    db.commit()
    return {"ok": True, "data": {"EntryID": item.id}}


@router.put("/cash-book/{id}")
def update_cash(id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(CashBookEntry, id)
    if not item:
        raise HTTPException(status_code=404, detail="Cash entry not found")
    item.amount_in = dec(payload.get("AmountIn", item.amount_in))
    item.amount_out = dec(payload.get("AmountOut", item.amount_out))
    item.closing_balance = dec(item.opening_balance) + dec(item.amount_in) - dec(item.amount_out)
    audit(db, user.email, "cashbook", "update", id)
    db.commit()
    return {"ok": True}


@router.delete("/cash-book/{id}")
def delete_cash(id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = db.get(CashBookEntry, id)
    if not item:
        raise HTTPException(status_code=404, detail="Cash entry not found")
    db.delete(item)
    audit(db, user.email, "cashbook", "delete", id)
    db.commit()
    return {"ok": True}


@router.get("/reports/dashboard")
def dashboard(db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    expenses = db.query(Expense).filter(Expense.llp_id == llp_id).all() if llp_id else db.query(Expense).all()
    payables = db.query(LLPPayable).filter(LLPPayable.llp_id == llp_id).all() if llp_id else db.query(LLPPayable).all()
    receipts = db.query(Receipt).filter(Receipt.llp_id == llp_id).all() if llp_id else db.query(Receipt).all()
    banks = db.query(BankAccount).filter(BankAccount.llp_id == llp_id).all() if llp_id else db.query(BankAccount).all()
    summary = {
        "expenses_total": money(sum(dec(e.amount) for e in expenses)),
        "approved_expenses_total": money(sum(dec(e.amount) for e in expenses if e.status == "Approved")),
        "pending_reimbursements_total": money(sum(dec(e.amount) for e in expenses if e.status in {"Draft", "Submitted", "Approved"})),
        "reimbursed_total": money(sum(dec(e.amount) for e in expenses if e.status == "Reimbursed")),
        "pending_payables_total": money(sum(max(dec(p.net_payable) - dec(p.paid_amount), Decimal("0.00")) for p in payables)),
        "paid_payables_total": money(sum(dec(p.paid_amount) for p in payables)),
        "receipts_total": money(sum(dec(r.amount_received) for r in receipts)),
        "petty_cash_balance": money(latest_cash_balance(db, llp_id)) if llp_id else 0,
        "bank_balance_total": money(sum(dec(b.current_balance) for b in banks if b.is_active)),
    }
    return {"ok": True, "summary": summary, "payables": [serialize_payable(db, p) for p in payables[:10]], "bankAccounts": []}


@router.get("/reports/reconciliation")
def reconciliation(format: str = Query("json"), db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    rows = [serialize_payable(db, p) for p in (db.query(LLPPayable).filter(LLPPayable.llp_id == llp_id).all() if llp_id else db.query(LLPPayable).all())]
    data = [{"BillNo": r["BillNo"], "BillMonth": r["BillDate"][:7], "VendorName": r["VendorName"], "GSTMode": "With GST" if r["GSTAmount"] else "Without GST", "GrossAmount": r["GrossAmount"], "TDSDeducted": r["TDSAmount"], "NetPayable": r["NetPayable"], "PaidAmount": r["PaidAmount"], "BalanceAmount": r["BalanceAmount"], "Status": r["Status"]} for r in rows]
    return export_rows(data, format, "reconciliation")


@router.get("/reports/ca-tds")
def ca_tds(format: str = Query("json"), db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    rows = [serialize_payable(db, p) for p in (db.query(LLPPayable).filter(LLPPayable.llp_id == llp_id).all() if llp_id else db.query(LLPPayable).all()) if dec(p.tds_amount) > 0]
    data = [{"S No.": i + 1, "Deductee Name": r["VendorName"], "PAN of  Deductee": r["VendorPAN"], "Nature of Payment": r["ExpenseType"], "Section": r["TDSSection"], "Date of Payment/ Credit": r["PaymentDate"] or r["BillDate"], "Amount Paid/ Credited": r["TaxableAmount"], "Rate of TDS (%)": r["TDSRate"], "Tax Deducted": r["TDSAmount"], "Interest, If any": r["InterestAmount"], "Total Amount Paid": r["TDSAmount"] + r["InterestAmount"], "Challan No.": r["ChallanNo"], "Date of Payment": r["ChallanDate"], "Remarks": r["Notes"]} for i, r in enumerate(rows)]
    result = export_rows(data, format, "ca-tds")
    if isinstance(result, dict):
        result["headers"] = list(data[0].keys()) if data else []
    return result


@router.get("/reports/vendor-ledger")
def vendor_ledger(vendor: str = "", format: str = Query("json"), db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    q = db.query(LLPPayable)
    if llp_id:
        q = q.filter(LLPPayable.llp_id == llp_id)
    rows = [serialize_payable(db, p) for p in q.all() if not vendor or normalize_key(vendor) in normalize_key(p.vendor_name)]
    balance = Decimal("0.00")
    data = []
    for r in rows:
        balance += dec(r["NetPayable"])
        data.append({"Date": r["BillDate"], "VendorName": r["VendorName"], "Particulars": f"Bill {r['BillNo']}", "BillNo": r["BillNo"], "Debit": r["NetPayable"], "Credit": 0, "GrossAmount": r["GrossAmount"], "TDSAmount": r["TDSAmount"], "PaidAmount": 0, "Balance": money(balance), "ReferenceNo": "", "Status": r["Status"], "Notes": r["Notes"]})
        if dec(r["PaidAmount"]) > 0:
            balance -= dec(r["PaidAmount"])
            data.append({"Date": r["PaymentDate"], "VendorName": r["VendorName"], "Particulars": f"Payment against {r['BillNo']}", "BillNo": r["BillNo"], "Debit": 0, "Credit": r["PaidAmount"], "GrossAmount": 0, "TDSAmount": 0, "PaidAmount": r["PaidAmount"], "Balance": money(balance), "ReferenceNo": r["ReferenceNo"], "Status": r["Status"], "Notes": r["PaymentMode"]})
    return export_rows(data, format, "vendor-ledger")


@router.get("/reports/reimbursements")
def reimbursements(db: Session = Depends(get_db), llp_id: str | None = Depends(get_llp_id), _: User = Depends(current_user)):
    q = db.query(Expense)
    if llp_id:
        q = q.filter(Expense.llp_id == llp_id)
    return {"ok": True, "data": [{"Source": "Expense", "RefID": e.id, "Date": iso(e.expense_date), "PaidBy": e.paid_by, "Description": e.description or e.category, "BillingMonth": e.billing_month, "Amount": money(e.amount), "Status": e.status} for e in q.all() if e.paid_by]}

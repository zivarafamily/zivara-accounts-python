from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import CashBookEntry, Expense
from app.services.common import audit, dec, iso, llp_name, make_id, money, normalize_key, parse_date, yes_no


def serialize_expense(db: Session, e: Expense):
    return {
        "ExpenseID": e.id,
        "LLPID": e.llp_id,
        "LLPName": llp_name(db, e.llp_id),
        "Date": iso(e.expense_date),
        "ExpenseType": e.expense_type,
        "Category": e.category,
        "PaidBy": e.paid_by,
        "ChargeTo": e.charge_to,
        "ReimburseTo": e.reimburse_to,
        "PaymentMode": e.payment_mode,
        "TaxableValue": money(e.taxable_value),
        "CGSTAmount": money(e.cgst_amount),
        "SGSTAmount": money(e.sgst_amount),
        "IGSTAmount": money(e.igst_amount),
        "GSTAmount": money(e.gst_amount),
        "Amount": money(e.amount),
        "VendorOrPerson": e.vendor_or_person,
        "Description": e.description,
        "BillAvailable": "Yes" if e.bill_available else "No",
        "BillLink": e.bill_link,
        "EmployeeName": e.employee_name,
        "BillingMonth": e.billing_month,
        "TravelID": e.travel_id,
        "PartnerAllocations": e.partner_allocations,
        "Notes": e.notes,
        "Status": e.status,
        "ReimburseMode": e.reimburse_mode,
        "ReimburseAccount": e.reimburse_account,
        "ReimburseDate": iso(e.reimburse_date),
        "ReimburseRef": e.reimburse_ref,
        "ReimburseBy": e.reimburse_by,
        "ApprovedBy": e.approved_by,
        "ApprovedAt": iso(e.approved_at),
        "CreatedAt": iso(e.created_at),
    }


def duplicate_warning(db: Session, llp_id: str, payload: dict):
    exp_date = parse_date(payload.get("Date"))
    amount = dec(payload.get("Amount"))
    keys = {normalize_key(payload.get("PaidBy")), normalize_key(payload.get("VendorOrPerson"))} - {""}
    if not exp_date or not amount or not keys:
        return []
    rows = db.query(Expense).filter(Expense.llp_id == llp_id, Expense.expense_date == exp_date, Expense.amount == amount).all()
    return [
        serialize_expense(db, r) | {"reason": "same date, amount and payer/vendor"}
        for r in rows
        if normalize_key(r.paid_by) in keys or normalize_key(r.vendor_or_person) in keys
    ]


def create_expense(db: Session, payload: dict, llp_id: str, user_email: str):
    warning = [] if payload.get("skipDuplicateCheck") else duplicate_warning(db, llp_id, payload)
    taxable = dec(payload.get("TaxableValue"))
    cgst = dec(payload.get("CGSTAmount"))
    sgst = dec(payload.get("SGSTAmount"))
    igst = dec(payload.get("IGSTAmount"))
    gst = dec(payload.get("GSTAmount")) or (cgst + sgst + igst)
    amount = dec(payload.get("Amount")) or (taxable + gst)
    item = Expense(
        id=payload.get("ExpenseID") or make_id("EXP"),
        llp_id=llp_id,
        expense_date=parse_date(payload.get("Date")),
        expense_type=payload.get("ExpenseType") or "Misc",
        category=payload.get("Category") or "",
        paid_by=payload.get("PaidBy") or "",
        charge_to=payload.get("ChargeTo") or "",
        reimburse_to=payload.get("ReimburseTo") or "",
        payment_mode=payload.get("PaymentMode") or "Cash",
        taxable_value=taxable,
        cgst_amount=cgst,
        sgst_amount=sgst,
        igst_amount=igst,
        gst_amount=gst,
        amount=amount,
        vendor_or_person=payload.get("VendorOrPerson") or "",
        description=payload.get("Description") or "",
        bill_available=yes_no(payload.get("BillAvailable")),
        bill_link=payload.get("BillLink") or "",
        employee_name=payload.get("EmployeeName") or "",
        billing_month=payload.get("BillingMonth") or "",
        travel_id=payload.get("TravelID") or "",
        partner_allocations=payload.get("PartnerAllocations") or "",
        notes=payload.get("Notes") or "",
        status=payload.get("Status") or "Draft",
    )
    db.add(item)
    audit(db, user_email, "expenses", "create", item.id)
    db.commit()
    db.refresh(item)
    response = {"ok": True, "message": "Expense saved", "data": serialize_expense(db, item)}
    if warning:
        response.update({"duplicateWarning": True, "matches": warning})
    return response


def latest_cash_balance(db: Session, llp_id: str):
    row = db.query(CashBookEntry).filter(CashBookEntry.llp_id == llp_id).order_by(CashBookEntry.created_at.desc()).first()
    return dec(row.closing_balance) if row else Decimal("0.00")


def reimburse_expense(db: Session, expense_id: str, payload: dict, llp_id: str, user_email: str):
    exp = db.get(Expense, expense_id)
    if not exp or exp.llp_id != llp_id:
        raise HTTPException(status_code=404, detail="Expense not found")
    if exp.status not in {"Approved", "Reimbursed"} and not payload.get("force"):
        raise HTTPException(status_code=400, detail="Expense must be approved before reimbursement")
    exp.status = "Reimbursed"
    exp.reimburse_mode = payload.get("ReimburseMode") or payload.get("ReimburseAccount") or ""
    exp.reimburse_account = payload.get("ReimburseAccount") or payload.get("ReimburseMode") or ""
    exp.reimburse_date = parse_date(payload.get("ReimburseDate")) or datetime.now(timezone.utc).date()
    exp.reimburse_ref = payload.get("ReimburseRef") or ""
    exp.reimburse_by = payload.get("ReimburseBy") or user_email
    if exp.reimburse_account == "Petty Cash" or exp.reimburse_mode == "Petty Cash":
        opening = latest_cash_balance(db, llp_id)
        closing = opening - dec(exp.amount)
        db.add(CashBookEntry(
            id=make_id("CASH"),
            llp_id=llp_id,
            entry_date=exp.reimburse_date,
            entry_type="Payment",
            opening_balance=opening,
            amount_in=0,
            amount_out=exp.amount,
            closing_balance=closing,
            reference_type="Expense Reimbursement",
            reference_id=exp.id,
            description=f"Reimbursement: {exp.description or exp.id}",
            paid_by=exp.reimburse_by,
        ))
        audit(db, user_email, "cashbook", "create", exp.id, "Petty cash reimbursement")
    audit(db, user_email, "expenses", "reimburse", exp.id)
    db.commit()
    return {"ok": True, "message": "Expense reimbursed", "data": serialize_expense(db, exp)}

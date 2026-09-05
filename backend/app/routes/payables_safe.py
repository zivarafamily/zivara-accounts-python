"""Safe payable routes used ahead of the legacy core routes.

The only semantic change is TDS handling:
TDSDeductedAmount changes ONLY when explicitly supplied by the caller.
Paying a vendor bill never auto-marks TDS as paid/filed.

The router is included before core.router, so these matching payable endpoints
win without modifying the large core.py file.
"""
from datetime import datetime, timezone
from decimal import Decimal
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user, get_llp_id, require_llp_id
from app.models import LLPPayable, User
from app.services.common import audit, dec, normalize_key, parse_date
from app.services.payables import (
    calculate_amounts,
    create_payable,
    is_company_paid,
    normalize_line_items,
    normalize_tds_section,
    payable_reimbursement_status,
    payable_status,
    serialize_payable,
    tax_breakdown,
)

router = APIRouter(tags=["payables-safe"])


def _vendor_batch_key(item: LLPPayable) -> str:
    compact_name = re.sub(r"[^a-z0-9]", "", normalize_key(item.vendor_name))
    return compact_name or item.vendor_id or ""


def _explicit_tds_paid(payload: dict, current) -> Decimal:
    if "TDSDeductedAmount" not in payload:
        return dec(current)
    return max(dec(payload.get("TDSDeductedAmount")), Decimal("0.00"))


@router.post("/payables")
def add_payable_safe(
    payload: dict,
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(current_user),
):
    # Reuse the mature creation logic, then immediately restore explicit-only
    # TDS-paid semantics. This second commit also rewrites the purchase journal
    # through payables_roundoff v3.
    data = create_payable(db, payload, llp_id, user.email)
    item = db.get(LLPPayable, data["PayableID"])
    desired = max(dec(payload.get("TDSDeductedAmount")), Decimal("0.00")) if "TDSDeductedAmount" in payload else Decimal("0.00")
    if dec(item.tds_deducted_amount) != desired:
        item.tds_deducted_amount = desired
        audit(db, user.email, "payables", "tds-explicit-create", item.id)
        db.commit()
        db.refresh(item)
    return {"ok": True, "message": "Payable saved", "data": serialize_payable(db, item)}


@router.put("/payables/{id}")
def update_payable_safe(
    id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    item = db.get(LLPPayable, id)
    if not item:
        raise HTTPException(status_code=404, detail="Payable not found")

    merged = serialize_payable(db, item) | payload
    taxable, gst, gross, tds_rate, tds, net = calculate_amounts(merged)
    cgst, sgst, igst, gst, tcs = tax_breakdown(merged)

    if "VendorName" in payload:
        item.vendor_name = payload.get("VendorName") or ""
    if "BillNo" in payload:
        item.bill_no = payload.get("BillNo") or ""
    item.normalized_bill_no = normalize_key(item.bill_no)
    if "BillDate" in payload:
        item.bill_date = parse_date(payload.get("BillDate"))
    if "DueDate" in payload:
        item.due_date = parse_date(payload.get("DueDate"))
    if "VendorID" in payload:
        item.vendor_id = payload.get("VendorID") or None
    if "VendorCategory" in payload:
        item.vendor_category = payload.get("VendorCategory") or ""
    if "VendorGSTIN" in payload:
        item.vendor_gstin = payload.get("VendorGSTIN") or ""
    if "VendorPAN" in payload:
        item.vendor_pan = payload.get("VendorPAN") or ""
    if "ExpenseType" in payload:
        item.expense_type = payload.get("ExpenseType") or ""
    if "Description" in payload:
        item.description = payload.get("Description") or ""

    item.taxable_amount, item.cgst_amount, item.sgst_amount, item.igst_amount = (
        taxable,
        cgst,
        sgst,
        igst,
    )
    item.gst_amount, item.tcs_amount, item.gross_amount = gst, tcs, gross
    item.line_items = normalize_line_items(merged.get("LineItems"))
    item.tds_section = normalize_tds_section(
        merged.get("TDSSection"),
        tds_rate,
        merged.get("VendorCategory") or item.vendor_category,
    )
    item.tds_rate = tds_rate
    item.tds_amount = tds
    item.tds_deducted_amount = _explicit_tds_paid(payload, item.tds_deducted_amount)
    item.net_payable = net

    item.paid_amount = dec(merged.get("PaidAmount"))
    item.status = payable_status(net, item.paid_amount, merged.get("Status"))

    if "PaymentDate" in payload:
        item.payment_date = parse_date(payload.get("PaymentDate"))
    if "PaymentMode" in payload:
        item.payment_mode = payload.get("PaymentMode") or ""
    if "BankAccount" in payload:
        item.bank_account = payload.get("BankAccount") or ""
    if "ReferenceNo" in payload:
        item.reference_no = payload.get("ReferenceNo") or ""
    if "PaidByType" in payload:
        item.paid_by_type = payload.get("PaidByType") or "Company"
    if "PaidByName" in payload:
        item.paid_by_name = payload.get("PaidByName") or ""
    if "ReimburseTo" in payload or "SettlementTo" in payload:
        item.reimburse_to = payload.get("ReimburseTo") or payload.get("SettlementTo") or ""

    if "ReimbursementStatus" in payload:
        item.reimbursement_status = payload.get("ReimbursementStatus") or payable_reimbursement_status(
            item.paid_by_type, item.paid_amount
        )
    elif any(
        key in payload
        for key in ("PaidByType", "PaidByName", "ReimburseTo", "SettlementTo", "PaidAmount")
    ):
        if not item.paid_by_name and is_company_paid(item.paid_by_type) and dec(item.paid_amount) > 0:
            item.paid_by_name = "Company"
        if not item.reimburse_to and not is_company_paid(item.paid_by_type):
            item.reimburse_to = item.paid_by_name
        item.reimbursement_status = payable_reimbursement_status(
            item.paid_by_type, item.paid_amount, item.reimbursement_status
        )

    if "ReimbursementDate" in payload:
        item.reimbursement_date = parse_date(payload.get("ReimbursementDate"))
    if "ReimbursementRef" in payload:
        item.reimbursement_ref = payload.get("ReimbursementRef") or ""
    if "ChallanNo" in payload:
        item.challan_no = payload.get("ChallanNo") or ""
    if "ChallanDate" in payload:
        item.challan_date = parse_date(payload.get("ChallanDate"))
    item.interest_amount = dec(merged.get("InterestAmount"))
    if "Notes" in payload:
        item.notes = payload.get("Notes") or ""

    audit(db, user.email, "payables", "update-safe-tds", id)
    db.commit()
    db.refresh(item)
    return {"ok": True, "message": "Payable updated", "data": serialize_payable(db, item)}


@router.post("/payables/batch-payment")
def batch_payables_safe(
    payload: dict,
    db: Session = Depends(get_db),
    llp_id: str | None = Depends(get_llp_id),
    user: User = Depends(current_user),
):
    payable_ids = payload.get("PayableIDs") or []
    if not isinstance(payable_ids, list) or not payable_ids:
        raise HTTPException(status_code=400, detail="PayableIDs are required")

    q = db.query(LLPPayable).filter(LLPPayable.id.in_(payable_ids))
    if llp_id:
        q = q.filter(LLPPayable.llp_id == llp_id)
    rows = q.all()
    if len(rows) != len(set(payable_ids)):
        raise HTTPException(status_code=404, detail="One or more payable bills were not found")
    if len({_vendor_batch_key(item) for item in rows}) > 1:
        raise HTTPException(status_code=400, detail="Batch payment can include only one vendor")

    payment_date = parse_date(payload.get("PaymentDate")) or datetime.now(timezone.utc).date()
    payment_mode = payload.get("PaymentMode") or "Bank"
    bank_account = payload.get("BankAccount") or ""
    reference_no = payload.get("ReferenceNo") or ""
    paid_by_type = payload.get("PaidByType") or "Company"
    paid_by_name = payload.get("PaidByName") or (
        "Company" if is_company_paid(paid_by_type) else ""
    )
    reimburse_to = payload.get("ReimburseTo") or payload.get("SettlementTo") or (
        paid_by_name if not is_company_paid(paid_by_type) else ""
    )
    pay_gross = str(payload.get("TDSMode") or "").strip() == "gross_pending_tds"

    payable_rows = sorted(
        (item for item in rows if item.status != "Cancelled"),
        key=lambda item: (
            item.normalized_bill_no or normalize_key(item.bill_no),
            item.bill_date or datetime.min.date(),
        ),
    )

    def payment_target(item):
        return dec(item.gross_amount) if pay_gross else dec(item.net_payable)

    total_balance = sum(
        max(payment_target(item) - dec(item.paid_amount), Decimal("0.00"))
        for item in payable_rows
    )
    requested_paid = (
        dec(payload.get("PaidAmount"))
        if payload.get("PaidAmount") not in (None, "")
        else total_balance
    )
    if requested_paid <= 0:
        raise HTTPException(status_code=400, detail="PaidAmount must be greater than zero")
    if requested_paid > total_balance:
        raise HTTPException(
            status_code=400,
            detail=f"PaidAmount cannot exceed selected balance of {total_balance}",
        )

    remaining = requested_paid
    paid_rows = []
    for item in payable_rows:
        balance = max(payment_target(item) - dec(item.paid_amount), Decimal("0.00"))
        if balance <= 0:
            continue
        applied = min(balance, remaining)
        if applied <= 0:
            break
        item.paid_amount = dec(item.paid_amount) + applied
        item.payment_date = payment_date
        item.payment_mode = payment_mode
        item.bank_account = bank_account
        item.reference_no = reference_no
        item.paid_by_type = paid_by_type
        item.paid_by_name = paid_by_name
        item.reimburse_to = reimburse_to
        item.reimbursement_status = payable_reimbursement_status(
            paid_by_type, item.paid_amount, item.reimbursement_status
        )
        # CRITICAL: do not alter tds_deducted_amount here.
        item.status = payable_status(item.net_payable, item.paid_amount)
        audit(db, user.email, "payables", "batch-payment-safe-tds", item.id)
        paid_rows.append(item)
        remaining -= applied

    db.commit()
    return {
        "ok": True,
        "message": f"{len(paid_rows)} payable bill(s) marked paid",
        "paidCount": len(paid_rows),
        "paidAmount": float(requested_paid - remaining),
        "data": [serialize_payable(db, item) for item in paid_rows],
    }


@router.post("/payables/{id}/mark-paid")
def mark_paid_safe(
    id: str,
    payload: dict,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    item = db.get(LLPPayable, id)
    if not item:
        raise HTTPException(status_code=404, detail="Payable not found")

    pay_gross = str(payload.get("TDSMode") or "").strip() == "gross_pending_tds"
    item.paid_amount = dec(payload.get("PaidAmount")) or (
        dec(item.gross_amount) if pay_gross else dec(item.net_payable)
    )
    item.payment_date = parse_date(payload.get("PaymentDate")) or datetime.now(timezone.utc).date()
    item.payment_mode = payload.get("PaymentMode") or item.payment_mode
    item.bank_account = payload.get("BankAccount") or item.bank_account
    item.reference_no = payload.get("ReferenceNo") or item.reference_no
    item.paid_by_type = payload.get("PaidByType") or item.paid_by_type or "Company"
    item.paid_by_name = payload.get("PaidByName") or item.paid_by_name or (
        "Company" if is_company_paid(item.paid_by_type) else ""
    )
    item.reimburse_to = payload.get("ReimburseTo") or payload.get("SettlementTo") or item.reimburse_to or (
        item.paid_by_name if not is_company_paid(item.paid_by_type) else ""
    )
    item.reimbursement_status = payload.get("ReimbursementStatus") or payable_reimbursement_status(
        item.paid_by_type, item.paid_amount, item.reimbursement_status
    )
    if "TDSDeductedAmount" in payload:
        item.tds_deducted_amount = max(dec(payload.get("TDSDeductedAmount")), Decimal("0.00"))
    item.status = payable_status(item.net_payable, item.paid_amount)
    audit(db, user.email, "payables", "payment-safe-tds", id)
    db.commit()
    return {"ok": True, "message": "Payable marked paid"}

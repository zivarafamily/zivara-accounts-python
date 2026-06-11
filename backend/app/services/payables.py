from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import LLPPayable, Vendor
from app.services.common import audit, dec, iso, llp_name, make_id, money, normalize_key, parse_date


def calculate_amounts(payload: dict):
    taxable = dec(payload.get("TaxableAmount") or payload.get("taxable_amount"))
    gst = dec(payload.get("GSTAmount") or payload.get("gst_amount"))
    gross = dec(payload.get("GrossAmount") or payload.get("Amount") or payload.get("gross_amount"))
    if not gross:
        gross = taxable + gst
    if not taxable and gross:
        taxable = max(gross - gst, Decimal("0.00"))
    tds_rate = dec(payload.get("TDSRate") or payload.get("tds_rate"))
    tds = dec(payload.get("TDSAmount") or payload.get("tds_amount"))
    if not tds and tds_rate:
        tds = (taxable * tds_rate / Decimal("100")).quantize(Decimal("0.01"))
    net = max(gross - tds, Decimal("0.00"))
    return taxable, gst, gross, tds_rate, tds, net


def payable_status(net, paid, current=""):
    if str(current or "") == "Cancelled":
        return "Cancelled"
    net = dec(net)
    paid = dec(paid)
    if paid >= net and net > 0:
        return "Paid"
    if paid > 0:
        return "Part Paid"
    return "Pending"


def serialize_payable(db: Session, p: LLPPayable):
    balance = max(dec(p.net_payable) - dec(p.paid_amount), Decimal("0.00"))
    return {
        "PayableID": p.id,
        "LLPID": p.llp_id,
        "LLPName": llp_name(db, p.llp_id),
        "VendorID": p.vendor_id or "",
        "VendorName": p.vendor_name,
        "VendorCategory": p.vendor_category,
        "VendorGSTIN": p.vendor_gstin,
        "VendorPAN": p.vendor_pan,
        "BillNo": p.bill_no,
        "BillDate": iso(p.bill_date),
        "DueDate": iso(p.due_date),
        "ExpenseType": p.expense_type,
        "Description": p.description,
        "TaxableAmount": money(p.taxable_amount),
        "GSTAmount": money(p.gst_amount),
        "GrossAmount": money(p.gross_amount),
        "TDSSection": p.tds_section,
        "TDSRate": money(p.tds_rate),
        "TDSAmount": money(p.tds_amount),
        "NetPayable": money(p.net_payable),
        "PaidAmount": money(p.paid_amount),
        "BalanceAmount": money(balance),
        "PaymentDate": iso(p.payment_date),
        "PaymentMode": p.payment_mode,
        "BankAccount": p.bank_account,
        "ReferenceNo": p.reference_no,
        "ChallanNo": p.challan_no,
        "ChallanDate": iso(p.challan_date),
        "InterestAmount": money(p.interest_amount),
        "Status": payable_status(p.net_payable, p.paid_amount, p.status),
        "Notes": p.notes,
        "CreatedAt": iso(p.created_at),
        "UpdatedAt": iso(p.updated_at),
    }


def create_payable(db: Session, payload: dict, llp_id: str, user_email: str):
    bill_no = normalize_key(payload.get("BillNo"))
    vendor_id = payload.get("VendorID") or None
    if not vendor_id:
        vendor = db.query(Vendor).filter(Vendor.llp_id == llp_id, Vendor.vendor_name == payload.get("VendorName", "")).first()
        vendor_id = vendor.id if vendor else None
    if vendor_id and bill_no:
        exists = db.query(LLPPayable).filter(
            LLPPayable.llp_id == llp_id,
            LLPPayable.vendor_id == vendor_id,
            LLPPayable.normalized_bill_no == bill_no,
        ).first()
        if exists:
            raise HTTPException(status_code=409, detail="Duplicate payable bill already exists")
    taxable, gst, gross, tds_rate, tds, net = calculate_amounts(payload)
    paid = dec(payload.get("PaidAmount"))
    item = LLPPayable(
        id=payload.get("PayableID") or make_id("PAY"),
        llp_id=llp_id,
        vendor_id=vendor_id,
        vendor_name=payload.get("VendorName") or "",
        vendor_category=payload.get("VendorCategory") or "",
        vendor_gstin=payload.get("VendorGSTIN") or "",
        vendor_pan=payload.get("VendorPAN") or "",
        bill_no=payload.get("BillNo") or "",
        normalized_bill_no=bill_no,
        bill_date=parse_date(payload.get("BillDate")),
        due_date=parse_date(payload.get("DueDate")),
        expense_type=payload.get("ExpenseType") or "Vendor Bill",
        description=payload.get("Description") or "",
        taxable_amount=taxable,
        gst_amount=gst,
        gross_amount=gross,
        tds_section=payload.get("TDSSection") or "",
        tds_rate=tds_rate,
        tds_amount=tds,
        net_payable=net,
        paid_amount=paid,
        payment_date=parse_date(payload.get("PaymentDate")),
        payment_mode=payload.get("PaymentMode") or "Bank",
        bank_account=payload.get("BankAccount") or "",
        reference_no=payload.get("ReferenceNo") or "",
        challan_no=payload.get("ChallanNo") or "",
        challan_date=parse_date(payload.get("ChallanDate")),
        interest_amount=dec(payload.get("InterestAmount")),
        status=payable_status(net, paid, payload.get("Status")),
        notes=payload.get("Notes") or "",
    )
    db.add(item)
    audit(db, user_email, "payables", "create", item.id)
    db.commit()
    db.refresh(item)
    return serialize_payable(db, item)

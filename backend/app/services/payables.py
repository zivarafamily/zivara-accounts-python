import json
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import LLPPayable, Vendor
from app.services.common import audit, dec, iso, llp_name, make_id, money, normalize_key, parse_date


TDS_SECTION_LABELS = {
    "393(1)-6(i)-1": "393(1) Table 6(i) - Contractor, individual/HUF payee (old 194C) - 1%",
    "393(1)-6(i)-2": "393(1) Table 6(i) - Contractor / travel operator, other payee (old 194C) - 2%",
    "393(1)-6(iii)-10": "393(1) Table 6(iii) - Professional fees / CA / consultancy (old 194J) - 10%",
    "393(1)-6(iii)-2": "393(1) Table 6(iii) - Technical fees / call centre / certain royalty (old 194J) - 2%",
    "393(1)-2(ii)-10": "393(1) Table 2(ii) - Rent: land/building/furniture/fittings (old 194I) - 10%",
    "393(1)-2(ii)-2": "393(1) Table 2(ii) - Rent: plant/machinery/equipment (old 194I) - 2%",
    "393(1)-8(ii)": "393(1) Table 8(ii) - Purchase of goods over threshold (old 194Q) - 0.1%",
}


def normalize_tds_section(section: object, tds_rate: object = None, category: str = "") -> str:
    raw = str(section or "").strip()
    if not raw:
        return ""
    if raw in TDS_SECTION_LABELS:
        return raw

    key = raw.upper().replace(" ", "").replace("-", "")
    rate = dec(tds_rate)
    category_key = normalize_key(category)
    if key.startswith("194C"):
        return "393(1)-6(i)-1" if rate == Decimal("1") else "393(1)-6(i)-2"
    if key.startswith("194J"):
        return "393(1)-6(iii)-2" if rate == Decimal("2") else "393(1)-6(iii)-10"
    if key.startswith("194I"):
        return "393(1)-2(ii)-2" if "machinery" in category_key or "equipment" in category_key else "393(1)-2(ii)-10"
    if key.startswith("194Q"):
        return "393(1)-8(ii)"
    return raw


def calculate_amounts(payload: dict):
    taxable = dec(payload.get("TaxableAmount") or payload.get("taxable_amount"))
    cgst = dec(payload.get("CGSTAmount") or payload.get("cgst_amount"))
    sgst = dec(payload.get("SGSTAmount") or payload.get("sgst_amount"))
    igst = dec(payload.get("IGSTAmount") or payload.get("igst_amount"))
    gst = dec(payload.get("GSTAmount") or payload.get("gst_amount"))
    if not gst:
        gst = cgst + sgst + igst
    tcs = dec(payload.get("TCSAmount") or payload.get("tcs_amount"))
    gross = dec(payload.get("GrossAmount") or payload.get("Amount") or payload.get("gross_amount"))
    if not gross:
        gross = taxable + gst + tcs
    if not taxable and gross:
        taxable = max(gross - gst - tcs, Decimal("0.00"))
    tds_rate = dec(payload.get("TDSRate") or payload.get("tds_rate"))
    tds = dec(payload.get("TDSAmount") or payload.get("tds_amount"))
    if not tds and tds_rate:
        tds = (taxable * tds_rate / Decimal("100")).quantize(Decimal("0.01"))
    net = max(gross - tds, Decimal("0.00"))
    return taxable, gst, gross, tds_rate, tds, net


def tax_breakdown(payload: dict):
    cgst = dec(payload.get("CGSTAmount") or payload.get("cgst_amount"))
    sgst = dec(payload.get("SGSTAmount") or payload.get("sgst_amount"))
    igst = dec(payload.get("IGSTAmount") or payload.get("igst_amount"))
    gst = dec(payload.get("GSTAmount") or payload.get("gst_amount"))
    if not gst:
        gst = cgst + sgst + igst
    elif not (cgst or sgst or igst):
        igst = gst
    tcs = dec(payload.get("TCSAmount") or payload.get("tcs_amount"))
    return cgst, sgst, igst, gst, tcs


def normalize_line_items(value):
    if not value:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, separators=(",", ":"))
    except TypeError:
        return ""


def parse_line_items(value):
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except (TypeError, ValueError):
        return []


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


def is_company_paid(paid_by_type: object) -> bool:
    return normalize_key(paid_by_type or "Company") == "company"


def payable_reimbursement_status(paid_by_type: object, paid_amount: object, current: object = "") -> str:
    current = str(current or "").strip()
    if current == "Reimbursed":
        return "Reimbursed"
    if is_company_paid(paid_by_type):
        return "Not Required"
    return "Pending" if dec(paid_amount) > 0 else ""


def serialize_payable(db: Session, p: LLPPayable):
    balance = max(dec(p.net_payable) - dec(p.paid_amount), Decimal("0.00"))
    tds_pending = max(dec(p.tds_amount) - dec(p.tds_deducted_amount), Decimal("0.00"))
    tds_section = normalize_tds_section(p.tds_section, p.tds_rate, p.vendor_category)
    paid_by_type = p.paid_by_type or "Company"
    paid_by_name = p.paid_by_name or ("Company" if is_company_paid(paid_by_type) and dec(p.paid_amount) > 0 else "")
    reimburse_to = p.reimburse_to or (paid_by_name if not is_company_paid(paid_by_type) else "")
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
        "CGSTAmount": money(p.cgst_amount),
        "SGSTAmount": money(p.sgst_amount),
        "IGSTAmount": money(p.igst_amount),
        "GSTAmount": money(p.gst_amount),
        "TCSAmount": money(p.tcs_amount),
        "GrossAmount": money(p.gross_amount),
        "LineItems": parse_line_items(p.line_items),
        "TDSSection": tds_section,
        "TDSSectionRaw": p.tds_section,
        "TDSSectionLabel": TDS_SECTION_LABELS.get(tds_section, tds_section),
        "TDSRate": money(p.tds_rate),
        "TDSAmount": money(p.tds_amount),
        "TDSDeductedAmount": money(p.tds_deducted_amount),
        "TDSPendingAmount": money(tds_pending),
        "NetPayable": money(p.net_payable),
        "PaidAmount": money(p.paid_amount),
        "BalanceAmount": money(balance),
        "PaymentDate": iso(p.payment_date),
        "PaymentMode": p.payment_mode,
        "BankAccount": p.bank_account,
        "ReferenceNo": p.reference_no,
        "PaidByType": paid_by_type,
        "PaidByName": paid_by_name,
        "ReimburseTo": reimburse_to,
        "SettlementTo": reimburse_to,
        "ReimbursementStatus": p.reimbursement_status or payable_reimbursement_status(paid_by_type, p.paid_amount),
        "ReimbursementDate": iso(p.reimbursement_date),
        "ReimbursementRef": p.reimbursement_ref,
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
    cgst, sgst, igst, gst, tcs = tax_breakdown(payload)
    paid = dec(payload.get("PaidAmount"))
    tds_deducted = dec(payload.get("TDSDeductedAmount"))
    if paid > 0 and not tds_deducted:
        tds_deducted = tds
    paid_by_type = payload.get("PaidByType") or ("Company" if paid > 0 else "")
    paid_by_name = payload.get("PaidByName") or ("Company" if is_company_paid(paid_by_type) and paid > 0 else "")
    reimburse_to = payload.get("ReimburseTo") or payload.get("SettlementTo") or (paid_by_name if not is_company_paid(paid_by_type) else "")
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
        cgst_amount=cgst,
        sgst_amount=sgst,
        igst_amount=igst,
        gst_amount=gst,
        tcs_amount=tcs,
        gross_amount=gross,
        line_items=normalize_line_items(payload.get("LineItems")),
        tds_section=normalize_tds_section(payload.get("TDSSection"), tds_rate, payload.get("VendorCategory") or ""),
        tds_rate=tds_rate,
        tds_amount=tds,
        tds_deducted_amount=tds_deducted,
        net_payable=net,
        paid_amount=paid,
        payment_date=parse_date(payload.get("PaymentDate")),
        payment_mode=payload.get("PaymentMode") or "Bank",
        bank_account=payload.get("BankAccount") or "",
        reference_no=payload.get("ReferenceNo") or "",
        paid_by_type=paid_by_type or "Company",
        paid_by_name=paid_by_name,
        reimburse_to=reimburse_to,
        reimbursement_status=payload.get("ReimbursementStatus") or payable_reimbursement_status(paid_by_type, paid),
        reimbursement_date=parse_date(payload.get("ReimbursementDate")),
        reimbursement_ref=payload.get("ReimbursementRef") or "",
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

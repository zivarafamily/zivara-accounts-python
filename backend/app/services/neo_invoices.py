from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy.orm import Session

from app.models import BankAccount, LLP, NeoInvoice
from app.services.common import iso, make_id, money, parse_date


BUYER_DEFAULTS = {
    "BuyerName": "Neo Wealth Management Private Limited",
    "BuyerAddress": "B-903, Marathon Futurex, Mafatlal Mills Compound, N. M. Joshi Marg, Lower Parel, Mumbai - 400013",
    "BuyerGSTIN": "27AAHCN8058K1ZV",
    "BuyerState": "Maharashtra, Code 27",
}

GST_STATES = {
    "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
    "24": "Gujarat", "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra",
    "28": "Andhra Pradesh", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala",
    "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
    "37": "Andhra Pradesh", "38": "Ladakh",
}


def decimal_value(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    cleaned = str(value).replace(",", "").strip()
    if not cleaned:
        return Decimal("0.00")
    return Decimal(cleaned).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def yes_no_bool(value: Any) -> bool:
    return str(value or "").strip().lower() in {"yes", "true", "1", "y"}


def pan_from_gstin(gstin: str) -> str:
    value = str(gstin or "").strip()
    return value[2:12] if len(value) >= 12 else ""


def state_from_gstin(gstin: str) -> str:
    code = str(gstin or "").strip()[:2]
    return f"{GST_STATES[code]}, Code : {code}" if code in GST_STATES else ""


def invoice_title(is_proforma: bool, gst_mode: str) -> str:
    if is_proforma:
        return "Proforma Invoice"
    return "Tax Invoice" if gst_mode == "With GST" else "Invoice"


def seller_llp(db: Session, payload: dict[str, Any], fallback_llp_id: str | None = None) -> LLP | None:
    llp_id = payload.get("SellerLLPID") or payload.get("SellerLLPId") or payload.get("sellerLLPId") or payload.get("LLPID") or fallback_llp_id
    return db.get(LLP, llp_id) if llp_id else None


def default_bank_account(db: Session, llp_id: str | None) -> dict[str, str]:
    q = db.query(BankAccount).filter(BankAccount.is_active.is_(True))
    accounts = q.all()
    if not accounts:
        return {}
    llp = db.get(LLP, llp_id) if llp_id else None

    def haystack(account: BankAccount) -> str:
        return " ".join([account.account_name, account.bank_name, account.notes]).lower()

    def matches_llp(account: BankAccount) -> bool:
        if not llp:
            return False
        text = haystack(account)
        return (llp.llp_name and llp.llp_name.lower() in text) or (llp.short_code and llp.short_code.lower() in text)

    account = (
        next((a for a in accounts if a.llp_id == llp_id), None)
        or next((a for a in accounts if matches_llp(a)), None)
        or next((a for a in accounts if "zivara" in haystack(a)), None)
        or next((a for a in accounts if a.account_type.lower() == "current" and a.account_number), None)
        or next((a for a in accounts if a.account_number), None)
        or accounts[0]
    )
    return {
        "BankName": account.bank_name or "",
        "AccountNo": str(account.account_number or ""),
        "BranchIFSC": " / ".join([v for v in [account.branch, account.ifsc] if v]),
    }


def serialize_neo_invoice(item: NeoInvoice) -> dict[str, Any]:
    return {
        "NeoInvoiceID": item.id,
        "RaisedBy": item.raised_by,
        "InvoiceType": item.invoice_type,
        "GSTMode": item.gst_mode,
        "IsProforma": "Yes" if item.is_proforma else "No",
        "InvoiceTitle": item.invoice_title,
        "InvoiceNo": item.invoice_no,
        "InvoiceDate": iso(item.invoice_date),
        "BillingMonth": item.billing_month,
        "SellerLLPID": item.llp_id or "",
        "SellerName": item.seller_name,
        "SellerAddress": item.seller_address,
        "SellerGSTIN": item.seller_gstin,
        "SellerPAN": item.seller_pan,
        "SellerState": item.seller_state,
        "BuyerName": item.buyer_name,
        "BuyerAddress": item.buyer_address,
        "BuyerGSTIN": item.buyer_gstin,
        "BuyerState": item.buyer_state,
        "Particulars": item.particulars,
        "SACCode": item.sac_code,
        "TaxableAmount": money(item.taxable_amount),
        "GSTRate": money(item.gst_rate),
        "GSTType": item.gst_type,
        "GSTAmount": money(item.gst_amount),
        "TaxAmountInWords": item.tax_amount_in_words,
        "Amount": money(item.amount),
        "AmountInWords": item.amount_in_words,
        "Narration": item.narration,
        "TDSRate": money(item.tds_rate),
        "TDSAmount": money(item.tds_amount),
        "NetPayable": money(item.net_payable),
        "BankName": item.bank_name,
        "AccountNo": item.account_no,
        "BranchIFSC": item.branch_ifsc,
        "AuthorisedSignatory": item.authorised_signatory,
        "Status": item.status,
        "PDFLink": item.pdf_link,
        "Notes": item.notes,
        "CreatedAt": iso(item.created_at),
        "UpdatedAt": iso(item.updated_at),
    }


def apply_neo_invoice_payload(db: Session, item: NeoInvoice, payload: dict[str, Any], llp_id: str | None = None):
    llp = seller_llp(db, payload, llp_id)
    is_proforma = yes_no_bool(payload.get("IsProforma")) if "IsProforma" in payload else item.is_proforma
    gst_mode = payload.get("GSTMode", item.gst_mode or "Without GST")
    bank = default_bank_account(db, llp.id if llp else llp_id)

    item.llp_id = llp.id if llp else (payload.get("SellerLLPID") or llp_id or item.llp_id)
    item.raised_by = payload.get("RaisedBy", item.raised_by or "")
    item.invoice_type = payload.get("InvoiceType", item.invoice_type or "")
    item.gst_mode = gst_mode
    item.is_proforma = is_proforma
    item.invoice_title = payload.get("InvoiceTitle") or invoice_title(is_proforma, gst_mode)
    item.invoice_no = payload.get("InvoiceNo", item.invoice_no or "")
    item.invoice_date = parse_date(payload.get("InvoiceDate")) if "InvoiceDate" in payload else item.invoice_date
    item.billing_month = payload.get("BillingMonth", item.billing_month or "")
    item.seller_name = llp.llp_name if llp else payload.get("SellerName", item.seller_name or "")
    item.seller_address = llp.address if llp else payload.get("SellerAddress", item.seller_address or "")
    item.seller_gstin = llp.gstin if llp else payload.get("SellerGSTIN", item.seller_gstin or "")
    item.seller_pan = llp.pan or pan_from_gstin(llp.gstin) if llp else payload.get("SellerPAN", item.seller_pan or "")
    item.seller_state = state_from_gstin(llp.gstin) if llp else payload.get("SellerState", item.seller_state or "")
    item.buyer_name = payload.get("BuyerName") or item.buyer_name or BUYER_DEFAULTS["BuyerName"]
    item.buyer_address = payload.get("BuyerAddress") or item.buyer_address or BUYER_DEFAULTS["BuyerAddress"]
    item.buyer_gstin = payload.get("BuyerGSTIN") or item.buyer_gstin or BUYER_DEFAULTS["BuyerGSTIN"]
    item.buyer_state = payload.get("BuyerState") or item.buyer_state or BUYER_DEFAULTS["BuyerState"]
    item.particulars = payload.get("Particulars", item.particulars or "")
    item.sac_code = payload.get("SACCode", item.sac_code or "")
    item.taxable_amount = decimal_value(payload.get("TaxableAmount", item.taxable_amount))
    item.gst_rate = decimal_value(payload.get("GSTRate", item.gst_rate))
    item.gst_type = payload.get("GSTType", item.gst_type or "IGST")
    item.gst_amount = decimal_value(payload.get("GSTAmount", item.gst_amount))
    item.tax_amount_in_words = payload.get("TaxAmountInWords", item.tax_amount_in_words or "")
    item.amount = decimal_value(payload.get("Amount", item.amount))
    item.amount_in_words = payload.get("AmountInWords", item.amount_in_words or "")
    item.narration = payload.get("Narration", item.narration or "")
    item.tds_rate = decimal_value(payload.get("TDSRate", item.tds_rate))
    item.tds_amount = decimal_value(payload.get("TDSAmount", item.tds_amount))
    item.net_payable = decimal_value(payload.get("NetPayable", item.net_payable))
    item.bank_name = payload.get("BankName") or item.bank_name or bank.get("BankName", "")
    item.account_no = str(payload.get("AccountNo") or item.account_no or bank.get("AccountNo", ""))
    item.branch_ifsc = payload.get("BranchIFSC") or item.branch_ifsc or bank.get("BranchIFSC", "")
    item.authorised_signatory = payload.get("AuthorisedSignatory", item.authorised_signatory or "")
    item.status = payload.get("Status", item.status or "Draft")
    item.pdf_link = payload.get("PDFLink", item.pdf_link or "")
    item.notes = payload.get("Notes", item.notes or "")


def create_neo_invoice(db: Session, payload: dict[str, Any], llp_id: str | None) -> NeoInvoice:
    item = NeoInvoice(
        id=payload.get("NeoInvoiceID") or make_id("NINV"),
        llp_id=llp_id,
        invoice_no=payload.get("InvoiceNo") or "",
        billing_month=payload.get("BillingMonth") or "",
    )
    apply_neo_invoice_payload(db, item, payload, llp_id)
    created_at = payload.get("CreatedAt")
    if created_at:
        try:
            item.created_at = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        except ValueError:
            pass
    db.add(item)
    return item

from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models import Client, LLP, NeoInvoice, NeoRevenue, Partner
from app.services.common import dec, iso, make_id, money, normalize_key, parse_date


MONTHS = {"Jan": 0, "Feb": 1, "Mar": 2, "Apr": 3, "May": 4, "Jun": 5, "Jul": 6, "Aug": 7, "Sep": 8, "Oct": 9, "Nov": 10, "Dec": 11}


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    return str(value).strip()


def _money_value(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    return Decimal(str(value).replace(",", "").strip() or "0").quantize(Decimal("0.01"))


def _month_number(label: str) -> int:
    parts = _text(label).split("-")
    if len(parts) != 2:
        return 999999999
    mon = parts[0][:1].upper() + parts[0][1:3].lower()
    try:
        return int(parts[1]) * 12 + MONTHS.get(mon, 99)
    except ValueError:
        return 999999999


def _fy(label: str) -> str:
    num = _month_number(label)
    if num == 999999999:
        return ""
    year, month = divmod(num, 12)
    start = year if month >= 3 else year - 1
    return f"{start}-{str((start + 1) % 100).zfill(2)}"


def client_master_map(db: Session) -> dict[str, Client]:
    return {c.pan.strip().upper(): c for c in db.query(Client).all() if c.pan.strip()}


def partner_llp_map(db: Session) -> dict[str, str]:
    llps = {l.id: l.llp_name for l in db.query(LLP).all()}
    return {normalize_key(p.partner_name): llps.get(p.llp_id, "") for p in db.query(Partner).all() if p.partner_name and p.llp_id}


def resolve_llp_name(db: Session, row: dict[str, Any] | NeoRevenue) -> str:
    if isinstance(row, NeoRevenue):
        direct = row.llp_name
        partner = row.partner_name or row.rm_name
    else:
        direct = _text(row.get("LLPName"))
        partner = _text(row.get("PartnerName") or row.get("RMName"))
    if direct:
        return direct
    return partner_llp_map(db).get(normalize_key(partner), "")


def apply_client_master(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    pan = _text(payload.get("PAN")).upper()
    client = client_master_map(db).get(pan) if pan else None
    if not client:
        return payload
    if client.client_name:
        payload["ClientName"] = client.client_name
    payload["FamilyName"] = client.family_name or payload.get("FamilyName") or ""
    payload["SuperFamilyName"] = client.super_family_name or payload.get("SuperFamilyName") or ""
    if not payload.get("PartnerName"):
        payload["PartnerName"] = client.partner_name
    if not payload.get("LLPName"):
        payload["LLPName"] = client.llp_name
    return payload


def serialize_client(c: Client) -> dict[str, Any]:
    return {
        "ClientID": c.id,
        "ClientName": c.client_name,
        "PAN": c.pan,
        "RMName": c.rm_name,
        "Segment": c.segment,
        "Status": c.status,
        "Notes": c.notes,
        "PartnerName": c.partner_name,
        "LLPName": c.llp_name,
        "FamilyName": c.family_name,
        "SuperFamilyName": c.super_family_name,
        "CreatedAt": iso(c.created_at),
    }


def apply_client_payload(c: Client, payload: dict[str, Any]):
    c.client_name = payload.get("ClientName", c.client_name or "")
    c.pan = _text(payload.get("PAN", c.pan)).upper()
    c.rm_name = payload.get("RMName", c.rm_name or "")
    c.segment = payload.get("Segment", c.segment or "")
    c.status = payload.get("Status", c.status or "Active")
    c.notes = payload.get("Notes", c.notes or "")
    c.partner_name = payload.get("PartnerName", c.partner_name or "")
    c.llp_name = payload.get("LLPName", c.llp_name or "")
    c.family_name = payload.get("FamilyName", c.family_name or "")
    c.super_family_name = payload.get("SuperFamilyName", c.super_family_name or "")


def serialize_revenue(r: NeoRevenue) -> dict[str, Any]:
    return {
        "RevenueID": r.id,
        "PAN": r.pan,
        "ClientName": r.client_name,
        "RMName": r.rm_name,
        "TransactionDate": iso(r.transaction_date),
        "Product": r.product,
        "TransactionType": r.transaction_type,
        "SchemeName": r.scheme_name,
        "InvestmentAmount": money(r.investment_amount),
        "CommissionPercent": money(r.commission_percent),
        "RevenueMonth": r.revenue_month,
        "RevenueAmount": money(r.revenue_amount),
        "YTDValue": money(r.ytd_value),
        "StatementRef": r.statement_ref,
        "Notes": r.notes,
        "CreatedAt": iso(r.created_at),
        "PartnerName": r.partner_name,
        "LLPName": r.llp_name,
        "FamilyName": r.family_name,
        "SuperFamilyName": r.super_family_name,
        "IncomeType": r.income_type,
        "InvoiceNo": r.invoice_no,
        "InvoiceMonth": r.invoice_month,
        "InvoiceStatus": r.invoice_status,
        "ReceiptStatus": r.receipt_status,
    }


def duplicate_key(data: dict[str, Any]) -> str:
    client_key = _text(data.get("PAN")).upper() or normalize_key(data.get("ClientName"))
    return "||".join([
        client_key,
        normalize_key(data.get("SchemeName")),
        _text(data.get("RevenueMonth")),
        _text(data.get("TransactionDate")),
        normalize_key(data.get("Product")),
        normalize_key(data.get("TransactionType")),
        str(_money_value(data.get("InvestmentAmount"))),
        str(_money_value(data.get("RevenueAmount"))),
        normalize_key(data.get("IncomeType")),
    ])


def apply_revenue_payload(db: Session, r: NeoRevenue, payload: dict[str, Any]):
    payload = apply_client_master(db, dict(payload))
    r.pan = _text(payload.get("PAN", r.pan)).upper()
    r.client_name = payload.get("ClientName", r.client_name or "")
    r.rm_name = payload.get("RMName", r.rm_name or "")
    r.transaction_date = parse_date(payload.get("TransactionDate")) if "TransactionDate" in payload else r.transaction_date
    r.product = payload.get("Product", r.product or "")
    r.transaction_type = payload.get("TransactionType", r.transaction_type or "")
    r.scheme_name = payload.get("SchemeName", r.scheme_name or "")
    r.investment_amount = _money_value(payload.get("InvestmentAmount", r.investment_amount))
    r.commission_percent = _money_value(payload.get("CommissionPercent", r.commission_percent))
    r.revenue_month = payload.get("RevenueMonth", r.revenue_month or "")
    r.revenue_amount = _money_value(payload.get("RevenueAmount", r.revenue_amount))
    r.ytd_value = _money_value(payload.get("YTDValue", r.ytd_value))
    r.statement_ref = payload.get("StatementRef", r.statement_ref or "")
    r.notes = payload.get("Notes", r.notes or "")
    r.partner_name = payload.get("PartnerName") or r.partner_name or r.rm_name
    r.llp_name = payload.get("LLPName") or r.llp_name or resolve_llp_name(db, {"PartnerName": r.partner_name, "RMName": r.rm_name})
    r.family_name = payload.get("FamilyName", r.family_name or "")
    r.super_family_name = payload.get("SuperFamilyName", r.super_family_name or "")
    r.income_type = payload.get("IncomeType", r.income_type or "")
    r.invoice_no = payload.get("InvoiceNo", r.invoice_no or "")
    r.invoice_month = payload.get("InvoiceMonth", r.invoice_month or "")
    r.invoice_status = payload.get("InvoiceStatus", r.invoice_status or "")
    r.receipt_status = payload.get("ReceiptStatus", r.receipt_status or "")


def create_revenue(db: Session, payload: dict[str, Any]) -> NeoRevenue:
    item = NeoRevenue(id=payload.get("RevenueID") or make_id("REV"), client_name=payload.get("ClientName") or "", revenue_month=payload.get("RevenueMonth") or "")
    apply_revenue_payload(db, item, payload)
    db.add(item)
    return item


def filter_revenue(rows: list[NeoRevenue], params: dict[str, Any]) -> list[NeoRevenue]:
    partner = normalize_key(params.get("partnerName") or params.get("PartnerName"))
    llp = normalize_key(params.get("llpName") or params.get("LLPName"))
    month = _text(params.get("month") or params.get("Month"))
    fy = _text(params.get("financialYear") or params.get("fy") or params.get("FY"))
    search = normalize_key(params.get("search") or params.get("Search"))
    from_month = _text(params.get("fromMonth"))
    to_month = _text(params.get("toMonth"))
    from_date = parse_date(params.get("fromDate"))
    to_date = parse_date(params.get("toDate"))
    super_family = normalize_key(params.get("superFamilyName"))
    family = normalize_key(params.get("familyName"))
    scheme = normalize_key(params.get("schemeName"))
    pan = normalize_key(params.get("pan"))
    rev_type = normalize_key(params.get("revenueType"))
    if normalize_key(params.get("requesterRole")) == "partner":
        partner = normalize_key(params.get("requesterName"))

    def ok(r: NeoRevenue) -> bool:
        if partner and normalize_key(r.partner_name or r.rm_name) != partner:
            return False
        if llp and normalize_key(r.llp_name) != llp:
            return False
        if month and r.revenue_month != month:
            return False
        if fy and _fy(r.revenue_month) != fy:
            return False
        if from_month and _month_number(r.revenue_month) < _month_number(from_month):
            return False
        if to_month and _month_number(r.revenue_month) > _month_number(to_month):
            return False
        if from_date and (not r.transaction_date or r.transaction_date < from_date):
            return False
        if to_date and (not r.transaction_date or r.transaction_date > to_date):
            return False
        if super_family and normalize_key(r.super_family_name or "Unmapped Super Family") != super_family:
            return False
        if family and normalize_key(r.family_name or "Unmapped Family") != family:
            return False
        if scheme and normalize_key(r.scheme_name) != scheme:
            return False
        if pan and normalize_key(r.pan) != pan:
            return False
        if rev_type and normalize_key(r.income_type or "TRB") != rev_type:
            return False
        if search and search not in normalize_key(r.client_name) and search not in normalize_key(r.pan):
            return False
        return True

    return [r for r in rows if ok(r)]


def _kind(row: NeoRevenue) -> str:
    return "ARR" if _text(row.income_type).upper() == "ARR" else "TRB"


def _blank_summary() -> dict[str, Any]:
    return {"TotalRevenue": Decimal("0"), "ARRRevenue": Decimal("0"), "TRBRevenue": Decimal("0"), "TotalYTD": Decimal("0"), "ClientKeys": set(), "TxnCount": 0}


def _add_summary(summary: dict[str, Any], r: NeoRevenue):
    amount = dec(r.revenue_amount)
    summary["TotalRevenue"] += amount
    if _kind(r) == "ARR":
        summary["ARRRevenue"] += amount
    else:
        summary["TRBRevenue"] += amount
    summary["TotalYTD"] = max(summary["TotalYTD"], dec(r.ytd_value))
    summary["ClientKeys"].add(r.pan or normalize_key(r.client_name))
    summary["TxnCount"] += 1


def _emit_summary(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "TotalRevenue": money(data["TotalRevenue"]),
        "ARRRevenue": money(data["ARRRevenue"]),
        "TRBRevenue": money(data["TRBRevenue"]),
        "TotalYTD": money(data["TotalYTD"]),
        "ClientCount": len(data["ClientKeys"]),
        "TxnCount": data["TxnCount"],
    }


def revenue_report(db: Session, params: dict[str, Any]) -> dict[str, Any]:
    rows = filter_revenue(db.query(NeoRevenue).all(), params)
    invoices_by_no = {i.invoice_no: i for i in db.query(NeoInvoice).all() if i.invoice_no}

    kpis = _blank_summary()
    client_map, super_map, family_map, partner_map, llp_map, scheme_map, month_map, invoice_map, date_map = [defaultdict(_blank_summary) for _ in range(9)]
    client_meta: dict[str, dict[str, Any]] = {}

    for r in rows:
        _add_summary(kpis, r)
        client_key = r.pan or normalize_key(r.client_name)
        _add_summary(client_map[client_key], r)
        _add_summary(super_map[r.super_family_name or "Unmapped Super Family"], r)
        _add_summary(family_map[r.family_name or "Unmapped Family"], r)
        _add_summary(partner_map[r.partner_name or r.rm_name or "Unmapped Partner"], r)
        _add_summary(llp_map[r.llp_name or "Unmapped LLP"], r)
        _add_summary(scheme_map[(r.scheme_name, r.product, r.income_type)], r)
        _add_summary(month_map[r.revenue_month or "Unmapped Month"], r)
        _add_summary(invoice_map[r.invoice_no or "Uninvoiced"], r)
        _add_summary(date_map[iso(r.transaction_date) or "No Date"], r)
        meta = client_meta.setdefault(client_key, {
            "PAN": r.pan,
            "ClientName": r.client_name,
            "PartnerName": r.partner_name or r.rm_name,
            "LLPName": r.llp_name or "Unmapped LLP",
            "FamilyName": r.family_name or "Unmapped Family",
            "SuperFamilyName": r.super_family_name or "Unmapped Super Family",
            "MaxInvestmentAmount": Decimal("0"),
            "Schemes": {},
            "MonthlyRevenue": defaultdict(Decimal),
        })
        meta["MaxInvestmentAmount"] = max(meta["MaxInvestmentAmount"], dec(r.investment_amount))
        meta["MonthlyRevenue"][r.revenue_month] += dec(r.revenue_amount)
        scheme_meta = meta["Schemes"].setdefault((r.scheme_name, r.product), {"SchemeName": r.scheme_name, "Product": r.product, "LatestInvestmentAmount": Decimal("0"), "TotalRevenue": Decimal("0")})
        scheme_meta["LatestInvestmentAmount"] = max(scheme_meta["LatestInvestmentAmount"], dec(r.investment_amount))
        scheme_meta["TotalRevenue"] += dec(r.revenue_amount)

    k = _emit_summary(kpis)
    total_revenue = k["TotalRevenue"] or 0
    k["ARRPercent"] = (k["ARRRevenue"] / total_revenue * 100) if total_revenue else 0

    client_wise = []
    for key, summary in client_map.items():
        row = _emit_summary(summary)
        meta = client_meta.get(key, {})
        row.update({
            "PAN": meta.get("PAN", ""),
            "ClientName": meta.get("ClientName", ""),
            "PartnerName": meta.get("PartnerName", ""),
            "LLPName": meta.get("LLPName", ""),
            "FamilyName": meta.get("FamilyName", ""),
            "SuperFamilyName": meta.get("SuperFamilyName", ""),
            "MaxInvestmentAmount": money(meta.get("MaxInvestmentAmount", 0)),
            "MonthlyRevenue": {m: money(v) for m, v in dict(meta.get("MonthlyRevenue", {})).items()},
            "Schemes": [{**s, "LatestInvestmentAmount": money(s["LatestInvestmentAmount"]), "TotalRevenue": money(s["TotalRevenue"])} for s in meta.get("Schemes", {}).values()],
        })
        client_wise.append(row)

    def list_from(mapping, field_names):
        out = []
        for key, summary in mapping.items():
            row = _emit_summary(summary)
            if isinstance(key, tuple):
                row.update(dict(zip(field_names, key)))
            else:
                row[field_names[0]] = key
            out.append(row)
        return sorted(out, key=lambda x: x.get("TotalRevenue", 0), reverse=True)

    invoice_reconciliation = []
    for inv_no, summary in invoice_map.items():
        row = _emit_summary(summary)
        inv = invoices_by_no.get(inv_no)
        row.update({
            "InvoiceNo": inv_no,
            "InvoiceMonth": inv.billing_month if inv else "",
            "InvoiceStatus": inv.status if inv else "",
            "ReceiptStatus": row.get("ReceiptStatus", ""),
        })
        invoice_reconciliation.append(row)

    return {
        "ok": True,
        "kpis": k,
        "clientWise": sorted(client_wise, key=lambda x: x.get("TotalRevenue", 0), reverse=True),
        "superFamilyWise": list_from(super_map, ["SuperFamilyName"]),
        "familyWise": list_from(family_map, ["FamilyName"]),
        "partnerWise": list_from(partner_map, ["PartnerName"]),
        "llpWise": list_from(llp_map, ["LLPName"]),
        "schemeWise": list_from(scheme_map, ["SchemeName", "Product", "IncomeType"]),
        "monthWise": sorted(list_from(month_map, ["RevenueMonth"]), key=lambda x: _month_number(x["RevenueMonth"])),
        "invoiceReconciliation": sorted(invoice_reconciliation, key=lambda x: x.get("InvoiceNo", "")),
        "dateWise": sorted(list_from(date_map, ["TransactionDate"]), key=lambda x: x.get("TransactionDate", "")),
        "partnerShareWise": [],
    }

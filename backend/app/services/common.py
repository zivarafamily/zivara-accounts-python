import csv
import io
import re
import uuid
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from fastapi import Response
from openpyxl import Workbook
from sqlalchemy.orm import Session

from app.models import AuditLog, LLP


MONEY_ZERO = Decimal("0.00")


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def dec(value: Any) -> Decimal:
    if value in (None, ""):
        return MONEY_ZERO
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def money(value: Any) -> float:
    return float(dec(value))


def parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    return date.fromisoformat(str(value)[:10])


def iso(value: Any) -> str:
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def normalize_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def yes_no(value: Any) -> bool:
    return str(value or "").strip().lower() in {"yes", "true", "1", "y"}


def llp_name(db: Session, llp_id: str | None) -> str:
    if not llp_id:
        return ""
    llp = db.get(LLP, llp_id)
    return llp.llp_name if llp else ""


def audit(db: Session, user_email: str, module: str, action: str, ref_no: str = "", remarks: str = ""):
    db.add(AuditLog(
        id=make_id("LOG"),
        user_email=user_email or "system",
        module=module,
        action=action,
        ref_no=ref_no or "",
        remarks=remarks or "",
    ))


def export_rows(rows: list[dict[str, Any]], fmt: str, filename: str):
    if fmt == "json":
        return {"ok": True, "data": rows}
    headers = list(rows[0].keys()) if rows else []
    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)
        return Response(
            buf.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
        )
    if fmt == "xlsx":
        wb = Workbook()
        ws = wb.active
        ws.title = "Report"
        ws.append(headers)
        for row in rows:
            ws.append([row.get(h, "") for h in headers])
        out = io.BytesIO()
        wb.save(out)
        return Response(
            out.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}.xlsx"'},
        )
    return {"ok": True, "data": rows}

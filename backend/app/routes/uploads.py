import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies import current_user, require_llp_id
from app.models import Expense, UploadedBill, User
from app.services.common import audit, make_id

router = APIRouter(prefix="/uploads", tags=["uploads"])
SAFE_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".xlsx", ".xls", ".csv"}


@router.post("/bills")
async def upload_bill(
    file: UploadFile = File(...),
    source_type: str = Form(""),
    source_id: str = Form(""),
    db: Session = Depends(get_db),
    llp_id: str = Depends(require_llp_id),
    user: User = Depends(current_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SAFE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="File type not allowed")
    settings = get_settings()
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{make_id('BILL')}{suffix}"
    path = upload_dir / stored
    content = await file.read()
    path.write_bytes(content)
    item = UploadedBill(
        id=make_id("UPL"),
        llp_id=llp_id,
        source_type=source_type,
        source_id=source_id,
        original_filename=os.path.basename(file.filename or stored),
        stored_filename=stored,
        content_type=file.content_type or "",
        file_path=str(path),
    )
    db.add(item)
    if source_type == "expense" and source_id:
        expense = db.get(Expense, source_id)
        if expense and expense.llp_id == llp_id:
            expense.bill_available = True
            expense.bill_link = str(path)
    audit(db, user.email, "uploads", "create", item.id)
    db.commit()
    return {
        "ok": True,
        "fileId": item.id,
        "url": str(path),
        "originalFilename": item.original_filename,
        "storedFilename": item.stored_filename,
        "sourceType": item.source_type,
        "sourceId": item.source_id,
        "message": "Bill uploaded",
    }

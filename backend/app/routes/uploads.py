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
SIGNATURE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


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


@router.post("/signatures")
async def upload_signature(
    file: UploadFile = File(...),
    signer_name: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SIGNATURE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Signature must be a PNG, JPG, JPEG, or WEBP image")

    signer = (signer_name or user.name or user.username).strip()
    target = user
    if user.role.lower() in {"admin", "managing_partner", "super_admin"} and signer:
        normalized = signer.lower()
        target = (
            db.query(User)
            .filter((User.name.ilike(normalized)) | (User.username.ilike(normalized)))
            .first()
            or user
        )
    elif signer and signer.lower() not in {user.name.lower(), user.username.lower()}:
        raise HTTPException(status_code=403, detail="Partners can upload only their own signature")

    settings = get_settings()
    signature_dir = Path(settings.upload_dir) / "signatures"
    signature_dir.mkdir(parents=True, exist_ok=True)
    stored = f"{make_id('SIG')}{suffix}"
    path = signature_dir / stored
    path.write_bytes(await file.read())

    url = f"/uploads/signatures/{stored}"
    target.signature_url = url
    audit(db, user.email, "uploads", "signature", target.id)
    db.commit()
    return {
        "ok": True,
        "url": url,
        "signer": target.name,
        "message": "Signature uploaded",
    }

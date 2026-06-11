import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user
from app.models import LLPPartner, User
from app.schemas import LoginRequest, TokenResponse
from app.security import create_access_token, verify_password
from app.services.common import audit

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    user = db.query(User).filter((User.username == username) | (User.email == username)).first()
    if not user or user.status.lower() != "active" or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    modules = _modules(user.allowed_modules)
    links = db.query(LLPPartner).filter(LLPPartner.user_id == user.id, LLPPartner.status == "Active").all()
    llps = [{
        "llpId": l.llp_id,
        "llpName": l.llp.llp_name,
        "shortCode": l.llp.short_code,
        "gstin": l.llp.gstin,
        "role": l.role,
        "allowedModules": _modules(l.allowed_modules),
    } for l in links]
    token = create_access_token(user.id, {"role": user.role})
    audit(db, user.email, "auth", "login", user.id)
    db.commit()
    return TokenResponse(
        access_token=token,
        user=user.username,
        fullName=user.name,
        role=user.role,
        employeeRef=user.name,
        allowedModules=modules,
        llps=llps,
    )


@router.get("/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    links = db.query(LLPPartner).filter(LLPPartner.user_id == user.id, LLPPartner.status == "Active").all()
    return {
        "ok": True,
        "user": user.username,
        "fullName": user.name,
        "role": user.role,
        "allowedModules": _modules(user.allowed_modules),
        "llps": [{
            "llpId": l.llp_id,
            "llpName": l.llp.llp_name,
            "shortCode": l.llp.short_code,
            "gstin": l.llp.gstin,
            "role": l.role,
            "allowedModules": _modules(l.allowed_modules),
        } for l in links],
    }


def _modules(value: str):
    if not value:
        return []
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return [x.strip().lower() for x in value.split(",") if x.strip()]

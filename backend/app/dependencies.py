from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import LLPPartner, User
from app.security import decode_token


bearer = HTTPBearer(auto_error=False)
ADMIN_ROLES = {"super_admin", "admin", "managing_partner"}


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, payload.get("sub"))
    if not user or user.status.lower() != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")
    return user


def require_roles(*roles: str):
    allowed = {r.lower() for r in roles}

    def checker(user: User = Depends(current_user)) -> User:
        if user.role.lower() not in allowed and user.role.lower() != "super_admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return user

    return checker


def get_llp_id(
    x_llp_id: str | None = Header(default=None, alias="X-LLP-ID"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> str | None:
    if not x_llp_id:
        return None if user.role.lower() in ADMIN_ROLES else _first_user_llp(db, user.id)
    if user.role.lower() in ADMIN_ROLES:
        return x_llp_id
    exists = db.query(LLPPartner).filter(
        LLPPartner.user_id == user.id,
        LLPPartner.llp_id == x_llp_id,
        LLPPartner.status == "Active",
    ).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this LLP")
    return x_llp_id


def require_llp_id(llp_id: str | None = Depends(get_llp_id)) -> str:
    if not llp_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="X-LLP-ID is required")
    return llp_id


def _first_user_llp(db: Session, user_id: str) -> str | None:
    link = db.query(LLPPartner).filter(LLPPartner.user_id == user_id, LLPPartner.status == "Active").first()
    return link.llp_id if link else None

from typing import Any

from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    ok: bool = True
    access_token: str
    token_type: str = "bearer"
    user: str
    fullName: str
    role: str
    employeeRef: str = ""
    designation: str = ""
    signatureURL: str = ""
    allowedModules: list[str] = []
    llps: list[dict] = []


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    username: str
    password: str
    role: str = "viewer"
    allowed_modules: list[str] = []
    status: str = "Active"


class AnyPayload(BaseModel):
    model_config = {"extra": "allow"}

    def as_dict(self) -> dict[str, Any]:
        return dict(self.model_dump(exclude_unset=True), **getattr(self, "__pydantic_extra__", {}) or {})

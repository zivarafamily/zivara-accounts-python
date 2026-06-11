import os
import sys
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["JWT_SECRET_KEY"] = "test-secret"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app
from app.models import LLP, LLPPartner, User
from app.security import hash_password


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    from app.database import SessionLocal

    db = SessionLocal()
    llp = LLP(id="LLP001", llp_name="Zivara Family Office LLP", short_code="ZIVARA", gstin="", pan="", address="", status="Active")
    user = User(id="USR_ADMIN", name="Admin", email="admin@zivara.local", username="admin", password_hash=hash_password("ChangeMe123!"), role="admin", allowed_modules="", status="Active")
    db.add_all([llp, user])
    db.flush()
    db.add(LLPPartner(id="MAP1", llp_id=llp.id, user_id=user.id, role="admin", percentage="", allowed_modules="", status="Active"))
    db.commit()
    db.close()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth_headers(client):
    res = client.post("/auth/login", json={"username": "admin", "password": "ChangeMe123!"})
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}", "X-LLP-ID": "LLP001"}

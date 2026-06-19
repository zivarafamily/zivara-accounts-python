# Zivara Accounts Backend

Python/FastAPI backend for the Zivara Accounts app.

## Setup

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
Copy-Item .env.example .env
alembic upgrade head
python -m app.scripts.seed
pytest -q
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## Frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Default seeded admin:

```text
Email: admin@zivara.local
Password: ChangeMe123!
```

## Bill Upload Storage

Uploaded bills are stored locally under `backend/uploads/` during local deployment.

The database stores upload metadata.

This can later be replaced with cloud object storage without changing the accounting records.

Cloud drive folder-sharing actions are not part of the active backend.

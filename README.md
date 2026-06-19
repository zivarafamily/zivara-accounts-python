# Zivara Accounts

Dedicated accounts, GST, TDS, payment tracking, reimbursement, bank and CA reporting app for Zivara LLP entities.

## Active Architecture

This project uses:

```text
React Frontend -> Python FastAPI Backend -> SQL Database
```

Google Apps Script backend is not used.

## Scope

- LLP vendor payables and payment tracker
- Vendor master
- TDS calculation and payment status
- GST/TDS reports for CA review
- Expenses and reimbursements
- Receipts and cash book
- Bank accounts
- LLP and partner setup

## Structure

```text
zivara-accounts-python/
  frontend/       React/Vite app
  backend/        Python FastAPI backend
  docs/           Setup and reference notes
```

## Local Backend Setup

```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
python -m app.scripts.seed
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Backend runs at:

```text
http://127.0.0.1:8000
```

API docs:

```text
http://127.0.0.1:8000/docs
```

## Local Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Create `frontend/.env`:

```text
VITE_API_BASE_URL=/api
```

Frontend runs at:

```text
http://127.0.0.1:5173
```

## Important Environment Variables

For backend production:

```text
DATABASE_URL=your_database_url
JWT_SECRET_KEY=change-this-to-a-long-random-secret
SEED_ADMIN_PASSWORD=change-this-password
ENVIRONMENT=production
```

Do not use default passwords or default JWT secrets in production.

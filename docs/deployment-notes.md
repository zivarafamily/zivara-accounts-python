# Deployment Notes

## Active Deployment Flow

```text
Vercel Frontend -> FastAPI Backend -> SQL Database
```

Google Apps Script is not used.

## Backend Deployment

Deploy the Python FastAPI backend separately, for example on Render.

Required backend environment variables:

```text
DATABASE_URL=your_database_url
JWT_SECRET_KEY=change-this-to-a-long-random-secret
SEED_ADMIN_PASSWORD=change-this-password
ENVIRONMENT=production
```

After deployment, run database migrations:

```bash
alembic upgrade head
```

Then seed the first admin user:

```bash
python -m app.scripts.seed
```

## Frontend Deployment

Deploy the frontend folder to Vercel.

Frontend environment variable:

```text
VITE_API_BASE_URL=/api
```

The frontend uses `frontend/vercel.json` to rewrite `/api/*` requests to the deployed FastAPI backend.

## Local Development

Backend:

```bash
cd backend
pip install -r requirements.txt
alembic upgrade head
python -m app.scripts.seed
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Local frontend `.env`:

```text
VITE_API_BASE_URL=/api
```

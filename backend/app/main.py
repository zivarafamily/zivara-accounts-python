from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.routes import auth, core, imports, uploads

settings = get_settings()
app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=r"^https?://((localhost|127\.0\.0\.1):\d+|[a-z0-9-]+\.vercel\.app)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(core.router)
app.include_router(imports.router)
app.include_router(uploads.router)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir, check_dir=False), name="uploads")

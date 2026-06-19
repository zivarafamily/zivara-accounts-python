from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Zivara Accounts API"
    environment: str = "development"

    database_url: str = "sqlite:///./zivara_accounts.db"

    jwt_secret_key: str = "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 480

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    cors_origin_regex: str = r"^https?://((localhost|127\.0\.0\.1):\d+|[a-z0-9-]+\.vercel\.app|[a-z0-9-]+\.netlify\.app|[a-z0-9-]+\.pages\.dev)$"

    upload_dir: str = "./uploads"

    seed_admin_email: str = "admin@zivara.local"
    seed_admin_password: str = "ChangeMe123!"
    seed_admin_name: str = "Zivara Admin"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @model_validator(mode="after")
    def validate_production_secrets(self):
        if self.environment.lower() == "production":
            if self.jwt_secret_key == "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET":
                raise ValueError("JWT_SECRET_KEY must be changed in production")

            if self.seed_admin_password == "ChangeMe123!":
                raise ValueError("SEED_ADMIN_PASSWORD must be changed in production")

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()

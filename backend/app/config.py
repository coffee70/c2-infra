"""Application configuration."""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    database_url: str = "postgresql://telemetry:telemetry@localhost:5432/telemetry_db"
    openai_api_key: str = ""
    openai_base_url: str = ""
    # Comma-separated list of allowed CORS origins (e.g. https://app.example.com). Default: localhost for dev.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    class Config:
        env_file = ".env"
        extra = "ignore"

    def get_cors_origins_list(self) -> list[str]:
        """Return CORS origins as a list, stripping whitespace."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()

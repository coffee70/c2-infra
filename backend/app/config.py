"""Application configuration."""

import os
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    database_url: str = "postgresql://telemetry:telemetry@localhost:5432/telemetry_db"
    openai_api_key: str = ""
    openai_base_url: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()

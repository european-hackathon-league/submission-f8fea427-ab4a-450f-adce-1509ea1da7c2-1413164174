import os
from pathlib import Path
from typing import Literal, Self

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.environ.get(
            "APP_ENV_FILE", str(Path(__file__).resolve().parents[2] / ".env")
        ),
        extra="ignore",
    )
    environment: Literal["development", "test", "production"] = "development"
    auth_mode: Literal["development", "oidc"] = "development"
    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://vehicle:vehicle@localhost:5432/vehicle"
    )
    temporal_address: str = "localhost:7233"
    temporal_namespace: str = "default"
    storage_path: Path = Path(".local/objects")
    openai_api_key: SecretStr = SecretStr("")
    openai_base_url: str = "https://api.openai.com/v1"
    app_model: str = "gpt-6.1-sol"
    oidc_issuer: str = ""
    oidc_audience: str = ""
    oidc_jwks_url: str = ""
    renderer_url: str = ""
    renderer_token: SecretStr = SecretStr("")
    cors_origins: list[str] = ["http://localhost:3000"]
    max_upload_bytes: int = 32 * 1024 * 1024
    max_archive_bytes: int = 256 * 1024 * 1024
    max_pdf_pages: int = 500
    event_retention: int = 10000

    @model_validator(mode="after")
    def validate_runtime(self) -> Self:
        if self.environment == "production" and self.auth_mode == "development":
            raise ValueError("production forbids development identity")
        if self.auth_mode == "oidc" and not all(
            (self.oidc_issuer, self.oidc_audience, self.oidc_jwks_url)
        ):
            raise ValueError("OIDC issuer, audience and JWKS URL are required")
        return self

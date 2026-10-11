import os
from pathlib import Path
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
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
    storage_backend: Literal["local", "s3"] = "local"
    s3_bucket: str = ""
    otlp_endpoint: str = ""
    openai_api_key: SecretStr = SecretStr("")
    openai_base_url: str = "https://api.openai.com/v1"
    app_model: str = "gpt-6.1-sol"
    oidc_issuer: str = ""
    oidc_audience: str = ""
    oidc_jwks_url: str = ""
    renderer_url: str = ""
    renderer_token: SecretStr = SecretStr("")
    planning_horizon: int = Field(default=2030, ge=1900, le=2200)
    research_max_searches: int = Field(default=3, ge=1, le=20)
    research_max_sources: int = Field(default=6, ge=1, le=50)
    research_timeout_seconds: int = Field(default=60, ge=1, le=300)
    research_max_bytes: int = Field(default=1048576, ge=1024, le=8388608)
    research_max_tokens: int = Field(default=6000, ge=100, le=50000)
    ai_batch_size: int = Field(default=5, ge=1, le=100)
    ai_timeout_seconds: int = Field(default=180, ge=1, le=300)
    ai_max_output_tokens: int = Field(default=6000, ge=100, le=50000)
    cors_origins: list[str] = ["http://localhost:3000"]
    max_upload_bytes: int = 32 * 1024 * 1024
    max_archive_bytes: int = 256 * 1024 * 1024
    max_pdf_pages: int = 500
    max_pdf_stream_bytes: int = 8 * 1024 * 1024
    reference_year: int = Field(default=2026, ge=1900, le=2200)
    feedback_header_aliases: dict[str, str] = {}
    excel_max_rows: int = Field(default=10000, ge=1, le=100000)
    excel_max_columns: int = Field(default=64, ge=1, le=256)
    excel_max_cells: int = Field(default=1000000, ge=1, le=5000000)
    pdf_artifacts_path: Path | None = None
    pdf_timeout_seconds: int = Field(default=180, ge=1, le=600)
    pdf_memory_mb: int = Field(default=4096, ge=512, le=8192)
    event_retention: int = 10000
    catalog_path: Path = (
        Path(__file__).resolve().parents[2] / "contracts/catalog.example.json"
    )

    @model_validator(mode="after")
    def validate_runtime(self) -> Self:
        if self.environment == "production" and self.auth_mode == "development":
            raise ValueError("production forbids development identity")
        if self.auth_mode == "oidc" and not all(
            (self.oidc_issuer, self.oidc_audience, self.oidc_jwks_url)
        ):
            raise ValueError("OIDC issuer, audience and JWKS URL are required")
        if self.storage_backend == "s3" and not self.s3_bucket:
            raise ValueError("S3 bucket is required")
        return self

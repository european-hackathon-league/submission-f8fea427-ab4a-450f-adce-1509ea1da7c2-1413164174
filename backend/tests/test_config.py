import pytest

from app.config import Settings


def test_production_rejects_development_identity():
    with pytest.raises(ValueError, match="development identity"):
        Settings(environment="production", auth_mode="development", _env_file=None)


def test_secrets_are_not_represented_and_environment_overrides_dotenv(
    tmp_path, monkeypatch
):
    env_file = tmp_path / ".env"
    env_file.write_text("OPENAI_API_KEY=synthetic-secret\nAPP_MODEL=file-model\n")
    monkeypatch.setenv("APP_MODEL", "environment-model")
    settings = Settings(_env_file=env_file)
    assert settings.app_model == "environment-model"
    assert settings.openai_api_key.get_secret_value() == "synthetic-secret"
    assert "synthetic-secret" not in repr(settings)

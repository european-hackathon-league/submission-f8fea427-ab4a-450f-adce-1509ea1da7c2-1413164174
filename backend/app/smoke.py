"""Bounded live AI access check; prints metadata only, never responses or credentials."""

import json

from openai import APIConnectionError, APIStatusError, OpenAI

from app.config import Settings


def main() -> None:
    settings = Settings()
    if not settings.openai_api_key.get_secret_value():
        raise SystemExit("live AI smoke: missing OPENAI_API_KEY")
    client = OpenAI(
        api_key=settings.openai_api_key.get_secret_value(),
        base_url=settings.openai_base_url,
        timeout=20,
        max_retries=0,
    )
    try:
        response = client.responses.create(
            model=settings.app_model,
            input="Reply with OK. This is an API connectivity test using no customer data.",
            max_output_tokens=32,
        )
    except APIStatusError as error:
        print(
            json.dumps(
                {
                    "integration": "live_ai",
                    "status": "failed",
                    "http_status": error.status_code,
                }
            )
        )
        raise SystemExit(1) from None
    except APIConnectionError:
        raise SystemExit("live AI smoke: connection failed") from None
    print(
        json.dumps(
            {
                "integration": "live_ai",
                "status": response.status,
                "model": response.model,
                "output_present": bool(response.output_text),
                "usage": response.usage.model_dump() if response.usage else None,
            }
        )
    )
    if response.status != "completed" or not response.output_text:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

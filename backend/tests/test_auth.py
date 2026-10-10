import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm

from app.auth import decode_access_token
from app.config import Settings


def test_signed_access_tokens_require_correct_identity_and_access_type(monkeypatch):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(private.public_key()))
    jwk.update(kid="first", alg="RS256", use="sig")
    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", lambda self: {"keys": [jwk]})
    settings = Settings(
        auth_mode="oidc",
        oidc_issuer="https://identity.example",
        oidc_audience="api",
        oidc_jwks_url="https://identity.example/jwks",
        _env_file=None,
    )
    claims = {
        "sub": "pm",
        "iss": settings.oidc_issuer,
        "aud": "api",
        "exp": int(time.time()) + 60,
        "iat": int(time.time()),
        "token_use": "access",
    }

    def token(body):
        return jwt.encode(body, private, algorithm="RS256", headers={"kid": "first"})

    assert decode_access_token(token(claims), settings) == "pm"
    with pytest.raises(HTTPException):
        decode_access_token(
            jwt.encode(
                claims | {"token_use": "id"},
                private,
                algorithm="RS256",
                headers={"kid": "first", "typ": "at+jwt"},
            ),
            settings,
        )
    for changed in (
        {"exp": 1},
        {"aud": "elsewhere"},
        {"iss": "https://forged.example"},
        {"token_use": "id"},
        {"sub": ""},
    ):
        with pytest.raises(HTTPException) as caught:
            decode_access_token(token(claims | changed), settings)
        assert caught.value.status_code == 401
    with pytest.raises(HTTPException):
        decode_access_token(
            jwt.encode(claims, "forged" * 8, algorithm="HS256"), settings
        )


def test_jwks_rotation_fetches_unknown_key(monkeypatch):
    from app.auth import jwks_client

    first = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    second = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    keys = []
    for kid, private in (("old", first), ("new", second)):
        jwk = json.loads(RSAAlgorithm.to_jwk(private.public_key()))
        keys.append(jwk | {"kid": kid, "alg": "RS256", "use": "sig"})
    calls = []

    def fetch(self):
        calls.append(1)
        return {"keys": keys[:1] if len(calls) == 1 else keys}

    monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", fetch)
    settings = Settings(
        auth_mode="oidc",
        oidc_issuer="https://rotation.example",
        oidc_audience="api",
        oidc_jwks_url="https://rotation.example/jwks",
        _env_file=None,
    )
    jwks_client.cache_clear()
    claims = {
        "sub": "pm",
        "iss": settings.oidc_issuer,
        "aud": "api",
        "exp": int(time.time()) + 60,
        "iat": int(time.time()),
        "token_use": "access",
    }
    assert (
        decode_access_token(
            jwt.encode(claims, second, algorithm="RS256", headers={"kid": "new"}),
            settings,
        )
        == "pm"
    )
    assert len(calls) == 2

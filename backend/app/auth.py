from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, NoReturn

import jwt
from fastapi import Header, HTTPException
from sqlalchemy import select

from app.config import Settings
from app.db import Membership, Session
from app.wire import Error


def reject(code: str, message: str, status: int = 401) -> NoReturn:
    raise HTTPException(status, Error(code=code, message=message).model_dump())


@lru_cache(maxsize=8)
def jwks_client(url: str) -> jwt.PyJWKClient:
    # Refresh unknown key IDs; cached JWKS expire after five minutes.
    return jwt.PyJWKClient(url, cache_jwk_set=True, lifespan=300, timeout=5)


def decode_access_token(token: str, settings: Settings) -> str:
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            reject("invalid_token", "Invalid API access token")
        key = jwks_client(settings.oidc_jwks_url).get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=settings.oidc_audience,
            issuer=settings.oidc_issuer,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
        if claims.get("token_use") == "id" or (
            header.get("typ") != "at+jwt" and claims.get("token_use") != "access"
        ):
            reject("invalid_token", "An API access token is required")
        actor_id = claims.get("sub")
        if not isinstance(actor_id, str) or not actor_id:
            reject("invalid_token", "Invalid token subject")
        return actor_id
    except jwt.PyJWTError:
        reject("invalid_token", "Invalid API access token")


@dataclass(frozen=True)
class Actor:
    actor_id: str
    workspace_id: str
    actor_type: str


def actor(
    authorization: Annotated[str | None, Header()] = None,
    x_workspace_id: Annotated[str | None, Header()] = None,
) -> Actor:
    settings = Settings()
    if not authorization or not authorization.startswith("Bearer "):
        reject("authentication_required", "Bearer authentication is required")
    token = authorization.removeprefix("Bearer ")
    if settings.auth_mode == "development":
        if not token.startswith("development:") or not token.removeprefix(
            "development:"
        ):
            reject("invalid_token", "Invalid development identity")
        actor_id = token.removeprefix("development:")
    else:
        actor_id = decode_access_token(token, settings)
    if not x_workspace_id:
        reject("workspace_required", "X-Workspace-ID is required", 403)
    with Session() as session:
        membership = session.scalar(
            select(Membership).where(
                Membership.workspace_id == x_workspace_id,
                Membership.actor_id == actor_id,
            )
        )
        if not membership:
            reject("forbidden", "Workspace access denied", 403)
        return Actor(
            actor_id, x_workspace_id, "pm" if membership.role == "pm" else "service"
        )

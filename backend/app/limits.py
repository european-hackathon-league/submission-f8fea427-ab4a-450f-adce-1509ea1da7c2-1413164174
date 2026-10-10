from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.wire import Error


class BodyLimit:
    def __init__(self, app: ASGIApp, limit: int = 64 * 1024 * 1024):
        self.app = app
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        size = 0
        exceeded = False
        replaced = False

        async def bounded_receive() -> Message:
            nonlocal size, exceeded
            message = await receive()
            if message["type"] == "http.request":
                size += len(message.get("body", b""))
                if size > self.limit:
                    exceeded = True
                    raise HTTPException(
                        413,
                        Error(
                            code="request_size_limit",
                            message="Request exceeds the configured byte limit",
                        ).model_dump(),
                    )
            return message

        async def bounded_send(message: Message) -> None:
            nonlocal replaced
            if exceeded:
                if not replaced:
                    replaced = True
                    request_id = (
                        dict(message.get("headers", []))
                        .get(b"x-request-id", b"")
                        .decode()
                    )
                    response = JSONResponse(
                        status_code=413,
                        content=Error(
                            code="request_size_limit",
                            message="Request exceeds the configured byte limit",
                        ).model_dump(),
                        headers={"X-Request-ID": request_id},
                    )
                    await response(scope, receive, send)
                return
            await send(message)

        await self.app(scope, bounded_receive, bounded_send)

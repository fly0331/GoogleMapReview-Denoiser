from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class RequestBodyLimit:
    def __init__(self, app: ASGIApp, path: str, limit: int):
        self.app = app
        self.path = path
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != self.path:
            await self.app(scope, receive, send)
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(chunk) > self.limit - len(body):
                response = JSONResponse(status_code=413, content={"detail": {
                    "code": "REQUEST_BODY_TOO_LARGE",
                    "message": "評論資料超過傳輸上限，請改用較少的評論。",
                }})
                await response(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        request: Message | None = {"type": "http.request", "body": bytes(body), "more_body": False}
        del body

        async def receive_checked_body() -> Message:
            nonlocal request
            if request is None:
                return await receive()
            message, request = request, None
            return message

        await self.app(scope, receive_checked_body, send)

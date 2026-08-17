"""FastAPI 進入點。

Vercel 會載入本模組的頂層變數 `app` 作為 ASGI handler
（見 pyproject.toml 的 [tool.vercel] entrypoint）。
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.resolve import router as resolve_router
from app.api.routes import router
from app.config import settings
from app.schemas.envelope import api_fail

app = FastAPI(
    title="BizMate Agent Service",
    version=settings.service_version,
    description="BizMate 的 AI 層：tool-calling agent、parser、clarification 與 eval",
)

app.include_router(router)
app.include_router(resolve_router)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """把 Pydantic 驗證錯誤轉成統一信封。

    FastAPI 預設回傳 {"detail": [...]} 的巢狀結構，與 TS 端的
    {success, data, error} 不同形狀。統一成同一套，TS client 才不必為
    422 另寫一條解析分支。
    """
    first = exc.errors()[0] if exc.errors() else None
    location = ".".join(str(part) for part in first["loc"][1:]) if first else ""
    message = first["msg"] if first else "請求內容不合規格"
    detail = f"{location}: {message}" if location else message

    return JSONResponse(status_code=422, content=api_fail(detail))


@app.exception_handler(StarletteHTTPException)
async def handle_http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """把 HTTPException（含 401）轉成統一信封。"""
    return JSONResponse(status_code=exc.status_code, content=api_fail(str(exc.detail)))

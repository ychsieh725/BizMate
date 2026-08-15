"""HTTP 路由。

A0 只有兩個端點：
- GET  /health      公開，供 Vercel 與監控探活
- POST /agent/echo  需認證，證明 TS → Python 呼叫鏈打通

A3 起 /agent/echo 會被真正的 /agent/resolve 取代。
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.auth import require_internal_secret
from app.config import settings
from app.schemas.envelope import api_ok

# 與客戶描述的長度上限一致（設計文件〈安全考量〉輸入層，zod 端亦為 2000）。
MAX_MESSAGE_LENGTH = 2000

router = APIRouter()


class EchoRequest(BaseModel):
    """echo 端點的請求主體。"""

    message: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)


@router.get("/health")
async def health() -> dict[str, object]:
    """探活端點。

    刻意公開且刻意貧乏——不回傳任何設定值。探活結果會被外部看到，
    它只需要回答「服務活著嗎、是哪個服務、哪一版」。
    """
    return api_ok(
        {
            "status": "ok",
            "service": settings.service_name,
            "version": settings.service_version,
        }
    )


@router.post("/agent/echo", dependencies=[Depends(require_internal_secret)])
async def echo(request: EchoRequest) -> dict[str, object]:
    """回傳收到的訊息——A0 的接縫驗收端點。

    沒有業務價值，唯一任務是證明路由、認證、主體解析、回應信封四者皆正常。
    """
    return api_ok({"echo": request.message, "service": settings.service_name})

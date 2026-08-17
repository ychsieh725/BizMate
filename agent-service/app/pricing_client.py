"""內部計價 API 的 client——不變式 I-1 的 Python 側。

**本服務沒有、也不該有任何計價邏輯。** 金額一律向 TypeScript 的
`POST /api/internal/pricing/compute` 索取。這不是「尚未搬移」，是刻意的邊界：
agent 在架構上碰不到計價程式碼，也沒有管道影響計算結果。

請注意本模組送出的請求**只含欄位值，不含任何金額**。若日後有人想在這裡加上
「建議金額」之類的參數，那就是在拆掉 I-1——請先回頭讀設計文件。
"""

import logging
from collections.abc import Awaitable, Callable

import httpx
from pydantic import BaseModel

from app.agent.fields import CaseCategory, FieldExtraction
from app.config import settings

logger = logging.getLogger(__name__)

COMPUTE_PATH = "/api/internal/pricing/compute"

# 計價是純查表，不含 LLM，正常在百毫秒內完成。留 15 秒是為了涵蓋
# Vercel 冷啟動，而非預期計價本身會慢。
PRICING_TIMEOUT_SECONDS = 15.0


class LineItem(BaseModel):
    item_name: str
    amount: float
    rule_id: str | None = None
    modifier_id: str | None = None
    agent_reasoning: str | None = None


class PricingResult(BaseModel):
    total: float
    out_of_scope: bool
    line_items: list[LineItem] = []


# compute_pricing 的簽名。讓 compute_quote tool 能宣告「我需要一個計價函式」
# 而非綁死具體實作——測試才有辦法在不碰網路的情況下注入假計價。
type ComputePricing = Callable[
    [str, CaseCategory, dict[str, FieldExtraction]], Awaitable[PricingResult]
]


class PricingUnavailableError(Exception):
    """計價服務無法取得結果。

    由上層轉為 pricing_unavailable，讓 TypeScript 端改用本地的
    computeBasePricing 接手（設計文件〈錯誤處理〉）。
    """


async def compute_pricing(
    merchant_id: str,
    category: CaseCategory,
    fields: dict[str, FieldExtraction],
) -> PricingResult:
    """向 TypeScript 服務索取計價結果。

    只送欄位的 value——計價不需要 confidence 與 source_span，送出去只是擴大
    了介面而沒有用處。
    """
    payload = {
        "merchant_id": merchant_id,
        "category": category,
        "fields": {name: {"value": field.value} for name, field in fields.items()},
    }

    url = f"{settings.web_service_url}{COMPUTE_PATH}"
    headers = {"x-internal-secret": settings.internal_service_secret}

    try:
        async with httpx.AsyncClient(timeout=PRICING_TIMEOUT_SECONDS) as client:
            response = await client.post(url, json=payload, headers=headers)
    except httpx.HTTPError as error:
        logger.warning("計價服務無法連線：%s", error)
        raise PricingUnavailableError(str(error)) from error

    if response.status_code != 200:
        logger.warning("計價服務回應 %s", response.status_code)
        raise PricingUnavailableError(f"HTTP {response.status_code}")

    body = response.json()
    if not body.get("success"):
        raise PricingUnavailableError(str(body.get("error")))

    return PricingResult.model_validate(body["data"])

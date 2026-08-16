"""compute_quote — 以目前已記錄的欄位計價（終止類）。

**不變式 I-1 的落地點。**

這個 tool 刻意宣告為無參數：agent 只能表達「我認為可以算了」這個意圖，
算什麼、怎麼算完全由程式端用 extracted_fields 已記錄的值決定，再交給
TypeScript 的內部計價 API。agent 無法夾帶任何影響金額的資訊。

無參數 + 跨服務邊界是雙重保障。約定會被違反，架構不會。
"""

from google.genai import types

from app.agent.fields import find_missing_fields
from app.agent.tools.base import ToolContext, ToolKind, ToolOutcome, rejected
from app.db.repositories.extracted_fields import (
    SupportsFieldStorage,
    extracted_fields_repository,
)
from app.pricing_client import (
    ComputePricing,
    PricingUnavailableError,
    compute_pricing,
)

NAME = "compute_quote"

DECLARATION = types.FunctionDeclaration(
    name=NAME,
    description=(
        "以目前已記錄的欄位產生報價。必要欄位齊全後呼叫，本次處理即結束。"
        "金額由系統依費率表計算，你無法指定。"
    ),
    # 刻意無參數。詳見模組 docstring。
    parameters_json_schema={"type": "object", "properties": {}},
)


class ComputeQuoteTool:
    """終止類 tool：呼叫即結束 loop，產生 parse_complete 事件。"""

    name = NAME
    kind: ToolKind = "terminal"
    declaration = DECLARATION

    def __init__(
        self,
        storage: SupportsFieldStorage | None = None,
        pricing: ComputePricing = compute_pricing,
    ) -> None:
        self._storage = storage or extracted_fields_repository
        self._pricing = pricing

    async def execute(self, args: dict[str, object], context: ToolContext) -> ToolOutcome:
        stored = await self._storage.find_by_session(context.session_id)
        still_missing = find_missing_fields(context.category, stored)

        # 仍有缺漏卻要求計價，視為判斷失誤，退回讓 agent 補問。
        # 預算用盡時的保守估算不走這條路徑——那由 loop 的 fallback 處理，
        # 因為「用盡預算後仍要出價」是流程決定，不該由模型自己判定。
        if still_missing:
            return rejected(
                f"必要欄位尚未齊全，仍缺：{'、'.join(still_missing)}。"
                "請先用 record_fields 補齊，或用 ask_customer 詢問客戶。"
            )

        try:
            pricing = await self._pricing(context.merchant_id, context.category, stored)
        except PricingUnavailableError as error:
            # 不回 rejected：這不是模型的錯，重試也不會好。交由上層 fallback
            # 用 TypeScript 本地的 computeBasePricing 接手。
            return ToolOutcome(
                status="error",
                result={"error": "pricing_unavailable"},
                error_detail=str(error),
            )

        return ToolOutcome(
            status="ok",
            event="parse_complete",
            result={
                "total": pricing.total,
                "out_of_scope": pricing.out_of_scope,
                "line_item_count": len(pricing.line_items),
            },
        )

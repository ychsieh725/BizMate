"""lookup_rate_card — 查詢商家在售的服務項目與欄位值域。

**存在理由**：讓 agent 在抽取前後都能查值域。現行架構把 allowedSubtypes 在
parse 之前就查好硬塞進 prompt，導致客戶要的東西不在 rate card 內時只能走
out_of_scope 退人工，無法追問「比較接近 A 還是 B」。有了這個 tool，
agent 可以先查再決定要不要問。

無 LLM、純 DB 查詢，故成本為 0、無對應 cost_logs 紀錄。
"""

from google.genai import types

from app.agent.fields import domain_for, required_fields_for
from app.agent.tools.base import ToolContext, ToolKind, ToolOutcome
from app.db.repositories.rate_card import (
    SupportsFindActiveServices,
    rate_card_repository,
)

NAME = "lookup_rate_card"

DECLARATION = types.FunctionDeclaration(
    name=NAME,
    description=(
        "查詢本商家目前在售的服務項目，以及各必要欄位的合法值域。"
        "在抽取欄位前先呼叫，可避免把客戶的說法錯配到不存在的服務項目。"
    ),
    # 刻意無參數：要查哪個商家、哪個類別由 ToolContext 決定，不讓模型指定。
    # 模型能指定 merchant_id 就等於能跨租戶查詢，那是越權。
    parameters_json_schema={"type": "object", "properties": {}},
)


class LookupRateCardTool:
    """查詢類 tool，可重複呼叫。"""

    name = NAME
    kind: ToolKind = "query"
    declaration = DECLARATION

    def __init__(self, repository: SupportsFindActiveServices | None = None) -> None:
        self._repository = repository or rate_card_repository

    async def execute(self, args: dict[str, object], context: ToolContext) -> ToolOutcome:
        services = await self._repository.find_active_services(
            context.merchant_id, context.category
        )
        subtypes = [service.subtype for service in services]

        field_options: dict[str, object] = {}
        for name in required_fields_for(context.category):
            domain = domain_for(name, subtypes)
            field_options[name] = list(domain) if domain else None

        return ToolOutcome(
            status="ok",
            result={
                "subtypes": subtypes,
                # 計價單位決定「數量 1」代表什麼。只給名稱時，模型無從判斷
                # 「一組貼圖，八款」該填 1 還是 8（A6 實測即因此算成 8 倍價）。
                "pricing_units": {service.subtype: service.unit for service in services},
                "field_options": field_options,
                "required_fields": required_fields_for(context.category),
            },
        )

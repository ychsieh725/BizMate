"""record_fields — 記錄抽取到的欄位，回報還缺什麼。

**整個設計最關鍵的一個 tool（不變式 I-2）。**

agent 得知「還缺什麼」的唯一管道，是這個 tool 依 confidence 門檻
deterministic 算出的 still_missing。它無法自行宣稱「都齊了」——即使模型在
文字裡說「資訊已足夠」，只要必要欄位未達門檻，compute_quote 仍會被擋下。

程式端在此做三件事：白名單過濾（拒絕自創欄位）、值域檢查、寫入
extracted_fields。三者都是防線：模型的輸出經過這裡才會成為系統的事實。
"""

from google.genai import types
from pydantic import ValidationError

from app.agent.fields import (
    FieldExtraction,
    domain_for,
    find_missing_fields,
    required_fields_for,
)
from app.agent.tools.base import ToolContext, ToolKind, ToolOutcome, rejected
from app.db.repositories.extracted_fields import (
    SupportsFieldStorage,
    extracted_fields_repository,
)
from app.db.repositories.rate_card import (
    SupportsFindActiveServices,
    rate_card_repository,
)

NAME = "record_fields"

DECLARATION = types.FunctionDeclaration(
    name=NAME,
    description=(
        "記錄你從客戶描述中抽取到的欄位。回傳哪些被接受、哪些被拒絕，"
        "以及還缺哪些必要欄位。這是你得知欄位是否齊全的唯一方式。"
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "fields": {
                "type": "object",
                "description": (
                    "欄位名稱對應到抽取結果。每個抽取結果包含 value（找不到填 null）、"
                    "confidence（0~1）、source_span（原文依據，找不到填 null）。"
                ),
                "additionalProperties": {
                    "type": "object",
                    "properties": {
                        "value": {"type": ["string", "null"]},
                        "confidence": {"type": "number"},
                        "source_span": {"type": ["string", "null"]},
                    },
                    "required": ["value", "confidence"],
                },
            }
        },
        "required": ["fields"],
    },
)


class RecordFieldsTool:
    """查詢類 tool，可重複呼叫（agent 可在反問後補記欄位）。"""

    name = NAME
    kind: ToolKind = "query"
    declaration = DECLARATION

    def __init__(
        self,
        storage: SupportsFieldStorage | None = None,
        rate_card: SupportsFindActiveServices | None = None,
    ) -> None:
        self._storage = storage or extracted_fields_repository
        self._rate_card = rate_card or rate_card_repository

    async def execute(self, args: dict[str, object], context: ToolContext) -> ToolOutcome:
        raw_fields = args.get("fields")
        if not isinstance(raw_fields, dict):
            return rejected("fields 必須是欄位名稱對應抽取結果的物件")

        allowed_names = set(required_fields_for(context.category))
        services = await self._rate_card.find_active_services(context.merchant_id, context.category)
        subtypes = [service.subtype for service in services]

        accepted: dict[str, FieldExtraction] = {}
        rejections: list[dict[str, str]] = []

        for name, payload in raw_fields.items():
            # 白名單：拒絕自創欄位。模型憑空發明的欄位不該進入系統，
            # 那是 prompt injection 最直接的落點。
            if name not in allowed_names:
                rejections.append({"field": name, "reason": f"{name} 不是本案件類型的必要欄位"})
                continue

            if not isinstance(payload, dict):
                rejections.append({"field": name, "reason": "抽取結果必須是物件"})
                continue

            try:
                field = FieldExtraction.model_validate(payload)
            except ValidationError as error:
                rejections.append(
                    {"field": name, "reason": f"格式不正確：{error.errors()[0]['msg']}"}
                )
                continue

            # 值域檢查：填了表外的值等同錯配，會導致查無費率而錯價。
            # 拒絕比勉強接受安全——被拒的欄位會回到缺漏清單，最多多問一題。
            domain = domain_for(name, subtypes)
            if domain is not None and field.value is not None and field.value not in domain:
                rejections.append(
                    {
                        "field": name,
                        "reason": f"「{field.value}」不在合法值域內：{'、'.join(domain)}",
                    }
                )
                continue

            accepted[name] = field

        await self._storage.upsert_many(context.session_id, accepted)

        # still_missing 依「目前已寫入的全部欄位」計算，而非只看本次送來的——
        # agent 可能分多次記錄，只看本次會誤報缺漏。
        stored = await self._storage.find_by_session(context.session_id)
        still_missing = find_missing_fields(context.category, stored)

        return ToolOutcome(
            status="rejected" if rejections and not accepted else "ok",
            result={
                "accepted": sorted(accepted),
                "rejected": rejections,
                "still_missing": still_missing,
            },
        )

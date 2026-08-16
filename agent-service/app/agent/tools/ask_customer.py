"""ask_customer — 向客戶提問缺漏的欄位（終止類）。

**與現況的關鍵差異**：現行流程把所有缺漏欄位一次批次問完（orderMissingFields
包成一輪）。改由 agent 決定要問哪幾題後，它可以只問最關鍵的 1–2 題，
客戶因此少答幾題——這是本次改動最主要的產品價值。

但 agent 的自由是有邊界的：每個 target_field 必須是 deterministic 算出的
still_missing 成員。模型不能發明問題來問客戶沒必要回答的事，也不能藉提問
把任意文字送到客戶面前。
"""

from google.genai import types

from app.agent.fields import find_missing_fields, order_missing_fields
from app.agent.tools.base import ToolContext, ToolKind, ToolOutcome, rejected
from app.db.repositories.clarification_turns import (
    SupportsCreateMany,
    clarification_turns_repository,
)
from app.db.repositories.extracted_fields import (
    SupportsFieldStorage,
    extracted_fields_repository,
)

NAME = "ask_customer"

# 全流程反問輪數上限（FR-CL-2）。與 TS 端 MAX_CLARIFICATION_ROUNDS 一致。
MAX_CLARIFICATION_ROUNDS = 3

# 單輪提問數上限。agent 可以少問，但不該把「批次全問」變成「一次問十題」。
MAX_QUESTIONS_PER_ROUND = 5

DECLARATION = types.FunctionDeclaration(
    name=NAME,
    description=(
        "向客戶提問以補齊缺漏的欄位。呼叫後本次處理即結束，等待客戶回答。"
        "只問真正需要的欄位——每少問一題，客戶完成報價的機會就高一分。"
    ),
    parameters_json_schema={
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "description": "要問客戶的問題，每題對應一個缺漏欄位",
                "items": {
                    "type": "object",
                    "properties": {
                        "target_field": {
                            "type": "string",
                            "description": "這題要補齊的欄位名稱，必須是尚缺的必要欄位",
                        },
                        "question": {
                            "type": "string",
                            "description": "自然、親切的中文問句，像真人客服",
                        },
                    },
                    "required": ["target_field", "question"],
                },
            }
        },
        "required": ["questions"],
    },
)


class AskCustomerTool:
    """終止類 tool：呼叫即結束 loop，產生 parse_incomplete 事件。"""

    name = NAME
    kind: ToolKind = "terminal"
    declaration = DECLARATION

    def __init__(
        self,
        turns: SupportsCreateMany | None = None,
        storage: SupportsFieldStorage | None = None,
    ) -> None:
        self._turns = turns or clarification_turns_repository
        self._storage = storage or extracted_fields_repository

    async def execute(self, args: dict[str, object], context: ToolContext) -> ToolOutcome:
        # 輪數上限先擋：用盡後不該再問，該轉保守估算（FR-CL-3）
        if context.completed_rounds >= MAX_CLARIFICATION_ROUNDS:
            return rejected(f"反問輪數已達上限 {MAX_CLARIFICATION_ROUNDS}，請改用 compute_quote")

        raw_questions = args.get("questions")
        if not isinstance(raw_questions, list) or not raw_questions:
            return rejected("questions 必須是至少含一題的陣列")

        if len(raw_questions) > MAX_QUESTIONS_PER_ROUND:
            return rejected(f"單輪最多 {MAX_QUESTIONS_PER_ROUND} 題，請只問最關鍵的欄位")

        stored = await self._storage.find_by_session(context.session_id)
        still_missing = find_missing_fields(context.category, stored)

        items: list[tuple[str, str]] = []
        for entry in raw_questions:
            if not isinstance(entry, dict):
                return rejected("每一題都必須是含 target_field 與 question 的物件")

            target_field = entry.get("target_field")
            question = entry.get("question")
            if not isinstance(target_field, str) or not isinstance(question, str):
                return rejected("target_field 與 question 都必須是字串")
            if not question.strip():
                return rejected("question 不可為空")

            # 不變式：target_field 必為缺漏清單成員。
            # 這同時擋掉「問不需要的欄位」與「藉提問把任意內容送到客戶面前」。
            if target_field not in still_missing:
                return rejected(
                    f"{target_field} 並非缺漏欄位，目前缺的是：{'、'.join(still_missing) or '無'}"
                )

            items.append((target_field, question.strip()))

        round_number = context.completed_rounds + 1
        await self._turns.create_many(context.session_id, round_number, items)

        return ToolOutcome(
            status="ok",
            event="parse_incomplete",
            result={
                "round": round_number,
                # 問題原文要回傳：TypeScript 端得把它交給客戶端的 wizard 顯示。
                # 只回欄位名的話，前端就得再查一次 DB 才拿得到問句。
                "questions": [
                    {"target_field": field, "question": question} for field, question in items
                ],
                "asked_fields": [field for field, _ in items],
                # 依「影響金額」優先序回報，供軌跡與後續分析對照
                "remaining_after_round": order_missing_fields(
                    [f for f in still_missing if f not in dict(items)]
                ),
            },
        )

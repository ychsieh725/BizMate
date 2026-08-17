"""真實依賴驗證：Gemini 呼叫與成本記帳（A2 驗收）。

單元測試用假 client 驗證重試、usage 萃取、function_call 解析等邏輯。這支腳本
補上另一半：真實模型是否遵守 response_json_schema、是否真的會回 function_call、
以及 token 用量是否正確落進 cost_logs。

沿用專案既有的 verify:* 慣例——需要真實金鑰，故不進 CI，由人手動執行。

用法：
    cd agent-service
    uv run python -m scripts.verify_llm

需要 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、GEMINI_API_KEY、
INTERNAL_SERVICE_SECRET。
"""

import asyncio
import sys

from google.genai import types
from pydantic import BaseModel, Field

from app.db.client import as_rows, get_client
from app.db.repositories.cost_logs import TABLE_NAME
from app.llm.cost import generate_structured_and_log, generate_with_tools_and_log

VERIFY_AGENT_NAME = "verify_llm_script"


class ExtractedNeed(BaseModel):
    """驗證用的抽取形狀，刻意貼近真實的 parser 輸出。"""

    subtype: str = Field(description="服務項目")
    quantity: int = Field(description="數量")


LOOKUP_RATE_CARD = types.FunctionDeclaration(
    name="lookup_rate_card",
    description="查詢本商家提供的服務項目與各欄位的合法值域",
    parameters_json_schema={
        "type": "object",
        "properties": {
            "category": {"type": "string", "description": "案件類型"},
        },
        "required": ["category"],
    },
)


async def cleanup() -> None:
    """移除本次驗證寫入的成本紀錄。"""
    client = await get_client()
    await client.table(TABLE_NAME).delete().eq("agent_name", VERIFY_AGENT_NAME).execute()


async def fetch_cost_logs() -> list[dict[str, object]]:
    client = await get_client()
    result = (
        await client.table(TABLE_NAME).select("*").eq("agent_name", VERIFY_AGENT_NAME).execute()
    )
    return as_rows(result.data)


async def verify_structured_output() -> bool:
    print("\n--- 結構化輸出 ---")
    result = await generate_structured_and_log(
        tier="light",
        prompt="客戶說：我要做三款品牌識別設計。請抽取欄位。",
        schema=ExtractedNeed,
        agent_name=VERIFY_AGENT_NAME,
        system_instruction="你是需求解析助手。只抽取指定欄位，不得自創。",
    )

    print(f"✓ 模型回傳合乎 schema：{result.data!r}")
    print(f"✓ 模型：{result.model}")

    if result.usage.total_tokens <= 0:
        print(f"✗ token 用量異常：{result.usage!r}")
        return False
    print(
        f"✓ token 用量：in={result.usage.input_tokens} "
        f"out={result.usage.output_tokens} total={result.usage.total_tokens}"
    )

    if result.latency_ms <= 0:
        print("✗ 延遲未計入")
        return False
    print(f"✓ 延遲：{result.latency_ms}ms")
    return True


async def verify_tool_calling() -> bool:
    print("\n--- tool-calling 回合 ---")
    contents = [
        types.Content(
            role="user",
            parts=[types.Part(text="客戶想做 LOGO。先查一下我們平面設計類有哪些服務項目。")],
        )
    ]

    result, cost_log_id = await generate_with_tools_and_log(
        tier="light",
        contents=contents,
        tools=[LOOKUP_RATE_CARD],
        agent_name=VERIFY_AGENT_NAME,
        system_instruction="你是報價助手。需要資訊時請呼叫提供的 tool。",
    )

    if result.tool_call is None:
        print(f"✗ 模型未要求呼叫 tool，回了文字：{result.text!r}")
        print("  （非程式錯誤——模型有時會直接回答。可重跑一次確認。）")
        return False

    print(f"✓ 模型要求呼叫 tool：{result.tool_call.name}")
    print(f"✓ 參數：{result.tool_call.args!r}")

    if result.tool_call.name != LOOKUP_RATE_CARD.name:
        print(f"✗ 呼叫了未宣告的 tool：{result.tool_call.name}")
        return False

    if cost_log_id is None:
        print("✗ 未取得 cost_log_id，agent_steps 將無法歸因成本")
        return False
    print(f"✓ cost_log_id：{cost_log_id}")
    return True


async def verify_cost_logs_written() -> bool:
    print("\n--- cost_logs 落地 ---")
    rows = await fetch_cost_logs()

    if len(rows) != 2:
        print(f"✗ 預期 2 筆成本紀錄（結構化 + tool-calling），實際 {len(rows)} 筆")
        return False
    print("✓ 兩次呼叫各留下一筆紀錄")

    for row in rows:
        if not isinstance(row["input_tokens"], int) or row["input_tokens"] <= 0:
            print(f"✗ input_tokens 未正確寫入：{row['input_tokens']!r}")
            return False
    print("✓ token 用量已寫入")

    if any(float(str(row["cost_usd"])) <= 0 for row in rows):
        print("✗ cost_usd 為 0——請確認 MODEL_PRICING 有該模型的定價")
        return False
    print(f"✓ 成本已換算：{[str(row['cost_usd']) for row in rows]}")
    return True


async def main() -> int:
    print("=== Gemini 呼叫與成本記帳驗證 ===")
    await cleanup()  # 清掉前次殘留，確保計數準確

    try:
        checks = [
            await verify_structured_output(),
            await verify_tool_calling(),
            await verify_cost_logs_written(),
        ]
    finally:
        await cleanup()
        print("\n✓ 已清理測試資料")

    if not all(checks):
        print("\n=== 有項目未通過 ===")
        return 1

    print("\n=== 全部通過 ===")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

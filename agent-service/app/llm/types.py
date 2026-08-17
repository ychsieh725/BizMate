"""LLM 呼叫層的資料形狀。

刻意與 TypeScript 端 src/lib/gemini/types.ts 對齊：兩端會在同一份 golden set
上跑 eval，資料形狀不同會讓指標無法直接比較。
"""

from typing import Any

from google.genai import types
from pydantic import BaseModel


class TokenUsage(BaseModel):
    """單次呼叫的 token 用量。"""

    input_tokens: int
    output_tokens: int
    total_tokens: int


class GenerateResult[T: BaseModel](BaseModel):
    """結構化輸出的呼叫結果。"""

    data: T
    model: str
    usage: TokenUsage
    latency_ms: int


class ToolCall(BaseModel):
    """模型要求呼叫的一個 tool。"""

    name: str
    args: dict[str, Any]


class ToolTurnResult(BaseModel):
    """一個 tool-calling 回合的結果。

    模型每一輪只會二擇一：要求呼叫 tool（tool_call 有值），或直接回文字
    （text 有值）。兩者同時為 None 代表模型回了空回應，屬異常，由呼叫端處置。

    **本型別刻意只表達「一輪」**：conversation 的累積與迭代由 agent loop（A4）
    負責。把迴圈控制留在 loop 而非藏進 LLM 層，是「自寫 loop」這個決策的核心
    ——迴圈的終止條件與預算必須看得見、測得到。
    """

    tool_call: ToolCall | None = None
    text: str | None = None
    # 模型這一回合的原始 Content，供 loop 原樣回填 conversation。
    #
    # 為什麼不讓 loop 自己用 tool_call 重建：Gemini 3 的 function_call part 帶有
    # thought_signature，下一輪必須原樣附回，否則 API 直接回 400 INVALID_ARGUMENT。
    # 重建出來的 part 沒有這個簽章，loop 會在第二輪就死掉——這正是
    # scripts/verify_agent 抓到的真實缺陷（假 LLM 測不出來，因為假的不檢查簽章）。
    model_content: types.Content | None = None
    model: str
    usage: TokenUsage
    latency_ms: int


class GeminiError(Exception):
    """Gemini 呼叫失敗，帶模型與原始訊息上下文。"""

    def __init__(self, model: str, detail: str) -> None:
        self.model = model
        self.detail = detail
        super().__init__(f"[gemini:{model}] {detail}")

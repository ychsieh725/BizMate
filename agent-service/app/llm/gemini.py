"""Gemini 呼叫層。

兩個入口：
- generate_structured  單次結構化輸出（由 TS 的 generateStructured 移植）
- generate_with_tools  單一 tool-calling 回合（Python 端新增）

**兩者都只負責一次呼叫。** 多輪的 conversation 累積與終止判斷屬於 agent loop
（A4），不藏在這一層——迴圈的預算與終止條件必須看得見、測得到，這是設計文件
選擇自寫 loop 而非用框架的核心理由。

呼叫端不應直接用這兩個函式，而應走 cost.py 的 *_and_log 版本，
確保「每次 LLM 呼叫都留下 cost_logs」（沿用 TS 端 costLogger 的既有約束）。
"""

import asyncio
import json
import time
from collections.abc import Awaitable, Callable, Iterator

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm.config import MODEL_TIERS, ModelTier
from app.llm.types import (
    GeminiError,
    GenerateResult,
    TokenUsage,
    ToolCall,
    ToolTurnResult,
)

# 逾時／失敗重試次數。與 TS 端 generate.ts 的 MAX_RETRIES 一致。
MAX_RETRIES = 1

# 退避基數（毫秒）：第 n 次重試前等待 2**n * BACKOFF_BASE_MS。
BACKOFF_BASE_MS = 200

_client: genai.Client | None = None


def get_client() -> genai.Client:
    """取得共用的 Gemini client；首次呼叫時才建立（lazy）。"""
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


def extract_usage(
    metadata: types.GenerateContentResponseUsageMetadata | None,
) -> TokenUsage:
    """從 usage_metadata 萃取 token 用量。

    欄位缺漏一律以 0 補——成本記錄不該因為回應少了一個欄位就整個崩掉
    （沿用 TS 端 extractUsage 的既有處置）。
    """
    input_tokens = getattr(metadata, "prompt_token_count", None) or 0
    output_tokens = getattr(metadata, "candidates_token_count", None) or 0
    total_tokens = getattr(metadata, "total_token_count", None) or input_tokens + output_tokens
    return TokenUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
    )


def _iter_parts(response: types.GenerateContentResponse) -> Iterator[types.Part]:
    """走訪回應中的所有 part。"""
    for candidate in response.candidates or []:
        content = candidate.content
        yield from (content.parts if content else None) or []


def first_function_call(response: types.GenerateContentResponse) -> ToolCall | None:
    """取回應中的第一個 function_call。

    只取第一個：本設計一次只處理一個 tool 呼叫，讓每一步都能獨立記進
    agent_steps 並獨立計入 step 預算。平行多呼叫會讓軌跡與預算的對應變模糊。
    """
    for part in _iter_parts(response):
        call = part.function_call
        if call is not None and call.name:
            return ToolCall(name=call.name, args=dict(call.args or {}))
    return None


def first_text(response: types.GenerateContentResponse) -> str | None:
    """取回應中的第一段文字。"""
    for part in _iter_parts(response):
        if part.text:
            return part.text
    return None


async def _with_retry[R](model: str, operation: Callable[[], Awaitable[R]]) -> tuple[R, int]:
    """執行 operation，失敗重試一次並指數退避；回傳 (結果, 延遲毫秒)。

    重試涵蓋逾時、網路錯誤與 malformed 輸出——後者也值得重試，因為模型下一次
    取樣可能就回出合規的結果。故 operation 應把解析也包進來，讓解析失敗算失敗。
    """
    last_error: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        if attempt > 0:
            await asyncio.sleep((2**attempt * BACKOFF_BASE_MS) / 1000)
        started_at = time.perf_counter()
        try:
            result = await operation()
            return result, int((time.perf_counter() - started_at) * 1000)
        except Exception as error:  # noqa: BLE001 - 統一包成 GeminiError 拋出
            last_error = error

    raise GeminiError(model, str(last_error))


async def generate_structured[T: BaseModel](
    tier: ModelTier,
    prompt: str,
    schema: type[T],
    system_instruction: str | None = None,
) -> GenerateResult[T]:
    """以結構化輸出呼叫 Gemini。

    一份 Pydantic model 三用：產生 response_json_schema（強制模型回傳指定形狀）、
    驗證回傳內容（runtime 型別安全）、推導呼叫端拿到的型別。

    比 TS 端少一層轉換：zod 需經 z.toJSONSchema，Pydantic 的 model_json_schema
    是同一份定義的原生輸出，少一次轉換就少一處會漂移的地方。
    """
    model = MODEL_TIERS[tier]
    client = get_client()

    # system_instruction 直接傳（None 等同不設），不用條件式 dict 解包——
    # 後者會讓型別檢查器推不出參數對應，換來的只是「省略一個 None」。
    #
    # automatic_function_calling 明確停用：SDK 的預設是「啟用」，未宣告時
    # 即使完全沒給 tools，呼叫仍會走進 AFC 的 while 迴圈路徑並印出建議改用
    # Chat.send_message 的警告。結構化輸出永遠不需要 function calling，
    # 明確關掉可走最直接的路徑，也讓「本層不做多輪」這件事在程式碼上是顯式的。
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_json_schema=schema.model_json_schema(),
        system_instruction=system_instruction,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )

    async def operation() -> tuple[T, types.GenerateContentResponse]:
        response = await client.aio.models.generate_content(
            model=model, contents=prompt, config=config
        )
        text = first_text(response)
        if not text:
            raise ValueError("Gemini 回應無文字內容")
        # 解析放在重試範圍內：malformed 輸出觸發重試，而非直接失敗
        try:
            data = schema.model_validate(json.loads(text))
        except (ValidationError, json.JSONDecodeError) as error:
            raise ValueError(f"回應無法解析為 {schema.__name__}: {error}") from error
        return data, response

    (data, response), latency_ms = await _with_retry(model, operation)

    return GenerateResult[T](
        data=data,
        model=model,
        usage=extract_usage(response.usage_metadata),
        latency_ms=latency_ms,
    )


async def generate_with_tools(
    tier: ModelTier,
    contents: list[types.Content],
    tools: list[types.FunctionDeclaration],
    system_instruction: str | None = None,
) -> ToolTurnResult:
    """執行一個 tool-calling 回合。

    **關閉 SDK 的 automatic function calling。** SDK 預設會自己執行 tool 並
    續跑迴圈，那正是我們不要的——迴圈控制權必須留在 agent loop，否則
    step 預算、終止條件、軌跡記錄全都無從介入，等於把可靠度交給黑箱。
    """
    model = MODEL_TIERS[tier]
    client = get_client()

    config = types.GenerateContentConfig(
        tools=[types.Tool(function_declarations=tools)],
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        system_instruction=system_instruction,
    )

    async def operation() -> types.GenerateContentResponse:
        return await client.aio.models.generate_content(
            model=model, contents=contents, config=config
        )

    response, latency_ms = await _with_retry(model, operation)

    return ToolTurnResult(
        tool_call=first_function_call(response),
        text=first_text(response),
        model=model,
        usage=extract_usage(response.usage_metadata),
        latency_ms=latency_ms,
    )

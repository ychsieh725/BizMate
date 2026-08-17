"""LLM 呼叫的成本記帳。

由 TypeScript 端 src/domains/finops/costLogger.ts 移植，並沿用其兩條既有約束：

1. **各 agent 一律走 *_and_log 入口**，不直接呼叫 gemini.py 的函式，
   確保「每次 LLM 呼叫都留下 cost_logs」。
2. **記帳失敗不中斷主流程**——可觀測性不該擋業務。

A2 新增第三條：`generate_with_tools_and_log` 回傳 cost_log_id，
讓 agent loop 能把每一步的軌跡連回它花的錢。多步 agent 的成本會隨步數放大，
若只記總額而無法歸因到步，就查不出是哪一步在燒錢。
"""

import logging

from google.genai import types
from pydantic import BaseModel

from app.db.repositories.cost_logs import (
    CostLogRecord,
    SupportsCreate,
    cost_logs_repository,
)
from app.llm.config import MODEL_PRICING, ModelTier
from app.llm.gemini import generate_structured, generate_with_tools
from app.llm.types import GenerateResult, TokenUsage, ToolTurnResult

logger = logging.getLogger(__name__)


def compute_cost_usd(model: str, usage: TokenUsage) -> float:
    """依模型與 token 用量換算成本（USD）。

    找不到定價時以 0 計並警告，不拋錯——成本記錯是可容忍的，
    因為漏記定價而讓報價流程中斷則不是（沿用 TS 端的既有處置）。
    """
    pricing = MODEL_PRICING.get(model)
    if pricing is None:
        logger.warning("找不到 %s 的定價，成本以 0 記錄。請於 MODEL_PRICING 補上。", model)
        return 0.0

    input_cost = (usage.input_tokens / 1_000_000) * pricing.input_per_million
    output_cost = (usage.output_tokens / 1_000_000) * pricing.output_per_million
    return input_cost + output_cost


async def log_cost(
    session_id: str | None,
    agent_name: str,
    model: str,
    usage: TokenUsage,
    latency_ms: int | None = None,
    repository: SupportsCreate | None = None,
) -> str | None:
    """寫入一筆成本紀錄，回傳其 id。

    best-effort：寫入失敗只記錄錯誤並回 None，不拋。
    """
    repo = repository or cost_logs_repository
    record = CostLogRecord(
        session_id=session_id,
        agent_name=agent_name,
        model=model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cost_usd=compute_cost_usd(model, usage),
        latency_ms=latency_ms,
    )

    try:
        return await repo.create(record)
    except Exception:
        logger.exception("寫入 cost_logs 失敗（不中斷主流程）: agent=%s", agent_name)
        return None


async def generate_structured_and_log[T: BaseModel](
    tier: ModelTier,
    prompt: str,
    schema: type[T],
    agent_name: str,
    session_id: str | None = None,
    system_instruction: str | None = None,
    repository: SupportsCreate | None = None,
) -> GenerateResult[T]:
    """結構化輸出 + 自動記帳。各 agent 應使用此入口。"""
    result = await generate_structured(
        tier=tier,
        prompt=prompt,
        schema=schema,
        system_instruction=system_instruction,
    )
    await log_cost(
        session_id=session_id,
        agent_name=agent_name,
        model=result.model,
        usage=result.usage,
        latency_ms=result.latency_ms,
        repository=repository,
    )
    return result


async def generate_with_tools_and_log(
    tier: ModelTier,
    contents: list[types.Content],
    tools: list[types.FunctionDeclaration],
    agent_name: str,
    session_id: str | None = None,
    system_instruction: str | None = None,
    repository: SupportsCreate | None = None,
) -> tuple[ToolTurnResult, str | None]:
    """tool-calling 回合 + 自動記帳；回傳 (結果, cost_log_id)。

    比 generate_structured_and_log 多回一個 cost_log_id，是因為 agent loop
    需要把它寫進 agent_steps.cost_log_id——**多輪 tool-calling 的每一輪都是
    一次獨立計費的呼叫**，成本必須逐輪歸因，只記總額就查不出是哪一步在燒錢。
    """
    result = await generate_with_tools(
        tier=tier,
        contents=contents,
        tools=tools,
        system_instruction=system_instruction,
    )
    cost_log_id = await log_cost(
        session_id=session_id,
        agent_name=agent_name,
        model=result.model,
        usage=result.usage,
        latency_ms=result.latency_ms,
        repository=repository,
    )
    return result, cost_log_id

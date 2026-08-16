"""Agent loop——本專案自寫的 tool-calling 迴圈。

設計文件選擇自寫而非用 LangGraph，決定性理由是狀態來源：durable 狀態已在
Supabase 的 sessions 表，引入 checkpointer 會造成雙重事實來源。次要理由是
token 成本歸因的完整性。代價是這個檔案必須自己把迴圈控制寫對——所以它刻意
寫得直白：一個 while、六種出口、每一步都記軌跡。

**不變式 I-3**：任何非正常結束都回 fallback，由 TypeScript 端用既有的
resolveAfterParse 接手，產出與 agent 化之前完全一致的結果。agent 是加值層，
不是必經路徑。
"""

import logging
from typing import Literal, Protocol
from uuid import UUID

from google.genai import types
from pydantic import BaseModel

from app.agent.budget import Budget, BudgetTracker, ExhaustionReason
from app.agent.prompts import SYSTEM_INSTRUCTION
from app.agent.registry import build_registry, declarations_for
from app.agent.tools.base import SessionEvent, Tool, ToolContext
from app.llm.config import ModelTier
from app.llm.cost import compute_cost_usd, generate_with_tools_and_log
from app.llm.types import GeminiError, ToolTurnResult
from app.trace.agent_steps import AgentStepRecorder

logger = logging.getLogger(__name__)

AGENT_NAME = "agent_loop"
DEFAULT_TIER: ModelTier = "light"

# 非預算類的中止原因。與 ExhaustionReason 一起構成 fallback 的完整理由集合。
AbortReason = Literal[
    "no_tool_call",  # 模型回文字而非呼叫 tool
    "unknown_tool",  # 模型呼叫了未註冊的 tool
    "llm_error",  # Gemini 呼叫重試後仍失敗
    "tool_error",  # tool 執行時發生非模型可修正的錯誤
]

FallbackReason = ExhaustionReason | AbortReason


class GenerateWithTools(Protocol):
    """一次 tool-calling 回合的呼叫簽名，供測試注入假 LLM。"""

    async def __call__(
        self,
        *,
        tier: ModelTier,
        contents: list[types.Content],
        tools: list[types.FunctionDeclaration],
        agent_name: str,
        session_id: str | None,
        system_instruction: str | None,
    ) -> tuple[ToolTurnResult, str | None]: ...


class LoopResult(BaseModel):
    """一次 loop 的結果。

    completed 代表 agent 自行走到終點，event 為交回狀態機的事件；
    fallback 代表未能完成，由 TypeScript 端接手（不變式 I-3）。
    """

    outcome: Literal["completed", "fallback"]
    run_id: UUID
    steps_taken: int
    total_latency_ms: int
    total_cost_usd: float
    event: SessionEvent | None = None
    # 終止類 tool 的回傳，供上層組裝回應
    tool_result: dict[str, object] | None = None
    fallback_reason: FallbackReason | None = None


def _function_response_content(tool_name: str, result: dict[str, object]) -> types.Content:
    """把 tool 執行結果包成模型看得懂的 function_response。"""
    return types.Content(
        role="user",
        parts=[
            types.Part(function_response=types.FunctionResponse(name=tool_name, response=result))
        ],
    )


async def run_agent_loop(
    context: ToolContext,
    initial_prompt: str,
    registry: dict[str, Tool] | None = None,
    recorder: AgentStepRecorder | None = None,
    budget: Budget | None = None,
    tier: ModelTier = DEFAULT_TIER,
    generate: GenerateWithTools = generate_with_tools_and_log,
) -> LoopResult:
    """執行一次 agent loop。

    正常路徑：模型反覆呼叫查詢類 tool，最後呼叫終止類 tool 結束。
    任何異常路徑都回 fallback，**不拋例外**——上層需要的是「能不能繼續」的
    答案，而不是一個要處理的例外。
    """
    tools = registry if registry is not None else build_registry()
    declarations = declarations_for(tools)
    trace = recorder or AgentStepRecorder(session_id=context.session_id)
    tracker = BudgetTracker(budget)

    contents: list[types.Content] = [
        types.Content(role="user", parts=[types.Part(text=initial_prompt)])
    ]

    def finish(
        outcome: Literal["completed", "fallback"],
        event: SessionEvent | None = None,
        tool_result: dict[str, object] | None = None,
        fallback_reason: FallbackReason | None = None,
    ) -> LoopResult:
        return LoopResult(
            outcome=outcome,
            run_id=trace.run_id,
            steps_taken=tracker.steps,
            total_latency_ms=tracker.latency_ms,
            total_cost_usd=tracker.cost_usd,
            event=event,
            tool_result=tool_result,
            fallback_reason=fallback_reason,
        )

    async def abort(reason: FallbackReason, detail: str) -> LoopResult:
        """記下中止標記後回 fallback。

        軌跡上留一筆 status=fallback 的紀錄，讓事後查得出「它為什麼沒走完」——
        沒有這一筆，一次 fallback 在軌跡上與「跑到一半斷掉」無法區分。
        """
        logger.info("agent loop fallback：%s（%s）", reason, detail)
        await trace.record(tool_name=reason, status="fallback", error_detail=detail)
        return finish("fallback", fallback_reason=reason)

    while True:
        try:
            turn, cost_log_id = await generate(
                tier=tier,
                contents=contents,
                tools=declarations,
                agent_name=AGENT_NAME,
                session_id=context.session_id,
                # 三層防禦的 prompt 層。少了這個，客戶描述就能影響 tool 選擇。
                system_instruction=SYSTEM_INSTRUCTION,
            )
        except GeminiError as error:
            return await abort("llm_error", str(error))

        cost_usd = compute_cost_usd(turn.model, turn.usage)

        # 模型回文字而非呼叫 tool：它已無話可說，但流程還沒走完。
        # 這不是可修正的錯誤，直接交棒。
        if turn.tool_call is None:
            tracker.record_step("__text__", {}, turn.latency_ms, cost_usd)
            return await abort("no_tool_call", f"模型回覆文字：{turn.text!r}")

        tool_name = turn.tool_call.name
        args = turn.tool_call.args
        tracker.record_step(tool_name, args, turn.latency_ms, cost_usd)

        tool = tools.get(tool_name)
        if tool is None:
            # 模型呼叫了沒宣告的 tool。registry 保證宣告與派發同源，
            # 走到這裡代表模型幻覺出一個 tool 名稱。
            await trace.record(
                tool_name=tool_name,
                status="error",
                tool_args=args,
                error_detail="未註冊的 tool",
                cost_log_id=cost_log_id,
                latency_ms=turn.latency_ms,
            )
            return await abort("unknown_tool", tool_name)

        try:
            outcome = await tool.execute(args, context)
        except Exception as error:  # noqa: BLE001 - tool 的任何失敗都交棒，不中斷
            await trace.record(
                tool_name=tool_name,
                status="error",
                tool_args=args,
                error_detail=str(error),
                cost_log_id=cost_log_id,
                latency_ms=turn.latency_ms,
            )
            logger.exception("tool %s 執行失敗", tool_name)
            return await abort("tool_error", f"{tool_name}: {error}")

        await trace.record(
            tool_name=tool_name,
            status=outcome.status,
            tool_args=args,
            tool_result=outcome.result,
            error_detail=outcome.error_detail,
            cost_log_id=cost_log_id,
            latency_ms=turn.latency_ms,
        )

        # 終止類 tool 成功執行 → 正常結束，把事件交回狀態機
        if outcome.event is not None:
            return finish("completed", event=outcome.event, tool_result=outcome.result)

        # tool 回 error（如計價服務不可用）：非模型可修正，交棒
        if outcome.status == "error":
            return await abort("tool_error", outcome.error_detail or tool_name)

        # 預算檢查放在執行之後：讓最後一步的成果（欄位寫入）得以保留，
        # fallback 才能站在 agent 已完成的進度上繼續，而非從頭來過。
        exhaustion = tracker.exhausted()
        if exhaustion is not None:
            return await abort(exhaustion, f"已用 {tracker.steps} 步")

        # 查詢類 tool → 結果回填 conversation，進下一輪。
        #
        # 模型的回合原樣放回去（而非用 tool_name/args 重建）：一來下一輪它才看得到
        # 自己剛才做了什麼，不會重複呼叫同一個 tool；二來 Gemini 3 的 function_call
        # part 帶 thought_signature，少了它下一輪會被 API 以 400 擋下。
        if turn.model_content is None:
            return await abort("llm_error", "回應缺少模型回合內容，無法回填 conversation")
        contents.append(turn.model_content)
        contents.append(_function_response_content(tool_name, outcome.result))

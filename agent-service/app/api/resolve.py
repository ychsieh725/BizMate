"""POST /agent/resolve — agent loop 的對外入口。

TypeScript 的 orchestrator 呼叫這個端點取得「下一步該怎麼走」的決定。
本服務**不碰狀態轉移**：回傳的 event 是既有 SessionEvent 的字串，
由 TypeScript 的 transition() 處理。

**fallback 不是錯誤。** 它是一個正常的回應（HTTP 200），代表「agent 沒能
自行走完，請你接手」。回 5xx 會讓呼叫端把它當故障處理，那是誤解——
agent 是加值層，它讓路是設計的一部分（不變式 I-3）。
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.agent.fields import CaseCategory
from app.agent.loop import run_agent_loop
from app.agent.prompts import build_initial_prompt
from app.agent.tools.base import ToolContext
from app.api.auth import require_internal_secret
from app.schemas.envelope import api_ok

# 與客戶描述的長度上限一致（設計文件〈安全考量〉輸入層）。
MAX_RAW_TEXT_LENGTH = 2000

router = APIRouter()


class PriorAnswer(BaseModel):
    """先前輪次的一組問答。"""

    question: str
    answer: str


class ResolveRequest(BaseModel):
    """一次 agent loop 的輸入。

    merchant_id 與 category 由呼叫端（TypeScript）依 session 決定並傳入，
    **不由模型指定**——模型能指定商家就等於能跨租戶操作。
    """

    session_id: str = Field(min_length=1)
    merchant_id: str = Field(min_length=1)
    category: CaseCategory
    raw_text: str = Field(min_length=1, max_length=MAX_RAW_TEXT_LENGTH)
    completed_rounds: int = Field(default=0, ge=0)
    prior_answers: list[PriorAnswer] = []


@router.post("/agent/resolve", dependencies=[Depends(require_internal_secret)])
async def resolve(request: ResolveRequest) -> dict[str, object]:
    """執行一次 agent loop，回傳它的決定。"""
    context = ToolContext(
        session_id=request.session_id,
        merchant_id=request.merchant_id,
        category=request.category,
        completed_rounds=request.completed_rounds,
    )

    prompt = build_initial_prompt(
        request.category,
        request.raw_text,
        prior_answers=[(a.question, a.answer) for a in request.prior_answers],
    )

    result = await run_agent_loop(context, prompt)

    return api_ok(
        {
            "outcome": result.outcome,
            "event": result.event,
            "run_id": str(result.run_id),
            "steps_taken": result.steps_taken,
            "total_latency_ms": result.total_latency_ms,
            "total_cost_usd": result.total_cost_usd,
            "tool_result": result.tool_result,
            "fallback_reason": result.fallback_reason,
        }
    )

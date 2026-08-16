"""Tool 的共用契約。

四個 tool 分成兩類：

- **查詢類**（query）：可重複呼叫，結果回填 conversation 讓模型繼續決策
- **終止類**（terminal）：呼叫即結束 loop，產生一個既有的 SessionEvent

這個二分法是 agent 自主性的邊界。模型可以自由決定查幾次、何時收手，
但「收手之後怎麼走」由 SessionEvent 交回 TypeScript 的狀態機決定——
Python 服務不碰狀態轉移。
"""

from typing import Literal, Protocol

from google.genai import types
from pydantic import BaseModel

from app.agent.fields import CaseCategory
from app.db.repositories.agent_steps import AgentStepStatus

ToolKind = Literal["query", "terminal"]

# 與 TS 端 orchestrator/events.ts 對齊。agent loop 只會產生這兩個。
SessionEvent = Literal["parse_incomplete", "parse_complete"]


class ToolContext(BaseModel):
    """一次 agent loop 共用的上下文。

    由 orchestrator 在進入 loop 時建立，loop 期間不變。tool 需要的一切
    租戶／流程資訊都從這裡拿，不從模型的參數拿——**模型不能指定它要為
    哪個商家計價**，那是越權。
    """

    session_id: str
    merchant_id: str
    category: CaseCategory
    # 已完成的反問輪數，決定 ask_customer 還能不能再問
    completed_rounds: int = 0


class ToolOutcome(BaseModel):
    """tool 執行的結果。

    status 直接對應 agent_steps.status，讓軌跡記錄不需要再做一次轉換。
    """

    status: AgentStepStatus
    # 查詢類：回填給模型的內容。終止類：交給上層的結果。
    result: dict[str, object]
    error_detail: str | None = None
    # 終止類專屬：要交回 TypeScript 狀態機的事件
    event: SessionEvent | None = None


class Tool(Protocol):
    """所有 tool 的介面。"""

    name: str
    kind: ToolKind
    declaration: types.FunctionDeclaration

    async def execute(self, args: dict[str, object], context: ToolContext) -> ToolOutcome: ...


def rejected(detail: str) -> ToolOutcome:
    """參數不合規的統一回應。

    回 rejected 而非拋錯，是為了讓模型有機會修正後重送——但這一步仍計入
    step 預算，避免模型在錯誤參數上無限打轉。
    """
    return ToolOutcome(status="rejected", result={"error": detail}, error_detail=detail)

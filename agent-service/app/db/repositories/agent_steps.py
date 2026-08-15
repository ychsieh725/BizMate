"""agent_steps 表的 repository（append-only 觀測域）。

對應 migration 0009。此表只寫不改——軌跡是既成事實的紀錄，
任何「修正」都會讓它失去作為除錯依據的價值。
"""

from typing import Literal, Protocol
from uuid import UUID

from pydantic import BaseModel

from app.db.client import get_client

TABLE_NAME = "agent_steps"

# 與 migration 0009 的 agent_step_status enum 對齊。
# 兩邊都改才算改完——這裡少一個值只會在寫入時才被 Postgres 擋下。
AgentStepStatus = Literal["ok", "rejected", "error", "fallback"]


class AgentStepRecord(BaseModel):
    """單一 step 的軌跡紀錄。欄位對應 0009 的表結構。"""

    session_id: str
    run_id: UUID
    step_index: int
    tool_name: str
    status: AgentStepStatus
    tool_args: dict[str, object] | None = None
    tool_result: dict[str, object] | None = None
    error_detail: str | None = None
    cost_log_id: str | None = None
    latency_ms: int | None = None


class SupportsCreate(Protocol):
    """軌跡寫入的最小介面。

    記錄器只依賴這個介面而非具體 repository，測試才能不碰資料庫。
    """

    async def create(self, record: AgentStepRecord) -> None: ...


class AgentStepsRepository:
    """寫入 agent_steps。"""

    async def create(self, record: AgentStepRecord) -> None:
        client = await get_client()
        payload = record.model_dump(mode="json", exclude_none=True)
        await client.table(TABLE_NAME).insert(payload).execute()


agent_steps_repository = AgentStepsRepository()

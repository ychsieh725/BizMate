"""cost_logs 表的 repository（append-only 觀測域）。

沿用 TS 端既有的表（migration 0001），欄位與 costLogsRepository.ts 一致——
兩端寫進同一張表，schema 認知不一致會讓成本報表出現詭異的缺值。
"""

from typing import Protocol

from pydantic import BaseModel

from app.db.client import as_rows, get_client

TABLE_NAME = "cost_logs"


class CostLogRecord(BaseModel):
    """單次 LLM 呼叫的成本紀錄。"""

    session_id: str | None
    agent_name: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int | None = None


class SupportsCreate(Protocol):
    """成本寫入的最小介面，讓記帳邏輯的測試不必碰資料庫。"""

    async def create(self, record: CostLogRecord) -> str | None: ...


class CostLogsRepository:
    """寫入 cost_logs，回傳新紀錄的 id。

    回傳 id 是給 agent_steps.cost_log_id 用的——軌跡的每一步要能連回它花的錢，
    這正是「多步 agent 的成本歸因」得以成立的關鍵。
    """

    async def create(self, record: CostLogRecord) -> str | None:
        client = await get_client()
        payload = record.model_dump(mode="json")
        result = await client.table(TABLE_NAME).insert(payload).execute()
        rows = as_rows(result.data)
        if not rows:
            return None
        return str(rows[0]["id"])


cost_logs_repository = CostLogsRepository()

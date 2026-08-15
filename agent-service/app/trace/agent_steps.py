"""agent 決策軌跡記錄器。

一個 AgentStepRecorder 對應一次 agent loop：持有共用的 run_id 與遞增的
step_index，把每一步寫進 agent_steps。

設計約束（設計文件〈錯誤處理〉）：**寫入失敗不中斷主流程。**
沿用 costLogger.ts 的既有原則——可觀測性不該擋業務。軌跡掉一筆是遺憾，
報價流程掛掉是事故。
"""

import logging
from uuid import UUID, uuid4

from app.db.repositories.agent_steps import (
    AgentStepRecord,
    AgentStepStatus,
    SupportsCreate,
    agent_steps_repository,
)

logger = logging.getLogger(__name__)


class AgentStepRecorder:
    """一次 agent loop 的軌跡記錄器。"""

    def __init__(
        self,
        session_id: str,
        repository: SupportsCreate | None = None,
        run_id: UUID | None = None,
    ) -> None:
        self._session_id = session_id
        self._repository = repository or agent_steps_repository
        self._run_id = run_id or uuid4()
        self._next_step_index = 0

    @property
    def run_id(self) -> UUID:
        """本次 loop 的識別碼，供上層關聯其他紀錄。"""
        return self._run_id

    async def record(
        self,
        tool_name: str,
        status: AgentStepStatus,
        tool_args: dict[str, object] | None = None,
        tool_result: dict[str, object] | None = None,
        error_detail: str | None = None,
        cost_log_id: str | None = None,
        latency_ms: int | None = None,
    ) -> None:
        """記錄一個 step。

        step_index 於進入時就取用並遞增，**與寫入是否成功無關**。
        編號代表「agent loop 的第幾步」，不是「第幾次成功寫入」——寫入失敗時
        軌跡留下缺口，缺口本身就是「這裡有筆寫失敗」的訊號；若重用編號，
        軌跡會與 agent 實際走的步數對不上，比缺一筆更難除錯。
        """
        step_index = self._next_step_index
        self._next_step_index += 1

        record = AgentStepRecord(
            session_id=self._session_id,
            run_id=self._run_id,
            step_index=step_index,
            tool_name=tool_name,
            status=status,
            tool_args=tool_args,
            tool_result=tool_result,
            error_detail=error_detail,
            cost_log_id=cost_log_id,
            latency_ms=latency_ms,
        )

        try:
            await self._repository.create(record)
        except Exception:
            # 刻意攔截所有例外：這裡的任何失敗都不該影響報價流程。
            # 撞 UNIQUE (run_id, step_index) 也走這條——重複寫入被靜默吞掉
            # 正是預期行為，軌跡保持無歧義（見 migration 0009）。
            logger.exception(
                "寫入 agent_steps 失敗（不中斷主流程）: run_id=%s step_index=%s tool=%s",
                self._run_id,
                step_index,
                tool_name,
            )

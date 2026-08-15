"""agent 軌跡記錄器。

兩條硬約束，都是設計文件明訂的：

1. **best-effort**：寫入失敗絕不中斷主流程。沿用 costLogger.ts 既有原則——
   可觀測性不該擋業務。軌跡掉一筆是遺憾，報價流程掛掉是事故。
2. **step_index 反映 loop 的第幾步，而非第幾次成功寫入**。寫入失敗時仍然
   遞增，讓軌跡留下缺口——缺口本身就是「這裡有筆寫失敗了」的訊號；
   若改成重用編號，軌跡會與 agent 實際走的步數對不上，比缺一筆更糟。
"""

import pytest

from app.db.repositories.agent_steps import AgentStepRecord
from app.trace.agent_steps import AgentStepRecorder

SESSION_ID = "11111111-1111-4111-8111-111111111111"


class RecordingRepository:
    """把寫入攔下來的假 repository。"""

    def __init__(self) -> None:
        self.records: list[AgentStepRecord] = []

    async def create(self, record: AgentStepRecord) -> None:
        self.records.append(record)


class FailingRepository:
    """永遠寫入失敗的假 repository。"""

    def __init__(self) -> None:
        self.attempts = 0

    async def create(self, record: AgentStepRecord) -> None:
        self.attempts += 1
        raise RuntimeError("資料庫連線中斷")


@pytest.fixture
def repository() -> RecordingRepository:
    return RecordingRepository()


@pytest.fixture
def recorder(repository: RecordingRepository) -> AgentStepRecorder:
    return AgentStepRecorder(session_id=SESSION_ID, repository=repository)


async def test_records_tool_name_and_status(recorder, repository):
    await recorder.record(tool_name="lookup_rate_card", status="ok")

    assert repository.records[0].tool_name == "lookup_rate_card"
    assert repository.records[0].status == "ok"


async def test_step_index_starts_at_zero(recorder, repository):
    await recorder.record(tool_name="lookup_rate_card", status="ok")

    assert repository.records[0].step_index == 0


async def test_step_index_increments(recorder, repository):
    await recorder.record(tool_name="lookup_rate_card", status="ok")
    await recorder.record(tool_name="record_fields", status="ok")
    await recorder.record(tool_name="ask_customer", status="ok")

    assert [record.step_index for record in repository.records] == [0, 1, 2]


async def test_all_steps_share_one_run_id(recorder, repository):
    await recorder.record(tool_name="lookup_rate_card", status="ok")
    await recorder.record(tool_name="record_fields", status="ok")

    run_ids = {record.run_id for record in repository.records}
    assert len(run_ids) == 1


async def test_run_id_is_exposed_and_matches_records(recorder, repository):
    """上層需要 run_id 來關聯其他紀錄（如 eval 的 trajectory 比對）。"""
    await recorder.record(tool_name="lookup_rate_card", status="ok")

    assert recorder.run_id == repository.records[0].run_id


async def test_separate_recorders_get_distinct_run_ids(repository):
    first = AgentStepRecorder(session_id=SESSION_ID, repository=repository)
    second = AgentStepRecorder(session_id=SESSION_ID, repository=repository)

    await first.record(tool_name="lookup_rate_card", status="ok")
    await second.record(tool_name="lookup_rate_card", status="ok")

    assert repository.records[0].run_id != repository.records[1].run_id


async def test_carries_optional_fields(recorder, repository):
    await recorder.record(
        tool_name="record_fields",
        status="rejected",
        tool_args={"fields": {"subtype": "公司LOGO"}},
        tool_result={"rejected": ["subtype"]},
        error_detail="subtype 不在值域內",
        latency_ms=412,
    )

    record = repository.records[0]
    assert record.tool_args == {"fields": {"subtype": "公司LOGO"}}
    assert record.tool_result == {"rejected": ["subtype"]}
    assert record.error_detail == "subtype 不在值域內"
    assert record.latency_ms == 412


async def test_optional_fields_default_to_none(recorder, repository):
    """不含 LLM 呼叫的 tool 沒有 cost_log_id，該欄位須可為空。"""
    await recorder.record(tool_name="compute_quote", status="ok")

    assert repository.records[0].cost_log_id is None


class TestBestEffort:
    """寫入失敗不得中斷主流程。"""

    async def test_write_failure_does_not_raise(self):
        recorder = AgentStepRecorder(session_id=SESSION_ID, repository=FailingRepository())

        # 沒有 pytest.raises——這一行不拋，就是這條約束的驗收
        await recorder.record(tool_name="lookup_rate_card", status="ok")

    async def test_write_failure_still_advances_step_index(self):
        """失敗的那一步仍佔用編號，軌跡留下缺口而非錯位。"""
        failing = FailingRepository()
        recorder = AgentStepRecorder(session_id=SESSION_ID, repository=failing)
        recording = RecordingRepository()

        await recorder.record(tool_name="lookup_rate_card", status="ok")
        recorder._repository = recording  # type: ignore[attr-defined]
        await recorder.record(tool_name="record_fields", status="ok")

        assert failing.attempts == 1
        assert recording.records[0].step_index == 1

    async def test_subsequent_writes_continue_after_failure(self):
        """一次失敗不會讓記錄器停擺。"""
        failing = FailingRepository()
        recorder = AgentStepRecorder(session_id=SESSION_ID, repository=failing)

        await recorder.record(tool_name="lookup_rate_card", status="ok")
        await recorder.record(tool_name="record_fields", status="ok")

        assert failing.attempts == 2

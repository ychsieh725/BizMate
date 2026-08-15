"""LLM 成本記帳。

兩條沿用自 TS 端 costLogger.ts 的約束，各自有測試守著：
- 找不到定價時以 0 計並警告，不拋錯
- 寫入失敗不中斷主流程

外加 A2 新增的一條：generate_with_tools_and_log 必須回傳 cost_log_id，
否則 agent loop 無法把軌跡的每一步連回它花的錢。
"""

import pytest

from app.db.repositories.cost_logs import CostLogRecord
from app.llm import cost
from app.llm.types import TokenUsage

LIGHT_MODEL = "gemini-3.1-flash-lite"


class RecordingRepository:
    def __init__(self, cost_log_id: str | None = "cost-log-1") -> None:
        self.records: list[CostLogRecord] = []
        self._cost_log_id = cost_log_id

    async def create(self, record: CostLogRecord) -> str | None:
        self.records.append(record)
        return self._cost_log_id


class FailingRepository:
    async def create(self, record: CostLogRecord) -> str | None:
        raise RuntimeError("資料庫連線中斷")


class TestComputeCost:
    def test_computes_from_token_counts(self):
        # 1M input @ $0.25 + 1M output @ $1.5
        usage = TokenUsage(input_tokens=1_000_000, output_tokens=1_000_000, total_tokens=2_000_000)

        assert cost.compute_cost_usd(LIGHT_MODEL, usage) == pytest.approx(1.75)

    def test_scales_with_usage(self):
        usage = TokenUsage(input_tokens=1000, output_tokens=500, total_tokens=1500)

        expected = (1000 / 1_000_000) * 0.25 + (500 / 1_000_000) * 1.5
        assert cost.compute_cost_usd(LIGHT_MODEL, usage) == pytest.approx(expected)

    def test_unknown_model_costs_zero_without_raising(self):
        """漏記定價可容忍；因此讓報價流程中斷則否。"""
        usage = TokenUsage(input_tokens=1000, output_tokens=500, total_tokens=1500)

        assert cost.compute_cost_usd("gemini-未來新模型", usage) == 0.0

    def test_unknown_model_warns(self, caplog):
        usage = TokenUsage(input_tokens=1, output_tokens=1, total_tokens=2)

        cost.compute_cost_usd("gemini-未來新模型", usage)

        assert "MODEL_PRICING" in caplog.text


class TestLogCost:
    async def test_writes_record(self):
        repository = RecordingRepository()

        await cost.log_cost(
            session_id="session-1",
            agent_name="intake_parser",
            model=LIGHT_MODEL,
            usage=TokenUsage(input_tokens=100, output_tokens=50, total_tokens=150),
            latency_ms=1295,
            repository=repository,
        )

        record = repository.records[0]
        assert record.agent_name == "intake_parser"
        assert record.input_tokens == 100
        assert record.latency_ms == 1295

    async def test_returns_cost_log_id(self):
        repository = RecordingRepository(cost_log_id="abc-123")

        result = await cost.log_cost(
            session_id=None,
            agent_name="agent_loop",
            model=LIGHT_MODEL,
            usage=TokenUsage(input_tokens=1, output_tokens=1, total_tokens=2),
            repository=repository,
        )

        assert result == "abc-123"

    async def test_write_failure_does_not_raise(self):
        """可觀測性不該擋業務。"""
        result = await cost.log_cost(
            session_id=None,
            agent_name="agent_loop",
            model=LIGHT_MODEL,
            usage=TokenUsage(input_tokens=1, output_tokens=1, total_tokens=2),
            repository=FailingRepository(),
        )

        assert result is None

    async def test_accepts_null_session(self):
        """eval 批次執行時沒有 session，該欄位必須可為空。"""
        repository = RecordingRepository()

        await cost.log_cost(
            session_id=None,
            agent_name="eval_runner",
            model=LIGHT_MODEL,
            usage=TokenUsage(input_tokens=1, output_tokens=1, total_tokens=2),
            repository=repository,
        )

        assert repository.records[0].session_id is None


class TestGenerateStructuredAndLog:
    """各 agent 的統一入口，確保「每次 LLM 呼叫都留下 cost_logs」。"""

    async def test_logs_cost_and_returns_result(self, monkeypatch):
        from pydantic import BaseModel

        from app.llm.types import GenerateResult

        class Answer(BaseModel):
            subtype: str

        async def fake_generate(**_kwargs: object) -> GenerateResult[Answer]:
            return GenerateResult[Answer](
                data=Answer(subtype="品牌識別設計"),
                model=LIGHT_MODEL,
                usage=TokenUsage(input_tokens=80, output_tokens=40, total_tokens=120),
                latency_ms=1295,
            )

        monkeypatch.setattr(cost, "generate_structured", fake_generate)
        repository = RecordingRepository()

        result = await cost.generate_structured_and_log(
            tier="light",
            prompt="抽取欄位",
            schema=Answer,
            agent_name="intake_parser",
            session_id="session-1",
            repository=repository,
        )

        assert result.data.subtype == "品牌識別設計"
        assert repository.records[0].agent_name == "intake_parser"
        assert repository.records[0].input_tokens == 80

    async def test_write_failure_does_not_block_result(self, monkeypatch):
        """記帳掛掉不該讓抽取結果拿不到。"""
        from pydantic import BaseModel

        from app.llm.types import GenerateResult

        class Answer(BaseModel):
            subtype: str

        async def fake_generate(**_kwargs: object) -> GenerateResult[Answer]:
            return GenerateResult[Answer](
                data=Answer(subtype="插畫"),
                model=LIGHT_MODEL,
                usage=TokenUsage(input_tokens=1, output_tokens=1, total_tokens=2),
                latency_ms=1,
            )

        monkeypatch.setattr(cost, "generate_structured", fake_generate)

        result = await cost.generate_structured_and_log(
            tier="light",
            prompt="抽取欄位",
            schema=Answer,
            agent_name="intake_parser",
            repository=FailingRepository(),
        )

        assert result.data.subtype == "插畫"


class TestGenerateWithToolsAndLog:
    """每一輪 tool-calling 都是獨立計費的呼叫，必須逐輪歸因。"""

    async def test_returns_result_and_cost_log_id(self, monkeypatch):
        from app.llm.types import ToolCall, ToolTurnResult

        turn = ToolTurnResult(
            tool_call=ToolCall(name="lookup_rate_card", args={}),
            model=LIGHT_MODEL,
            usage=TokenUsage(input_tokens=10, output_tokens=5, total_tokens=15),
            latency_ms=420,
        )

        async def fake_generate(**_kwargs: object) -> ToolTurnResult:
            return turn

        monkeypatch.setattr(cost, "generate_with_tools", fake_generate)
        repository = RecordingRepository(cost_log_id="step-cost-1")

        result, cost_log_id = await cost.generate_with_tools_and_log(
            tier="light",
            contents=[],
            tools=[],
            agent_name="agent_loop",
            repository=repository,
        )

        assert result.tool_call is not None
        assert cost_log_id == "step-cost-1"
        assert repository.records[0].latency_ms == 420

    async def test_cost_log_id_is_none_when_write_fails(self, monkeypatch):
        """記帳失敗時軌跡仍要寫得下去，只是少了成本關聯。"""
        from app.llm.types import ToolTurnResult

        async def fake_generate(**_kwargs: object) -> ToolTurnResult:
            return ToolTurnResult(
                text="ok",
                model=LIGHT_MODEL,
                usage=TokenUsage(input_tokens=1, output_tokens=1, total_tokens=2),
                latency_ms=1,
            )

        monkeypatch.setattr(cost, "generate_with_tools", fake_generate)

        _result, cost_log_id = await cost.generate_with_tools_and_log(
            tier="light",
            contents=[],
            tools=[],
            agent_name="agent_loop",
            repository=FailingRepository(),
        )

        assert cost_log_id is None

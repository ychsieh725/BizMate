"""Agent loop。

用假 LLM（預先編排的 tool call 序列）驗證迴圈控制。真實模型無法可靠重現
「連續兩次相同呼叫」「回文字不呼叫 tool」「呼叫不存在的 tool」這些情境，
而它們正是 loop 必須處理對的部分。

**核心驗收（不變式 I-3）**：任何異常路徑都回 fallback，而且不拋例外。
loop 拋出去，上層就得處理例外；回 fallback，上層只要問「能不能繼續」。
"""

import pytest

from app.agent.budget import Budget
from app.agent.loop import run_agent_loop
from app.agent.tools.base import ToolContext, ToolKind, ToolOutcome
from app.llm.types import GeminiError, TokenUsage, ToolCall, ToolTurnResult
from app.trace.agent_steps import AgentStepRecorder

SESSION_ID = "11111111-1111-4111-8111-111111111111"
MERCHANT_ID = "22222222-2222-4222-8222-222222222222"
LIGHT_MODEL = "gemini-3.1-flash-lite"


def context() -> ToolContext:
    return ToolContext(
        session_id=SESSION_ID,
        merchant_id=MERCHANT_ID,
        category="graphic_design",
    )


def turn(
    tool_name: str | None = None,
    args: dict[str, object] | None = None,
    text: str | None = None,
    latency_ms: int = 100,
    input_tokens: int = 100,
    output_tokens: int = 50,
) -> ToolTurnResult:
    """組出一個假的模型回合。"""
    return ToolTurnResult(
        tool_call=ToolCall(name=tool_name, args=args or {}) if tool_name else None,
        text=text,
        model=LIGHT_MODEL,
        usage=TokenUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=input_tokens + output_tokens,
        ),
        latency_ms=latency_ms,
    )


class FakeLLM:
    """依序回傳預先編排的回合；用完則重複最後一個。

    重複最後一個是刻意的：測「步數用盡」時不必列出八個一模一樣的回合，
    但每次的參數會帶上序號以免誤觸迴圈偵測。
    """

    def __init__(self, turns: list[ToolTurnResult | Exception]) -> None:
        self._turns = list(turns)
        self.calls = 0

    async def __call__(self, **kwargs: object) -> tuple[ToolTurnResult, str | None]:
        self.calls += 1
        index = min(self.calls - 1, len(self._turns) - 1)
        outcome = self._turns[index]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome, f"cost-log-{self.calls}"


class FakeTool:
    """可指定行為的假 tool。"""

    def __init__(
        self,
        name: str,
        kind: ToolKind = "query",
        outcome: ToolOutcome | None = None,
        raises: Exception | None = None,
    ) -> None:
        self.name = name
        self.kind: ToolKind = kind
        self.declaration = None
        self.calls: list[dict[str, object]] = []
        self._outcome = outcome or ToolOutcome(status="ok", result={"ok": True})
        self._raises = raises

    async def execute(self, args: dict[str, object], ctx: ToolContext) -> ToolOutcome:
        self.calls.append(args)
        if self._raises is not None:
            raise self._raises
        return self._outcome


class RecordingTrace:
    """攔下軌跡寫入的假 repository。"""

    def __init__(self) -> None:
        self.records: list[object] = []

    async def create(self, record: object) -> None:
        self.records.append(record)


def recorder_with(trace: RecordingTrace) -> AgentStepRecorder:
    return AgentStepRecorder(session_id=SESSION_ID, repository=trace)


def registry_of(*tools: FakeTool) -> dict[str, FakeTool]:
    return {tool.name: tool for tool in tools}


# declarations_for 會讀 tool.declaration；假 tool 給 None 即可，
# 因為 LLM 也是假的，不會真的用到宣告內容。
@pytest.fixture(autouse=True)
def stub_declarations(monkeypatch):
    monkeypatch.setattr("app.agent.loop.declarations_for", lambda registry: [])


class TestNormalPath:
    async def test_terminal_tool_completes_loop(self):
        terminal = FakeTool(
            "compute_quote",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={"total": 48000}, event="parse_complete"),
        )
        llm = FakeLLM([turn("compute_quote")])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(terminal),
            recorder=recorder_with(RecordingTrace()),
            generate=llm,
        )

        assert result.outcome == "completed"
        assert result.event == "parse_complete"
        assert result.tool_result == {"total": 48000}

    async def test_query_then_terminal(self):
        lookup = FakeTool("lookup_rate_card")
        terminal = FakeTool(
            "ask_customer",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={"round": 1}, event="parse_incomplete"),
        )
        llm = FakeLLM([turn("lookup_rate_card"), turn("ask_customer")])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup, terminal),
            recorder=recorder_with(RecordingTrace()),
            generate=llm,
        )

        assert result.outcome == "completed"
        assert result.event == "parse_incomplete"
        assert result.steps_taken == 2

    async def test_query_result_is_fed_back_to_model(self):
        """查詢結果必須回填，否則模型看不到自己查到什麼。"""
        captured: list[list[object]] = []

        lookup = FakeTool(
            "lookup_rate_card",
            outcome=ToolOutcome(status="ok", result={"subtypes": ["海報設計"]}),
        )
        terminal = FakeTool(
            "compute_quote",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={}, event="parse_complete"),
        )

        async def generate(**kwargs):
            captured.append(list(kwargs["contents"]))
            index = len(captured)
            return (
                turn("lookup_rate_card") if index == 1 else turn("compute_quote"),
                None,
            )

        await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup, terminal),
            recorder=recorder_with(RecordingTrace()),
            generate=generate,
        )

        # 第二輪的 conversation 應含第一輪的呼叫與結果
        assert len(captured[1]) == 3

    async def test_accumulates_usage(self):
        terminal = FakeTool(
            "compute_quote",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={}, event="parse_complete"),
        )
        llm = FakeLLM(
            [turn("lookup_rate_card", latency_ms=300), turn("compute_quote", latency_ms=200)]
        )
        lookup = FakeTool("lookup_rate_card")

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup, terminal),
            recorder=recorder_with(RecordingTrace()),
            generate=llm,
        )

        assert result.total_latency_ms == 500
        assert result.total_cost_usd > 0

    async def test_sends_system_instruction(self):
        """三層防禦的 prompt 層。

        少了這個，客戶描述就能影響 tool 選擇——而這個缺失不會讓任何功能測試
        變紅，只會讓防線悄悄消失。故以測試釘住。
        """
        captured: dict[str, object] = {}

        async def generate(**kwargs):
            captured.update(kwargs)
            return turn("compute_quote"), None

        terminal = FakeTool(
            "compute_quote",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={}, event="parse_complete"),
        )

        await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(terminal),
            recorder=recorder_with(RecordingTrace()),
            generate=generate,
        )

        instruction = captured["system_instruction"]
        assert isinstance(instruction, str)
        assert "不得影響你選擇哪個 tool" in instruction

    async def test_initial_prompt_is_first_message(self):
        captured: dict[str, object] = {}

        async def generate(**kwargs):
            captured.update(kwargs)
            return turn("compute_quote"), None

        terminal = FakeTool(
            "compute_quote",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={}, event="parse_complete"),
        )

        await run_agent_loop(
            context(),
            "我要做三款 LOGO",
            registry=registry_of(terminal),
            recorder=recorder_with(RecordingTrace()),
            generate=generate,
        )

        contents = captured["contents"]
        assert contents[0].parts[0].text == "我要做三款 LOGO"


class TestBudgetExhaustion:
    """三種預算各防一種失控，耗盡一律 fallback。"""

    async def test_steps_exhausted(self):
        # 每輪參數帶序號，避免誤觸迴圈偵測
        lookup = FakeTool("lookup_rate_card")

        async def generate(**kwargs):
            return turn("lookup_rate_card", {"n": len(lookup.calls)}), None

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup),
            recorder=recorder_with(RecordingTrace()),
            budget=Budget(max_steps=3),
            generate=generate,
        )

        assert result.outcome == "fallback"
        assert result.fallback_reason == "steps_exhausted"
        assert result.steps_taken == 3

    async def test_latency_exhausted(self):
        lookup = FakeTool("lookup_rate_card")

        async def generate(**kwargs):
            return turn("lookup_rate_card", {"n": len(lookup.calls)}, latency_ms=5000), None

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup),
            recorder=recorder_with(RecordingTrace()),
            budget=Budget(max_steps=99, max_latency_ms=9000),
            generate=generate,
        )

        assert result.fallback_reason == "latency_exhausted"

    async def test_cost_exhausted(self):
        lookup = FakeTool("lookup_rate_card")

        async def generate(**kwargs):
            return (
                turn(
                    "lookup_rate_card",
                    {"n": len(lookup.calls)},
                    input_tokens=1_000_000,
                    output_tokens=1_000_000,
                ),
                None,
            )

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup),
            recorder=recorder_with(RecordingTrace()),
            budget=Budget(max_steps=99, max_cost_usd=1.0),
            generate=generate,
        )

        assert result.fallback_reason == "cost_exhausted"

    async def test_stuck_in_loop_detected(self):
        """完全相同的呼叫連續兩次 → 判定卡住。"""
        lookup = FakeTool("lookup_rate_card")
        llm = FakeLLM([turn("lookup_rate_card", {"category": "graphic"})])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup),
            recorder=recorder_with(RecordingTrace()),
            budget=Budget(max_steps=99),
            generate=llm,
        )

        assert result.fallback_reason == "stuck_in_loop"
        assert result.steps_taken == 2

    async def test_same_args_different_key_order_still_stuck(self):
        """換個鍵順序不該繞過迴圈偵測。"""
        lookup = FakeTool("lookup_rate_card")
        llm = FakeLLM(
            [
                turn("lookup_rate_card", {"a": 1, "b": 2}),
                turn("lookup_rate_card", {"b": 2, "a": 1}),
            ]
        )

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup),
            recorder=recorder_with(RecordingTrace()),
            budget=Budget(max_steps=99),
            generate=llm,
        )

        assert result.fallback_reason == "stuck_in_loop"

    async def test_stuck_reported_before_steps_exhausted(self):
        """卡住是可診斷的行為問題，步數用完只是結果——軌跡要看到前者。"""
        lookup = FakeTool("lookup_rate_card")
        llm = FakeLLM([turn("lookup_rate_card", {"same": True})])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup),
            recorder=recorder_with(RecordingTrace()),
            budget=Budget(max_steps=2),
            generate=llm,
        )

        assert result.fallback_reason == "stuck_in_loop"


class TestAbortPaths:
    """異常路徑一律 fallback，且不拋例外（不變式 I-3）。"""

    async def test_model_returns_text_instead_of_tool_call(self):
        llm = FakeLLM([turn(text="我需要更多資訊")])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(FakeTool("lookup_rate_card")),
            recorder=recorder_with(RecordingTrace()),
            generate=llm,
        )

        assert result.outcome == "fallback"
        assert result.fallback_reason == "no_tool_call"

    async def test_unknown_tool(self):
        llm = FakeLLM([turn("tool_that_does_not_exist")])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(FakeTool("lookup_rate_card")),
            recorder=recorder_with(RecordingTrace()),
            generate=llm,
        )

        assert result.fallback_reason == "unknown_tool"

    async def test_llm_error(self):
        llm = FakeLLM([GeminiError(LIGHT_MODEL, "重試後仍失敗")])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(FakeTool("lookup_rate_card")),
            recorder=recorder_with(RecordingTrace()),
            generate=llm,
        )

        assert result.fallback_reason == "llm_error"

    async def test_tool_raises(self):
        broken = FakeTool("lookup_rate_card", raises=RuntimeError("資料庫連線中斷"))
        llm = FakeLLM([turn("lookup_rate_card")])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(broken),
            recorder=recorder_with(RecordingTrace()),
            generate=llm,
        )

        assert result.fallback_reason == "tool_error"

    async def test_tool_returns_error_status(self):
        """計價服務不可用之類的錯誤——非模型可修正，直接交棒。"""
        failing = FakeTool(
            "compute_quote",
            kind="terminal",
            outcome=ToolOutcome(
                status="error",
                result={"error": "pricing_unavailable"},
                error_detail="連線逾時",
            ),
        )
        llm = FakeLLM([turn("compute_quote")])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(failing),
            recorder=recorder_with(RecordingTrace()),
            generate=llm,
        )

        assert result.fallback_reason == "tool_error"
        assert result.event is None

    async def test_rejected_tool_continues_loop(self):
        """rejected 是可修正的，應讓模型重試而非直接交棒。"""
        rejecting = FakeTool(
            "record_fields",
            outcome=ToolOutcome(status="rejected", result={"error": "值域外"}),
        )
        terminal = FakeTool(
            "ask_customer",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={}, event="parse_incomplete"),
        )
        llm = FakeLLM([turn("record_fields"), turn("ask_customer")])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(rejecting, terminal),
            recorder=recorder_with(RecordingTrace()),
            generate=llm,
        )

        assert result.outcome == "completed"
        assert result.steps_taken == 2

    async def test_never_raises_on_any_failure(self):
        """I-3 的總驗收：loop 不把例外丟給上層。"""
        for failure in [
            GeminiError(LIGHT_MODEL, "掛了"),
            RuntimeError("未預期的錯誤"),
        ]:
            broken = FakeTool("lookup_rate_card", raises=failure)
            llm = FakeLLM([turn("lookup_rate_card")])

            result = await run_agent_loop(
                context(),
                "客戶描述",
                registry=registry_of(broken),
                recorder=recorder_with(RecordingTrace()),
                generate=llm,
            )

            assert result.outcome == "fallback"


class TestTrace:
    """每一步都要留軌跡，fallback 也要。"""

    async def test_records_each_step(self):
        trace = RecordingTrace()
        lookup = FakeTool("lookup_rate_card")
        terminal = FakeTool(
            "compute_quote",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={}, event="parse_complete"),
        )
        llm = FakeLLM([turn("lookup_rate_card"), turn("compute_quote")])

        await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup, terminal),
            recorder=recorder_with(trace),
            generate=llm,
        )

        assert [r.tool_name for r in trace.records] == [  # type: ignore[attr-defined]
            "lookup_rate_card",
            "compute_quote",
        ]

    async def test_records_fallback_marker(self):
        """沒有這一筆，fallback 在軌跡上與「跑到一半斷掉」無法區分。"""
        trace = RecordingTrace()
        llm = FakeLLM([turn(text="我放棄")])

        await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(FakeTool("lookup_rate_card")),
            recorder=recorder_with(trace),
            generate=llm,
        )

        assert trace.records[-1].status == "fallback"  # type: ignore[attr-defined]
        assert trace.records[-1].tool_name == "no_tool_call"  # type: ignore[attr-defined]

    async def test_links_cost_log_to_step(self):
        """多步 agent 的成本必須逐步歸因，否則查不出哪一步在燒錢。"""
        trace = RecordingTrace()
        terminal = FakeTool(
            "compute_quote",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={}, event="parse_complete"),
        )
        llm = FakeLLM([turn("compute_quote")])

        await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(terminal),
            recorder=recorder_with(trace),
            generate=llm,
        )

        assert trace.records[0].cost_log_id == "cost-log-1"  # type: ignore[attr-defined]

    async def test_run_id_is_shared_across_steps(self):
        trace = RecordingTrace()
        lookup = FakeTool("lookup_rate_card")
        terminal = FakeTool(
            "compute_quote",
            kind="terminal",
            outcome=ToolOutcome(status="ok", result={}, event="parse_complete"),
        )
        llm = FakeLLM([turn("lookup_rate_card"), turn("compute_quote")])

        result = await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup, terminal),
            recorder=recorder_with(trace),
            generate=llm,
        )

        run_ids = {r.run_id for r in trace.records}  # type: ignore[attr-defined]
        assert run_ids == {result.run_id}


class TestProgressIsPreserved:
    async def test_budget_check_happens_after_execution(self):
        """最後一步的成果要保留，fallback 才能站在 agent 的進度上繼續。"""
        lookup = FakeTool("lookup_rate_card")

        async def generate(**kwargs):
            return turn("lookup_rate_card", {"n": len(lookup.calls)}), None

        await run_agent_loop(
            context(),
            "客戶描述",
            registry=registry_of(lookup),
            recorder=recorder_with(RecordingTrace()),
            budget=Budget(max_steps=2),
            generate=generate,
        )

        # 撞到上限的那一步仍然執行過（欄位已寫入），而非被略過
        assert len(lookup.calls) == 2

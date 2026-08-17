"""Agent 專屬的 4 項軌跡指標。

這裡驗的是設計文件〈待確認事項〉#4 定案的比對規則：**忽略查詢類 tool 的
連續重複，其餘嚴格比對順序**。規則本身就是被測的對象——寫錯了不會有任何
執行期錯誤，只會讓報告上的數字長期說謊。
"""

from eval.outcomes import ToolCallRecord, TrajectoryOutcome
from eval.trajectory import (
    canonical_sequence,
    compute_trajectory_metrics,
    query_tool_names,
    redundant_calls,
    sequence_matches,
)

LOOKUP = "lookup_rate_card"
RECORD = "record_fields"
ASK = "ask_customer"
COMPUTE = "compute_quote"

HAPPY_PATH = [LOOKUP, RECORD, COMPUTE]


def call(name: str, **args: object) -> ToolCallRecord:
    return ToolCallRecord(tool_name=name, args=args)


def trajectory(
    names: list[str] | None = None,
    calls: list[ToolCallRecord] | None = None,
    expected: list[str] | None = None,
    steps_taken: int = 3,
    outcome: str = "completed",
    fallback_reason: str | None = None,
) -> TrajectoryOutcome:
    resolved = calls if calls is not None else [call(name) for name in (names or HAPPY_PATH)]
    return TrajectoryOutcome(
        calls=resolved,
        expected_sequence=expected or HAPPY_PATH,
        steps_taken=steps_taken,
        outcome=outcome,  # type: ignore[arg-type]
        fallback_reason=fallback_reason,
    )


class TestQueryToolNames:
    def test_derived_from_registry(self):
        """kind 已是 registry 的事實，在指標層重列一次就多一個會漂移的地方。"""
        assert query_tool_names() == frozenset({LOOKUP, RECORD})

    def test_terminal_tools_are_excluded(self):
        assert ASK not in query_tool_names()
        assert COMPUTE not in query_tool_names()


class TestCanonicalSequence:
    def test_collapses_consecutive_query_repeats(self):
        """連續重複查詢由 redundant_call_rate 負責，序列比對不重複計價同一個缺陷。"""
        calls = [call(LOOKUP), call(LOOKUP), call(RECORD), call(COMPUTE)]

        assert canonical_sequence(calls) == HAPPY_PATH

    def test_keeps_non_consecutive_repeats(self):
        """查 → 記 → 查 → 記 是來回打轉，不該被收合成正常路徑。"""
        calls = [call(LOOKUP), call(RECORD), call(LOOKUP), call(RECORD)]

        assert canonical_sequence(calls) == [LOOKUP, RECORD, LOOKUP, RECORD]

    def test_collapses_regardless_of_arguments(self):
        """同一個查詢類 tool 連呼兩次仍是一次「查」，參數不同不改變路徑形狀。"""
        calls = [call(RECORD, fields={"a": 1}), call(RECORD, fields={"b": 2}), call(COMPUTE)]

        assert canonical_sequence(calls) == [RECORD, COMPUTE]

    def test_empty_calls(self):
        assert canonical_sequence([]) == []


class TestSequenceMatches:
    def test_exact_happy_path(self):
        assert sequence_matches(trajectory()) is True

    def test_skipping_lookup_is_a_mismatch(self):
        assert sequence_matches(trajectory(names=[RECORD, COMPUTE])) is False

    def test_wrong_terminal_tool_is_a_mismatch(self):
        """該問卻直接出價，是最該被抓到的一種「走錯路」。"""
        assert (
            sequence_matches(trajectory(names=HAPPY_PATH, expected=[LOOKUP, RECORD, ASK])) is False
        )


class TestRedundantCalls:
    def test_identical_call_counted_once_as_redundant(self):
        calls = [call(LOOKUP), call(LOOKUP), call(RECORD)]

        assert redundant_calls(calls) == 1

    def test_different_arguments_are_not_redundant(self):
        calls = [call(RECORD, fields={"a": 1}), call(RECORD, fields={"b": 2})]

        assert redundant_calls(calls) == 0

    def test_key_order_does_not_create_a_new_call(self):
        """指紋以 sort_keys 序列化——調換鍵順序不該逃過重複偵測。"""
        calls = [call(RECORD, a=1, b=2), call(RECORD, b=2, a=1)]

        assert redundant_calls(calls) == 1

    def test_non_adjacent_repeat_is_still_redundant(self):
        """A→B→A 也是原地打轉，只看相鄰會漏掉。"""
        calls = [call(LOOKUP), call(RECORD, fields={"a": 1}), call(LOOKUP)]

        assert redundant_calls(calls) == 1


class TestComputeTrajectoryMetrics:
    def test_all_on_happy_path(self):
        metrics = compute_trajectory_metrics([trajectory(), trajectory()])

        assert metrics.tool_sequence_match_rate == 1.0
        assert metrics.avg_steps_per_case == 3.0
        assert metrics.redundant_call_rate == 0.0
        assert metrics.fallback_rate == 0.0

    def test_fallback_rate(self):
        metrics = compute_trajectory_metrics(
            [
                trajectory(),
                trajectory(outcome="fallback", fallback_reason="steps_exhausted"),
            ]
        )

        assert metrics.fallback_rate == 0.5

    def test_redundant_rate_is_over_total_calls(self):
        metrics = compute_trajectory_metrics(
            [trajectory(calls=[call(LOOKUP), call(LOOKUP), call(RECORD), call(COMPUTE)])]
        )

        assert metrics.redundant_call_rate == 0.25

    def test_empty_input_is_none_not_zero(self):
        """沒有軌跡可評估，不等於 fallback 率是 0%。"""
        metrics = compute_trajectory_metrics([])

        assert metrics.tool_sequence_match_rate is None
        assert metrics.avg_steps_per_case is None
        assert metrics.redundant_call_rate is None
        assert metrics.fallback_rate is None

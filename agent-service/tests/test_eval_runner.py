"""Runner 的純規則。

Runner 本身是 IO 外殼（真實 Gemini、Supabase、計價 API），由
`uv run python -m eval.runner` 手動執行驗收。但裡面有一條純規則會安靜地
毀掉整份指標，必須單獨測。
"""

from eval.runner import calls_from_rows


def row(tool_name: str, status: str = "ok", tool_args: object = None) -> dict[str, object]:
    return {"tool_name": tool_name, "status": status, "tool_args": tool_args}


class TestCallsFromRows:
    def test_keeps_tool_calls_in_order(self):
        calls = calls_from_rows(
            [row("lookup_rate_card"), row("record_fields"), row("compute_quote")]
        )

        assert [call.tool_name for call in calls] == [
            "lookup_rate_card",
            "record_fields",
            "compute_quote",
        ]

    def test_drops_the_fallback_marker(self):
        """fallback 那筆的 tool_name 是原因字串，混進序列會讓比對永遠不相符。"""
        calls = calls_from_rows([row("lookup_rate_card"), row("llm_error", status="fallback")])

        assert [call.tool_name for call in calls] == ["lookup_rate_card"]

    def test_keeps_rejected_and_error_rows(self):
        """被拒或出錯的呼叫仍是 agent 做過的決定，是軌跡的一部分。"""
        calls = calls_from_rows(
            [row("record_fields", status="rejected"), row("made_up_tool", status="error")]
        )

        assert len(calls) == 2

    def test_preserves_arguments_for_redundancy_detection(self):
        calls = calls_from_rows([row("record_fields", tool_args={"fields": {"subtype": "LOGO"}})])

        assert calls[0].args == {"fields": {"subtype": "LOGO"}}

    def test_null_arguments_become_empty_dict(self):
        """指紋計算需要一個 dict；「無參數」與「空參數」對重複偵測是同一件事。"""
        calls = calls_from_rows([row("lookup_rate_card", tool_args=None)])

        assert calls[0].args == {}

    def test_empty_trajectory(self):
        assert calls_from_rows([]) == []

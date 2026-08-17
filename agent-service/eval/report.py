"""執行結果的報告格式化（純函式，不碰 IO）。

比例型指標一律印成 `97.1% [93.2%, 99.0%]`——點估計加 95% Wilson 區間。
只印點估計會讓 36 則樣本上的兩三則差異看起來像實質改善，那是這份 eval
最容易誤導人的地方。

報告尾端列出未通過的案例與各自的 notes：指標告訴你退步了多少，案例清單才
告訴你該去看哪裡。
"""

from unicodedata import east_asian_width

from eval.analysis import observed_power_note, wilson_interval
from eval.metrics import proportion_counts
from eval.outcomes import CaseOutcome, EvalRunResult
from eval.trajectory import (
    canonical_sequence,
    query_tool_names,
    trajectory_proportion_counts,
)

LABEL_WIDTH = 22

# 樣本量檢定力的參照基準：現行單步 baseline 的欄位抽取準確率（7.1 實測）。
# 問「掉 5pp 察覺得到嗎」而非「漲 5pp」——97.5% 之上沒有 5pp 的空間。
BASELINE_FIELD_ACCURACY = 0.975
MEANINGFUL_REGRESSION = -0.05


def _display_width(text: str) -> int:
    """終端機上的顯示寬度。

    中文字元佔兩欄但 len() 只算一——直接用 f-string 的寬度對齊，中文標籤會全部
    歪掉。報告是這份 eval 唯一被人讀到的產物，對不齊就沒人願意讀完。
    """
    return sum(2 if east_asian_width(char) in "WF" else 1 for char in text)


def _row(label: str, value: str) -> str:
    padding = " " * max(1, LABEL_WIDTH - _display_width(label))
    return f"  {label}{padding}{value}"


def _proportion_row(label: str, counts: tuple[int, int]) -> str:
    successes, trials = counts
    estimate = wilson_interval(successes, trials)
    return _row(label, f"{estimate.format()}  ({successes}/{trials})")


def _optional(value: float | None, template: str) -> str:
    return "n/a" if value is None else template.format(value)


def _failing_cases(outcomes: list[CaseOutcome]) -> list[str]:
    """列出有欄位比對失敗的案例，附上錯在哪一欄。"""
    lines: list[str] = []
    for outcome in outcomes:
        wrong = [field for field in outcome.fields if not field.correct]
        if not wrong:
            continue
        detail = "；".join(
            f"{field.name}: 期望 {field.expected!r} 實際 {field.actual!r}" for field in wrong
        )
        lines.append(f"  {outcome.id:<16}{detail}")
    return lines


def _fallback_cases(outcomes: list[CaseOutcome]) -> list[str]:
    """列出 agent 未能自行走完的案例。基準線應為空——非空即代表不可靠。"""
    return [
        f"  {outcome.id:<16}{outcome.trajectory.fallback_reason}"
        for outcome in outcomes
        if outcome.trajectory is not None and outcome.trajectory.outcome == "fallback"
    ]


def _mismatched_sequences(outcomes: list[CaseOutcome]) -> list[str]:
    """列出走出非期望路徑的案例（收合連續重複查詢後仍不符）。"""
    queries = query_tool_names()
    lines: list[str] = []
    for outcome in outcomes:
        trajectory = outcome.trajectory
        if trajectory is None:
            continue
        actual = canonical_sequence(trajectory.calls, queries)
        if actual == trajectory.expected_sequence:
            continue
        lines.append(
            f"  {outcome.id:<16}期望 {' → '.join(trajectory.expected_sequence)}"
            f"｜實際 {' → '.join(actual) or '（無呼叫）'}"
        )
    return lines


def format_report(result: EvalRunResult) -> str:
    """組出完整報告。"""
    outcomes = result.outcomes
    metrics = result.metrics
    trajectory = result.trajectory_metrics
    counts = proportion_counts(outcomes)
    trajectory_counts = trajectory_proportion_counts(
        [o.trajectory for o in outcomes if o.trajectory is not None]
    )

    sections: list[str] = [
        "",
        "═══ Eval 報告（agent loop）═══",
        f"資料集 {result.dataset_version}｜模型 {result.model_version}｜{len(outcomes)} 則",
        "",
        "── 抽取品質（點估計 [95% Wilson CI]）──",
        _proportion_row("欄位抽取準確率", counts["field_extraction_accuracy"]),
        _row("欄位抽取 F1", _optional(metrics.field_extraction_f1, "{:.3f}")),
        _proportion_row("反問精準率", counts["clarification_precision"]),
        _proportion_row("反問召回率", counts["clarification_recall"]),
        _proportion_row("幻覺率", counts["hallucination_rate"]),
        "",
        "── 報價 ──",
        _proportion_row("端到端成功率", counts["end_to_end_success_rate"]),
        _row("報價偏差（平均）", _optional(metrics.quote_deviation_avg, "{:.1%}")),
        _row("報價偏差（最大）", _optional(metrics.quote_deviation_max, "{:.1%}")),
        "",
        "── 軌跡（agent 專屬）──",
        _proportion_row("tool 序列相符率", trajectory_counts["tool_sequence_match_rate"]),
        _row("平均步數", _optional(trajectory.avg_steps_per_case, "{:.2f}")),
        _proportion_row("重複呼叫率", trajectory_counts["redundant_call_rate"]),
        _proportion_row("fallback 率", trajectory_counts["fallback_rate"]),
        "",
        "── 成本與延遲 ──",
        _row("每案成本", _optional(metrics.cost_per_case_usd, "${:.6f}")),
        _row("平均延遲", _optional(metrics.latency_avg_ms, "{:.0f}ms")),
        _row("P95 延遲", _optional(metrics.latency_p95_ms, "{:.0f}ms")),
        "",
        "── 統計檢定力 ──",
        "  " + observed_power_note(len(outcomes), BASELINE_FIELD_ACCURACY, MEANINGFUL_REGRESSION),
    ]

    for title, lines in (
        ("欄位比對未通過", _failing_cases(outcomes)),
        ("agent 交棒（fallback）", _fallback_cases(outcomes)),
        ("走出非期望路徑", _mismatched_sequences(outcomes)),
    ):
        sections.extend(["", f"── {title}（{len(lines)} 則）──"])
        sections.extend(lines or ["  （無）"])

    return "\n".join(sections)

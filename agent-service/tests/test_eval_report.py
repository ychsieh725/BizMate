"""報告格式化。

報告是這份 eval 唯一會被人真正讀到的產物。這裡守兩件事：比例一律帶信賴區間
（只印點估計會讓兩三則的差異看起來像實質改善），以及退步時看得到「該去看哪裡」。
"""

from eval.comparison import FieldComparison
from eval.metrics import compute_metrics
from eval.outcomes import (
    CaseOutcome,
    EvalRunResult,
    ToolCallRecord,
    TrajectoryOutcome,
)
from eval.report import format_report
from eval.trajectory import compute_trajectory_metrics

HAPPY_PATH = ["lookup_rate_card", "record_fields", "compute_quote"]


def trajectory(
    names: list[str] | None = None,
    outcome: str = "completed",
    fallback_reason: str | None = None,
) -> TrajectoryOutcome:
    return TrajectoryOutcome(
        calls=[ToolCallRecord(tool_name=name) for name in (names or HAPPY_PATH)],
        expected_sequence=HAPPY_PATH,
        steps_taken=3,
        outcome=outcome,  # type: ignore[arg-type]
        fallback_reason=fallback_reason,
    )


def outcome(
    case_id: str = "graphic-001",
    correct: bool = True,
    trajectory_outcome: TrajectoryOutcome | None = None,
) -> CaseOutcome:
    return CaseOutcome(
        id=case_id,
        fields=[
            FieldComparison(
                name="subtype",
                expected="LOGO設計",
                actual="LOGO設計" if correct else "LOGO",
                correct=correct,
            )
        ],
        predicted_missing=[],
        expected_missing=[],
        expected_amount=1000.0,
        actual_amount=1000.0,
        out_of_scope=False,
        latency_ms=2400,
        cost_usd=0.0013,
        model_version="gemini-3.1-flash-lite",
        trajectory=trajectory_outcome if trajectory_outcome is not None else trajectory(),
    )


def build(outcomes: list[CaseOutcome]) -> EvalRunResult:
    return EvalRunResult(
        dataset_version="v1.0.0",
        model_version="gemini-3.1-flash-lite",
        outcomes=outcomes,
        metrics=compute_metrics(outcomes),
        trajectory_metrics=compute_trajectory_metrics(
            [o.trajectory for o in outcomes if o.trajectory is not None]
        ),
    )


class TestStructure:
    def test_includes_all_metric_sections(self):
        report = format_report(build([outcome()]))

        for section in ("抽取品質", "報價", "軌跡", "成本與延遲", "統計檢定力"):
            assert section in report

    def test_proportions_carry_confidence_intervals(self):
        """點估計不帶區間，就會讓小樣本的雜訊被讀成改善。"""
        report = format_report(build([outcome()]))

        assert "100.0% [" in report

    def test_shows_denominators(self):
        report = format_report(build([outcome()]))

        assert "(1/1)" in report

    def test_labels_align_by_display_width(self):
        """中文佔兩欄但 len() 算一——用字元數對齊，整份報告會歪掉。"""
        from eval.report import LABEL_WIDTH, _display_width, _row

        rows = [_row("每案成本", "A"), _row("tool 序列相符率", "A")]
        starts = [_display_width(row[: row.index("A")]) for row in rows]

        assert starts[0] == starts[1] == LABEL_WIDTH + 2


class TestActionableLists:
    def test_lists_failing_cases_with_the_offending_field(self):
        report = format_report(build([outcome(case_id="graphic-007", correct=False)]))

        assert "graphic-007" in report
        assert "subtype" in report

    def test_lists_fallback_cases_with_reason(self):
        report = format_report(
            build(
                [
                    outcome(
                        case_id="web-003",
                        trajectory_outcome=trajectory(
                            outcome="fallback", fallback_reason="steps_exhausted"
                        ),
                    )
                ]
            )
        )

        assert "web-003" in report
        assert "steps_exhausted" in report

    def test_lists_sequence_mismatches(self):
        report = format_report(
            build(
                [
                    outcome(
                        case_id="illu-002",
                        trajectory_outcome=trajectory(names=["record_fields", "compute_quote"]),
                    )
                ]
            )
        )

        assert "illu-002" in report
        assert "走出非期望路徑（1 則）" in report

    def test_clean_run_says_so_explicitly(self):
        """全綠時印「（無）」而非留白——空白會讓人以為報告壞了。"""
        report = format_report(build([outcome()]))

        assert "（無）" in report


class TestEmptyRun:
    def test_does_not_crash_without_outcomes(self):
        report = format_report(build([]))

        assert "n/a" in report

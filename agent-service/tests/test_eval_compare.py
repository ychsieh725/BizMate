"""兩份 eval 產物的配對對照（A6）。

這一層決定 A6 的結論長什麼樣子，而它有兩個容易寫錯、寫錯了也不會噴例外的地方：

**配對的正確性。** McNemar 檢定的前提是同一批案例。若兩側案例集不同卻仍照跑，
會得到一個看起來合理的 p 值，但那個數字沒有意義。故 id 不一致必須拋錯。

**「這則算對了嗎」的定義。** 三個判準各自對應一件商業上真的在意的事，且都不能
用「有沒有出價」草率代替——把該轉人工的案例硬出價，在指標上會長得像成功。
"""

from pathlib import Path

import pytest

from eval.artifact import EvalArtifact, artifact_from_run, write_artifact
from eval.compare import (
    CASE_PREDICATES,
    GATE_THRESHOLDS,
    compare_artifacts,
    format_comparison,
    pair_outcomes,
)
from eval.comparison import FieldComparison
from eval.outcomes import (
    CaseOutcome,
    EvalMetrics,
    EvalRunResult,
    ToolCallRecord,
    TrajectoryMetrics,
    TrajectoryOutcome,
)


def metrics(hallucination: float | None = 0.0) -> EvalMetrics:
    return EvalMetrics(
        field_extraction_accuracy=0.9,
        field_extraction_f1=0.88,
        clarification_precision=1.0,
        clarification_recall=0.75,
        hallucination_rate=hallucination,
        quote_deviation_avg=0.02,
        quote_deviation_max=0.11,
        end_to_end_success_rate=0.95,
        latency_avg_ms=2400.0,
        latency_p95_ms=4100.0,
        cost_per_case_usd=0.0012,
    )


def trajectory_metrics(fallback: float | None = 0.0) -> TrajectoryMetrics:
    return TrajectoryMetrics(
        tool_sequence_match_rate=0.83,
        avg_steps_per_case=3.1,
        redundant_call_rate=0.05,
        fallback_rate=fallback,
    )


def case(
    case_id: str,
    *,
    fields_correct: bool = True,
    expected_amount: float | None = 3000.0,
    actual_amount: float | None = 3000.0,
    predicted_missing: list[str] | None = None,
    expected_missing: list[str] | None = None,
    with_trajectory: bool = False,
) -> CaseOutcome:
    trajectory = (
        TrajectoryOutcome(
            calls=[ToolCallRecord(tool_name="lookup_rate_card")],
            expected_sequence=["lookup_rate_card"],
            steps_taken=3,
            outcome="completed",
        )
        if with_trajectory
        else None
    )
    return CaseOutcome(
        id=case_id,
        fields=[
            FieldComparison(
                name="subtype",
                expected="頭像",
                actual="頭像" if fields_correct else "全身",
                correct=fields_correct,
            )
        ],
        predicted_missing=predicted_missing or [],
        expected_missing=expected_missing or [],
        expected_amount=expected_amount,
        actual_amount=actual_amount,
        out_of_scope=actual_amount is None,
        latency_ms=2400,
        cost_usd=0.0012,
        model_version="gemini-flash-lite-latest",
        trajectory=trajectory,
    )


def artifact(
    variant: str,
    outcomes: list[CaseOutcome],
    hallucination: float | None = 0.0,
    fallback: float | None = 0.0,
) -> EvalArtifact:
    result = EvalRunResult(
        dataset_version="2026-08-15",
        model_version="gemini-flash-lite-latest",
        outcomes=outcomes,
        metrics=metrics(hallucination),
        trajectory_metrics=trajectory_metrics(fallback),
    )
    return artifact_from_run(result, variant=variant)  # type: ignore[arg-type]


class TestPairing:
    def test_pairs_by_id_regardless_of_order(self) -> None:
        baseline = [case("g-002"), case("g-001")]
        candidate = [case("g-001"), case("g-002")]

        pairs = pair_outcomes(baseline, candidate)

        assert [b.id for b, _ in pairs] == ["g-002", "g-001"]
        assert [c.id for _, c in pairs] == ["g-002", "g-001"]

    def test_mismatched_id_sets_raise(self) -> None:
        """案例集不同還硬比，會產出一個看起來合理但毫無意義的 p 值。"""
        with pytest.raises(ValueError, match="案例集不一致"):
            pair_outcomes([case("g-001")], [case("g-002")])

    def test_missing_case_on_one_side_raises(self) -> None:
        with pytest.raises(ValueError, match="案例集不一致"):
            pair_outcomes([case("g-001"), case("g-002")], [case("g-001")])

    def test_duplicate_id_raises(self) -> None:
        with pytest.raises(ValueError, match="重複"):
            pair_outcomes([case("g-001"), case("g-001")], [case("g-001"), case("g-001")])


class TestCasePredicates:
    def test_quote_correct_requires_matching_amount(self) -> None:
        predicate = CASE_PREDICATES["quote_correct"]

        assert predicate(case("g-001", expected_amount=3000.0, actual_amount=3000.0))
        assert not predicate(case("g-001", expected_amount=3000.0, actual_amount=2500.0))

    def test_quote_correct_treats_handoff_as_success(self) -> None:
        """標註即無法計價時，轉人工才是正確行為——出了價反而是錯的。"""
        predicate = CASE_PREDICATES["quote_correct"]

        assert predicate(case("g-001", expected_amount=None, actual_amount=None))
        assert not predicate(case("g-001", expected_amount=None, actual_amount=9999.0))

    def test_quote_correct_rejects_missing_amount_when_pricing_expected(self) -> None:
        predicate = CASE_PREDICATES["quote_correct"]

        assert not predicate(case("g-001", expected_amount=3000.0, actual_amount=None))

    def test_fields_all_correct(self) -> None:
        predicate = CASE_PREDICATES["fields_all_correct"]

        assert predicate(case("g-001", fields_correct=True))
        assert not predicate(case("g-001", fields_correct=False))

    def test_clarification_exact_compares_as_sets(self) -> None:
        """問題順序不代表品質，順序不同不該被判為錯。"""
        predicate = CASE_PREDICATES["clarification_exact"]

        assert predicate(case("g-001", predicted_missing=["b", "a"], expected_missing=["a", "b"]))
        assert not predicate(case("g-001", predicted_missing=["a"], expected_missing=["a", "b"]))


class TestCompareArtifacts:
    def test_counts_discordant_pairs_per_predicate(self) -> None:
        baseline = artifact(
            "baseline",
            [
                case("g-001", actual_amount=3000.0),  # 兩側都對
                case("g-002", actual_amount=2500.0),  # 只有 candidate 對
                case("g-003", actual_amount=3000.0),  # 只有 baseline 對
            ],
        )
        candidate = artifact(
            "agent",
            [
                case("g-001", actual_amount=3000.0, with_trajectory=True),
                case("g-002", actual_amount=3000.0, with_trajectory=True),
                case("g-003", actual_amount=1000.0, with_trajectory=True),
            ],
        )

        report = compare_artifacts(baseline, candidate)
        quote = next(c for c in report.comparisons if c.name == "quote_correct")

        assert quote.baseline_only_correct == 1
        assert quote.candidate_only_correct == 1
        assert quote.mcnemar.discordant == 2
        assert quote.baseline.successes == 2
        assert quote.candidate.successes == 2

    def test_case_count_and_versions_recorded(self) -> None:
        report = compare_artifacts(
            artifact("baseline", [case("g-001")]),
            artifact("agent", [case("g-001", with_trajectory=True)]),
        )

        assert report.case_count == 1
        assert report.dataset_version == "2026-08-15"

    def test_rejects_swapped_variants(self) -> None:
        """把 agent 當成 baseline 傳進來，對照表的每個箭頭方向都會反過來。"""
        with pytest.raises(ValueError, match="variant"):
            compare_artifacts(
                artifact("agent", [case("g-001")]),
                artifact("agent", [case("g-001")]),
            )

    def test_rejects_mismatched_dataset_version(self) -> None:
        baseline = artifact("baseline", [case("g-001")])
        candidate = artifact("agent", [case("g-001", with_trajectory=True)])
        candidate = candidate.model_copy(update={"dataset_version": "2026-01-01"})

        with pytest.raises(ValueError, match="dataset_version"):
            compare_artifacts(baseline, candidate)


class TestGates:
    def test_passes_when_gate_metrics_are_zero(self) -> None:
        report = compare_artifacts(
            artifact("baseline", [case("g-001")]),
            artifact(
                "agent",
                [case("g-001", with_trajectory=True)],
                hallucination=0.0,
                fallback=0.0,
            ),
        )

        assert report.passed
        assert all(gate.passed for gate in report.gates)

    def test_fails_when_hallucination_is_non_zero(self) -> None:
        """設計文件的硬門檻：幻覺率非 0 即不得開 flag。"""
        report = compare_artifacts(
            artifact("baseline", [case("g-001")]),
            artifact("agent", [case("g-001", with_trajectory=True)], hallucination=0.03),
        )

        assert not report.passed
        assert not next(g for g in report.gates if g.name == "hallucination_rate").passed

    def test_fails_when_fallback_is_non_zero(self) -> None:
        report = compare_artifacts(
            artifact("baseline", [case("g-001")]),
            artifact("agent", [case("g-001", with_trajectory=True)], fallback=0.05),
        )

        assert not report.passed

    def test_fails_when_gate_metric_is_unmeasurable(self) -> None:
        """None 代表分母為 0，量不到就不能宣稱通過——那是「不知道」，不是「合格」。"""
        report = compare_artifacts(
            artifact("baseline", [case("g-001")]),
            artifact("agent", [case("g-001", with_trajectory=True)], hallucination=None),
        )

        assert not report.passed

    def test_thresholds_are_zero(self) -> None:
        assert GATE_THRESHOLDS == {"hallucination_rate": 0.0, "fallback_rate": 0.0}


class TestFormatting:
    def test_report_contains_verdict_and_p_values(self) -> None:
        report = compare_artifacts(
            artifact("baseline", [case("g-001")]),
            artifact("agent", [case("g-001", with_trajectory=True)]),
        )

        text = format_comparison(report)

        assert "quote_correct" in text
        assert "p =" in text
        assert "GO" in text

    def test_failed_gate_shows_no_go(self) -> None:
        report = compare_artifacts(
            artifact("baseline", [case("g-001")]),
            artifact("agent", [case("g-001", with_trajectory=True)], hallucination=0.5),
        )

        assert "NO-GO" in format_comparison(report)

    def test_baseline_at_hundred_percent_does_not_crash(self) -> None:
        """基準線全對是 36 則樣本下的常見結果，樣本量公式在端點會退化。

        這條原本會讓整份報告拋 ValueError——跑完 10 分鐘的 eval 才在最後印報告時
        炸掉，資料都還在記憶體裡。屬於必須處理的正常路徑，不是例外狀況。
        """
        report = compare_artifacts(
            artifact("baseline", [case("g-001")]),
            artifact("agent", [case("g-001", with_trajectory=True)]),
        )

        text = format_comparison(report)

        assert "不提供檢定力估計" in text

    def test_power_note_appears_when_rate_is_interior(self) -> None:
        baseline = artifact(
            "baseline",
            [case(f"g-{i:03d}", actual_amount=3000.0 if i > 1 else 1.0) for i in range(1, 5)],
        )
        candidate = artifact(
            "agent",
            [case(f"g-{i:03d}", with_trajectory=True) for i in range(1, 5)],
        )

        text = format_comparison(compare_artifacts(baseline, candidate))

        assert "每組需" in text
        assert "-5.0%" in text


class TestRoundTripThroughDisk:
    def test_compares_artifacts_written_by_runners(self, tmp_path: Path) -> None:
        """對照的輸入永遠來自磁碟——這條路徑必須跟記憶體內的行為一致。"""
        from eval.artifact import load_artifact

        baseline_path = tmp_path / "baseline.json"
        candidate_path = tmp_path / "agent.json"
        write_artifact(baseline_path, artifact("baseline", [case("g-001")]))
        write_artifact(candidate_path, artifact("agent", [case("g-001", with_trajectory=True)]))

        report = compare_artifacts(load_artifact(baseline_path), load_artifact(candidate_path))

        assert report.case_count == 1
        assert report.passed

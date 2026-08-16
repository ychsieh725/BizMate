"""既有 11 項指標。

全部用手算得出來的小數字驗證——指標公式若只用真實資料驗，錯了也看不出來，
因為沒有人知道正確答案應該是多少。

移植自 TypeScript 的 metrics.test.ts，公式與邊界處置必須一致。
"""

from eval.comparison import FieldComparison
from eval.metrics import compute_metrics, percentile, proportion_counts, safe_ratio
from eval.outcomes import CaseOutcome


def field(name: str, expected: str | None, actual: str | None) -> FieldComparison:
    return FieldComparison(name=name, expected=expected, actual=actual, correct=expected == actual)


def outcome(
    case_id: str = "c1",
    fields: list[FieldComparison] | None = None,
    predicted_missing: list[str] | None = None,
    expected_missing: list[str] | None = None,
    expected_amount: float | None = None,
    actual_amount: float | None = None,
    latency_ms: int = 1000,
    cost_usd: float = 0.001,
) -> CaseOutcome:
    return CaseOutcome(
        id=case_id,
        fields=fields or [],
        predicted_missing=predicted_missing or [],
        expected_missing=expected_missing or [],
        expected_amount=expected_amount,
        actual_amount=actual_amount,
        out_of_scope=actual_amount is None,
        latency_ms=latency_ms,
        cost_usd=cost_usd,
    )


class TestSafeRatio:
    def test_zero_denominator_is_none_not_zero(self):
        """「無從評估」與「表現為 0」是不同的事實，混用會誤導判讀。"""
        assert safe_ratio(0, 0) is None

    def test_normal_ratio(self):
        assert safe_ratio(3, 4) == 0.75


class TestPercentile:
    def test_uses_nearest_rank(self):
        """與 TS 端同一套 ceil 秩次法，兩邊在同一批資料上要得到同一個值。"""
        assert percentile([10, 20, 30, 40], 0.95) == 40

    def test_empty_is_none(self):
        assert percentile([], 0.95) is None


class TestFieldAccuracy:
    def test_counts_correct_over_all(self):
        metrics = compute_metrics(
            [
                outcome(fields=[field("a", "1", "1"), field("b", "2", "X")]),
                outcome(fields=[field("a", "1", "1"), field("b", "2", "2")]),
            ]
        )

        assert metrics.field_extraction_accuracy == 0.75

    def test_correct_null_counts_as_correct(self):
        metrics = compute_metrics([outcome(fields=[field("a", None, None)])])

        assert metrics.field_extraction_accuracy == 1.0


class TestFieldF1:
    def test_perfect_extraction(self):
        metrics = compute_metrics([outcome(fields=[field("a", "1", "1")])])

        assert metrics.field_extraction_f1 == 1.0

    def test_wrong_value_counts_as_both_fp_and_fn(self):
        """抽錯值同時是誤報與漏報：precision = recall = 0 → F1 = 0。"""
        metrics = compute_metrics([outcome(fields=[field("a", "1", "X")])])

        assert metrics.field_extraction_f1 == 0.0

    def test_no_valued_fields_is_none(self):
        metrics = compute_metrics([outcome(fields=[field("a", None, None)])])

        assert metrics.field_extraction_f1 is None


class TestHallucination:
    def test_fabricated_value_where_annotation_is_null(self):
        metrics = compute_metrics(
            [outcome(fields=[field("a", None, "捏造"), field("b", None, None)])]
        )

        assert metrics.hallucination_rate == 0.5

    def test_no_null_annotations_means_unmeasurable(self):
        metrics = compute_metrics([outcome(fields=[field("a", "1", "1")])])

        assert metrics.hallucination_rate is None


class TestClarification:
    def test_precision_and_recall(self):
        metrics = compute_metrics(
            [
                outcome(
                    predicted_missing=["a", "b"],
                    expected_missing=["a", "c"],
                )
            ]
        )

        assert metrics.clarification_precision == 0.5
        assert metrics.clarification_recall == 0.5


class TestQuoteDeviation:
    def test_relative_deviation(self):
        metrics = compute_metrics([outcome(expected_amount=1000, actual_amount=1200)])

        assert metrics.quote_deviation_avg == 0.2

    def test_max_surfaces_the_disaster_case(self):
        """平均會稀釋極端錯價，最大值才看得到災難案例。"""
        metrics = compute_metrics(
            [
                outcome(case_id="c1", expected_amount=1000, actual_amount=1050),
                outcome(case_id="c2", expected_amount=1000, actual_amount=8000),
            ]
        )

        assert metrics.quote_deviation_max == 7.0

    def test_unpriceable_cases_are_skipped(self):
        metrics = compute_metrics([outcome(expected_amount=None, actual_amount=500)])

        assert metrics.quote_deviation_avg is None


class TestEndToEndSuccess:
    def test_denominator_excludes_unpriceable_annotations(self):
        """零資訊描述標註即無法計價，轉人工是正確行為——列入分母會低估表現。"""
        metrics = compute_metrics(
            [
                outcome(case_id="c1", expected_amount=1000, actual_amount=1000),
                outcome(case_id="c2", expected_amount=None, actual_amount=None),
            ]
        )

        assert metrics.end_to_end_success_rate == 1.0


class TestProportionCounts:
    def test_exposes_numerator_and_denominator(self):
        """統計層要算信賴區間，只有比例的話就看不出 97% 建立在多少樣本上。"""
        counts = proportion_counts([outcome(fields=[field("a", "1", "1"), field("b", "2", "X")])])

        assert counts["field_extraction_accuracy"] == (1, 2)

    def test_counts_agree_with_metrics(self):
        outcomes = [
            outcome(case_id="c1", fields=[field("a", "1", "1")], expected_missing=["b"]),
            outcome(case_id="c2", fields=[field("a", "1", "X")], predicted_missing=["b"]),
        ]
        counts = proportion_counts(outcomes)
        metrics = compute_metrics(outcomes)

        numerator, denominator = counts["field_extraction_accuracy"]
        assert metrics.field_extraction_accuracy == numerator / denominator


class TestCostAndLatency:
    def test_averages(self):
        metrics = compute_metrics(
            [
                outcome(case_id="c1", latency_ms=1000, cost_usd=0.001),
                outcome(case_id="c2", latency_ms=3000, cost_usd=0.003),
            ]
        )

        assert metrics.latency_avg_ms == 2000
        assert metrics.cost_per_case_usd == 0.002


class TestEmptyInput:
    def test_all_metrics_are_none(self):
        """空輸入不該回 0——那會讓 CI 閘門建立在假的滿分或假的零分上。"""
        metrics = compute_metrics([])

        assert metrics.field_extraction_accuracy is None
        assert metrics.latency_p95_ms is None
        assert metrics.cost_per_case_usd is None

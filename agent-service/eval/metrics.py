"""既有 11 項指標的計算（PRD §8.2）。

移植自 TypeScript 的 `src/domains/eval/metrics.ts`，公式與邊界處置逐一對齊——
A6 要把 agent 與單步 baseline 的同名指標並排比較，公式有任何差異就不是在比
能力，而是在比實作。

全部是純函式：輸入一批 CaseOutcome，輸出指標。跑 pipeline 與寫資料庫由 runner
負責，此處不碰 IO——指標公式必須能用手算的小數字驗證。
"""

import math
from collections.abc import Sequence

from eval.outcomes import CaseOutcome, EvalMetrics


def safe_ratio(numerator: float, denominator: float) -> float | None:
    """分母為 0 時回 None 而非 0：「無從評估」與「表現為 0」是不同的事實。"""
    return None if denominator == 0 else numerator / denominator


def average(values: Sequence[float]) -> float | None:
    """平均值；空序列回 None。"""
    return None if not values else sum(values) / len(values)


def percentile(values: Sequence[float], fraction: float) -> float | None:
    """取高分位值（最近秩次法）。

    少數異常慢的呼叫會被平均稀釋，P95 才看得到尾端延遲。
    用與 TS 端相同的 ceil 秩次法，讓兩邊在同一批資料上得到同一個值。
    """
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(len(ordered) * fraction) - 1))
    return ordered[index]


def field_f1(outcomes: Sequence[CaseOutcome]) -> float | None:
    """欄位層級 F1：只看「該抽到值」的欄位，抽錯值同時計入 FP 與 FN。"""
    true_positives = 0
    false_positives = 0
    false_negatives = 0

    for outcome in outcomes:
        for field in outcome.fields:
            should_have_value = field.expected is not None
            gave_value = field.actual is not None

            if should_have_value and field.correct:
                true_positives += 1
                continue
            # 抽出了值但不正確（含「該為 None 卻杜撰」）→ 誤報
            if gave_value:
                false_positives += 1
            # 該有值卻沒抽對（含漏抽與抽錯）→ 漏報
            if should_have_value:
                false_negatives += 1

    precision = safe_ratio(true_positives, true_positives + false_positives)
    recall = safe_ratio(true_positives, true_positives + false_negatives)
    if precision is None or recall is None:
        return None
    if precision + recall == 0:
        return 0.0
    return (2 * precision * recall) / (precision + recall)


def clarification_counts(outcomes: Sequence[CaseOutcome]) -> tuple[int, int, int]:
    """反問判定的 (命中數, 預測缺漏數, 標註缺漏數)。

    回計數而非直接回比例，是為了讓統計層算得出信賴區間——只有比例的話，
    97% 究竟建立在 30 個樣本還是 300 個樣本上就看不出來了。
    """
    true_positives = 0
    predicted = 0
    actual = 0

    for outcome in outcomes:
        expected_set = set(outcome.expected_missing)
        true_positives += sum(1 for field in outcome.predicted_missing if field in expected_set)
        predicted += len(outcome.predicted_missing)
        actual += len(outcome.expected_missing)

    return true_positives, predicted, actual


def hallucination_counts(outcomes: Sequence[CaseOutcome]) -> tuple[int, int]:
    """幻覺的 (杜撰欄位數, 標註為 None 的欄位數)。

    **A6 的硬門檻**：杜撰數非 0 就不得開啟 flag。
    """
    should_be_null = 0
    fabricated = 0

    for outcome in outcomes:
        for field in outcome.fields:
            if field.expected is not None:
                continue
            should_be_null += 1
            if field.actual is not None:
                fabricated += 1

    return fabricated, should_be_null


def quote_deviations(outcomes: Sequence[CaseOutcome]) -> list[float]:
    """報價偏差：以「標註欄位算出的金額」為基準，量抽取錯誤造成的金額偏差。

    不用人工標註報價區間——計價是 deterministic 查表，人工標等於抄 rate card
    算一遍，變成用實作驗證實作。以標註欄位跑同一套計價，量到的才是「抽取錯誤
    值多少錢」。
    """
    deviations: list[float] = []
    for outcome in outcomes:
        expected = outcome.expected_amount
        actual = outcome.actual_amount
        if expected is None or actual is None or expected == 0:
            continue
        deviations.append(abs(actual - expected) / expected)
    return deviations


def proportion_counts(outcomes: Sequence[CaseOutcome]) -> dict[str, tuple[int, int]]:
    """各比例型指標的 (分子, 分母)，供統計層計算信賴區間。

    只列真正是「n 次試驗中成功 k 次」的指標。F1 是兩個比例的調和平均、
    延遲與成本是連續量，都不適用二項模型——硬套一個區間比不給更糟。
    """
    all_fields = [field for outcome in outcomes for field in outcome.fields]
    correct_fields = sum(1 for field in all_fields if field.correct)
    true_positives, predicted, actual = clarification_counts(outcomes)
    fabricated, should_be_null = hallucination_counts(outcomes)

    priceable = [outcome for outcome in outcomes if outcome.expected_amount is not None]
    priced = sum(1 for outcome in priceable if outcome.actual_amount is not None)

    return {
        "field_extraction_accuracy": (correct_fields, len(all_fields)),
        "clarification_precision": (true_positives, predicted),
        "clarification_recall": (true_positives, actual),
        "hallucination_rate": (fabricated, should_be_null),
        "end_to_end_success_rate": (priced, len(priceable)),
    }


def compute_metrics(outcomes: Sequence[CaseOutcome]) -> EvalMetrics:
    """聚合一批案例結果為 PRD §8.2 的評估指標。"""
    counts = proportion_counts(outcomes)
    deviations = quote_deviations(outcomes)
    latencies = [float(outcome.latency_ms) for outcome in outcomes]

    def ratio(name: str) -> float | None:
        numerator, denominator = counts[name]
        return safe_ratio(numerator, denominator)

    return EvalMetrics(
        field_extraction_accuracy=ratio("field_extraction_accuracy"),
        field_extraction_f1=field_f1(outcomes),
        clarification_precision=ratio("clarification_precision"),
        clarification_recall=ratio("clarification_recall"),
        hallucination_rate=ratio("hallucination_rate"),
        quote_deviation_avg=average(deviations),
        quote_deviation_max=max(deviations) if deviations else None,
        # 端到端成功率的分母只算「標註認為應該可以計價」的案例。零資訊描述
        # （「你好」）標註的 subtype 本就是 None，轉人工是正確行為而非失敗——
        # 列入分母會系統性低估表現，並讓 CI 閘門建立在偏低的基準上。
        end_to_end_success_rate=ratio("end_to_end_success_rate"),
        latency_avg_ms=average(latencies),
        latency_p95_ms=percentile(latencies, 0.95),
        cost_per_case_usd=average([outcome.cost_usd for outcome in outcomes]),
    )

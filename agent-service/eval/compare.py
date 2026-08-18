"""Baseline 與 agent 的配對對照（A6 的 go/no-go 依據）。

    uv run python -m eval.compare baseline.json agent.json

## 為什麼是配對檢定

兩側跑的是**同一批** golden case，不是兩組獨立抽樣。用卡方獨立性檢定會高估
顯著性，因為它假設兩組互不相關；實際上「這則案例本身很難」是兩側共有的變異，
配對檢定把它消掉，只看兩側**表現不同**的那些案例。

36 則的樣本下這件事特別重要：不一致的案例常常只有個位數，而那幾則就是全部的
證據。McNemar 精確檢定直接告訴你「這樣的差距，純靠運氣有多容易發生」。

## 為什麼要三個判準

單看「有沒有出價」會把「把該轉人工的案例硬出價」記成成功——那正是最糟的失效
模式（客戶拿到一個錯的數字，比拿不到數字傷害大得多）。三個判準各自對應一件
真的在意的事：報價對不對、欄位抽對沒有、該問的問了沒。

## 門檻為什麼是硬的

`hallucination_rate` 與 `fallback_rate` 必須是 0，這不是「越低越好」的指標而是
**通過條件**。理由在設計文件：幻覺會讓客戶收到一個沒有根據的數字，fallback
則代表 agent 這條路根本沒走完——兩者任一非 0，統計上贏多少都不該開 flag。

量不到（None，分母為 0）**視同不通過**。那是「不知道」，不是「合格」。
"""

import argparse
import sys
from collections.abc import Callable
from pathlib import Path

from pydantic import BaseModel

from eval.analysis import (
    DEFAULT_ALPHA,
    McNemarResult,
    ProportionEstimate,
    mcnemar_exact,
    observed_power_note,
    wilson_interval,
)
from eval.artifact import EvalArtifact, load_artifact
from eval.outcomes import CaseOutcome

# 金額比對的容差。計價全在 TypeScript 端以同一組費率算出，兩側理應逐分相同；
# 這個值只用來吸收浮點表示誤差，不是「差一點點也算對」的寬容。
AMOUNT_TOLERANCE = 0.01

# 硬門檻：非 0 即不得開 flag（見模組 docstring）。
GATE_THRESHOLDS: dict[str, float] = {
    "hallucination_rate": 0.0,
    "fallback_rate": 0.0,
}


def _quote_correct(outcome: CaseOutcome) -> bool:
    """報價結果與標註一致。

    標註本身即無法計價時，**轉人工才是正確行為**——此時出了價反而是錯的。
    把這兩種情況都塞進「有沒有出價」會讓最危險的失效模式長得像成功。
    """
    if outcome.expected_amount is None:
        return outcome.actual_amount is None
    if outcome.actual_amount is None:
        return False
    return abs(outcome.actual_amount - outcome.expected_amount) <= AMOUNT_TOLERANCE


def _fields_all_correct(outcome: CaseOutcome) -> bool:
    """所有欄位都抽對（含正確判為 null）。"""
    return all(field.correct for field in outcome.fields)


def _clarification_exact(outcome: CaseOutcome) -> bool:
    """判定的缺漏欄位與標註完全相同。

    用集合比對：問題的先後順序不代表品質，順序不同不該被記為錯誤。
    """
    return set(outcome.predicted_missing) == set(outcome.expected_missing)


# 判準名稱 → 判定函式。名稱會直接出現在報告上，改名等於改報告的欄位。
CASE_PREDICATES: dict[str, Callable[[CaseOutcome], bool]] = {
    "quote_correct": _quote_correct,
    "fields_all_correct": _fields_all_correct,
    "clarification_exact": _clarification_exact,
}


class PairedComparison(BaseModel):
    """單一判準下的兩側對照。"""

    name: str
    baseline: ProportionEstimate
    candidate: ProportionEstimate
    mcnemar: McNemarResult

    @property
    def baseline_only_correct(self) -> int:
        return self.mcnemar.baseline_only_correct

    @property
    def candidate_only_correct(self) -> int:
        return self.mcnemar.candidate_only_correct


class GateCheck(BaseModel):
    """一項硬門檻的檢查結果。"""

    name: str
    value: float | None
    threshold: float
    passed: bool


class ComparisonReport(BaseModel):
    """一次對照的完整結論。"""

    case_count: int
    dataset_version: str
    baseline_model: str
    candidate_model: str
    comparisons: list[PairedComparison]
    gates: list[GateCheck]

    @property
    def passed(self) -> bool:
        """門檻全數通過才算 GO。統計顯著性不參與此判定——見模組 docstring。"""
        return all(gate.passed for gate in self.gates)


def pair_outcomes(
    baseline: list[CaseOutcome],
    candidate: list[CaseOutcome],
) -> list[tuple[CaseOutcome, CaseOutcome]]:
    """依 case id 配對兩側結果，順序沿用 baseline。

    案例集不一致直接拋錯：McNemar 的前提就是同一批案例，少了幾則仍照算會產出
    一個看起來合理、實際上沒有意義的 p 值——而那種錯誤不會有任何跡象。
    """
    baseline_ids = [outcome.id for outcome in baseline]
    candidate_ids = [outcome.id for outcome in candidate]

    for label, ids in (("baseline", baseline_ids), ("candidate", candidate_ids)):
        if len(ids) != len(set(ids)):
            raise ValueError(f"{label} 有重複的 case id")

    if set(baseline_ids) != set(candidate_ids):
        only_baseline = sorted(set(baseline_ids) - set(candidate_ids))
        only_candidate = sorted(set(candidate_ids) - set(baseline_ids))
        raise ValueError(
            "兩側案例集不一致，無法配對比較。"
            f"只在 baseline：{only_baseline or '無'}；只在 candidate：{only_candidate or '無'}"
        )

    by_id = {outcome.id: outcome for outcome in candidate}
    return [(outcome, by_id[outcome.id]) for outcome in baseline]


def compare_predicate(
    name: str,
    pairs: list[tuple[CaseOutcome, CaseOutcome]],
    predicate: Callable[[CaseOutcome], bool],
) -> PairedComparison:
    """對單一判準做兩側的比例估計與配對檢定。"""
    trials = len(pairs)
    baseline_correct = 0
    candidate_correct = 0
    baseline_only = 0
    candidate_only = 0

    for baseline_outcome, candidate_outcome in pairs:
        baseline_ok = predicate(baseline_outcome)
        candidate_ok = predicate(candidate_outcome)
        baseline_correct += baseline_ok
        candidate_correct += candidate_ok
        if baseline_ok and not candidate_ok:
            baseline_only += 1
        elif candidate_ok and not baseline_ok:
            candidate_only += 1

    return PairedComparison(
        name=name,
        baseline=wilson_interval(baseline_correct, trials),
        candidate=wilson_interval(candidate_correct, trials),
        mcnemar=mcnemar_exact(baseline_only, candidate_only),
    )


def evaluate_gates(candidate: EvalArtifact) -> list[GateCheck]:
    """檢查 agent 側的硬門檻。量不到（None）視同不通過。"""
    trajectory = candidate.trajectory_metrics
    values: dict[str, float | None] = {
        "hallucination_rate": candidate.metrics.hallucination_rate,
        "fallback_rate": trajectory.fallback_rate if trajectory else None,
    }

    return [
        GateCheck(
            name=name,
            value=values[name],
            threshold=threshold,
            passed=values[name] is not None and values[name] <= threshold,  # type: ignore[operator]
        )
        for name, threshold in GATE_THRESHOLDS.items()
    ]


def compare_artifacts(baseline: EvalArtifact, candidate: EvalArtifact) -> ComparisonReport:
    """把兩份產物比成一張對照表。"""
    if baseline.variant != "baseline" or candidate.variant != "agent":
        raise ValueError(
            "variant 不符：第一份必須是 baseline、第二份必須是 agent。"
            f"實得 {baseline.variant} / {candidate.variant}"
        )
    if baseline.dataset_version != candidate.dataset_version:
        raise ValueError(
            "兩側 dataset_version 不同，標註可能已改動，比較沒有意義："
            f"{baseline.dataset_version} vs {candidate.dataset_version}"
        )

    pairs = pair_outcomes(baseline.outcomes, candidate.outcomes)

    return ComparisonReport(
        case_count=len(pairs),
        dataset_version=baseline.dataset_version,
        baseline_model=baseline.model_version,
        candidate_model=candidate.model_version,
        comparisons=[
            compare_predicate(name, pairs, predicate) for name, predicate in CASE_PREDICATES.items()
        ],
        gates=evaluate_gates(candidate),
    )


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


# 檢定力要問的是「退步 5pp 察覺得到嗎」而非「進步 5pp」：基準線多在九成以上，
# 往上根本沒有 5pp 的空間，問了會得到一個無意義（甚至超出 [0,1]）的答案。
POWER_EFFECT = -0.05


def _power_note(report: ComparisonReport) -> str:
    """檢定力說明。基準率為 0% 或 100% 時給不出來，據實說明而非略過。

    比例落在端點時常態近似的變異數為 0，樣本量公式會退化。這在小樣本上是常態
    （36 則裡全對就是 100%），所以它是必須處理的正常路徑，不是例外狀況。
    """
    quote = next((item for item in report.comparisons if item.name == "quote_correct"), None)
    rate = quote.baseline.point if quote else None
    if rate is None or not 0 < rate + POWER_EFFECT < 1 or not 0 < rate < 1:
        return (
            f"baseline 的 quote_correct 為 {_pct(rate)}，落在端點或無法計算，"
            "樣本量公式在此退化，不提供檢定力估計。"
        )
    return observed_power_note(report.case_count, rate, POWER_EFFECT)


def format_comparison(report: ComparisonReport, alpha: float = DEFAULT_ALPHA) -> str:
    """終端機用的對照報告。"""
    lines = [
        "",
        "════════ A6 基準線對照 ════════",
        f"案例數 {report.case_count}｜dataset {report.dataset_version}",
        f"baseline 模型 {report.baseline_model}",
        f"agent    模型 {report.candidate_model}",
        "",
        "──── 配對比較（點估計 [95% CI]）────",
    ]

    for item in report.comparisons:
        significant = "顯著" if item.mcnemar.is_significant(alpha) else "不顯著"
        lines += [
            f"\n{item.name}",
            f"  baseline  {item.baseline.format()}",
            f"  agent     {item.candidate.format()}",
            f"  配對差異  baseline 獨對 {item.baseline_only_correct} 則、"
            f"agent 獨對 {item.candidate_only_correct} 則"
            f"（不一致 {item.mcnemar.discordant} 則）",
            f"  McNemar   p = {item.mcnemar.p_value:.4f}（α={alpha} 下{significant}）",
        ]

    lines += ["", "──── 硬門檻（非 0 即不得開 flag）────"]
    for gate in report.gates:
        mark = "✓" if gate.passed else "✗"
        lines.append(f"  {mark} {gate.name:<20} {_pct(gate.value)}（門檻 {_pct(gate.threshold)}）")

    lines += ["", "──── 檢定力 ────", "  " + _power_note(report)]

    verdict = "GO — 門檻全數通過" if report.passed else "NO-GO — 有門檻未通過，維持 flag 關閉"
    lines += ["", f"════════ {verdict} ════════", ""]
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="比較 baseline 與 agent 的 eval 產物")
    parser.add_argument("baseline", type=Path, help="baseline（TypeScript 單步）的 JSON")
    parser.add_argument("candidate", type=Path, help="agent（Python loop）的 JSON")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        report = compare_artifacts(load_artifact(args.baseline), load_artifact(args.candidate))
    except ValueError as error:
        print(f"✗ {error}")
        return 1

    print(format_comparison(report))
    # 非 0 的離開碼讓這支可以直接當閘門用，不必人工判讀輸出。
    return 0 if report.passed else 1


if __name__ == "__main__":
    sys.exit(main())

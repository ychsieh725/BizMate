"""Eval 的統計層。

現行 eval 只有點估計。36 則樣本下，「81.4% → 97.1%」這類宣稱缺少統計基礎：
分母只有 36，兩三則的差異就能造出十幾個百分點，看起來像進步的其實可能是雜訊。

三件事：
- **Wilson 信賴區間**：小樣本比例的區間估計（優於常態近似，接近 0/1 時不會
  跑出 [-0.02, 0.15] 這種不可能的區間）
- **McNemar 精確檢定**：同一批案例、改動前後的配對比較。正是本場景的正確檢定
  ——兩組不是獨立樣本，用卡方獨立性檢定會高估顯著性
- **樣本量檢定力分析**：回答「要偵測 5pp 的差異，36 則夠嗎」

── 為何不用 scipy ──
設計文件原本規劃 pandas + scipy，並因此在風險表列了一條「bundle 誤含 eval 相依」。
但這三件事標準庫都做得到：`statistics.NormalDist` 提供常態分佈的 cdf 與 inv_cdf，
McNemar 精確檢定就是 p=0.5 的二項檢定，`math.comb` 可以精確算。
少兩個重量級相依，那條風險也就不存在了——不是省事，是把問題消掉。
"""

import math
from statistics import NormalDist

from pydantic import BaseModel

# 預設 95% 信賴水準與 80% 檢定力，對齊一般慣例。
DEFAULT_CONFIDENCE = 0.95
DEFAULT_ALPHA = 0.05
DEFAULT_POWER = 0.80

_STANDARD_NORMAL = NormalDist()


class ProportionEstimate(BaseModel):
    """一個比例的點估計與區間估計。"""

    successes: int
    trials: int
    point: float | None
    lower: float | None
    upper: float | None

    def format(self, digits: int = 1) -> str:
        """報告用的一行表述，如 `97.1% [93.2%, 99.0%]`。"""
        if self.point is None or self.lower is None or self.upper is None:
            return "n/a"
        scale = 100
        return (
            f"{self.point * scale:.{digits}f}% "
            f"[{self.lower * scale:.{digits}f}%, {self.upper * scale:.{digits}f}%]"
        )


class McNemarResult(BaseModel):
    """McNemar 配對檢定的結果。

    discordant 是唯一帶資訊的部分：兩側都對或都錯的案例對「有沒有差異」
    不提供任何證據，這也是為什麼 36 則的實際檢定力常比直覺低得多。
    """

    baseline_only_correct: int
    candidate_only_correct: int
    p_value: float

    @property
    def discordant(self) -> int:
        return self.baseline_only_correct + self.candidate_only_correct

    def is_significant(self, alpha: float = DEFAULT_ALPHA) -> bool:
        return self.p_value < alpha


def wilson_interval(
    successes: int,
    trials: int,
    confidence: float = DEFAULT_CONFIDENCE,
) -> ProportionEstimate:
    """Wilson score 區間。

    比常態近似（p̂ ± z·√(p̂(1-p̂)/n)）好在兩點：小樣本的涵蓋率更接近名目水準，
    且 p̂ 為 0 或 1 時仍給得出有意義的區間——本專案的幻覺率就是 0%，
    常態近似在那裡會退化成 [0, 0]，看起來像「確定不會有幻覺」，那是錯的。
    """
    if trials <= 0:
        return ProportionEstimate(
            successes=successes, trials=trials, point=None, lower=None, upper=None
        )
    if not 0 <= successes <= trials:
        raise ValueError(f"successes 必須落在 0..trials，收到 {successes}/{trials}")

    z = _STANDARD_NORMAL.inv_cdf(1 - (1 - confidence) / 2)
    point = successes / trials
    z_squared = z * z

    denominator = 1 + z_squared / trials
    center = (point + z_squared / (2 * trials)) / denominator
    margin = (
        z
        / denominator
        * math.sqrt(point * (1 - point) / trials + z_squared / (4 * trials * trials))
    )

    return ProportionEstimate(
        successes=successes,
        trials=trials,
        point=point,
        lower=max(0.0, center - margin),
        upper=min(1.0, center + margin),
    )


def mcnemar_exact(baseline_only_correct: int, candidate_only_correct: int) -> McNemarResult:
    """McNemar 精確檢定（雙尾二項檢定，p = 0.5）。

    用精確版而非卡方近似：不一致的案例數（b + c）在 36 則的資料集上常常只有
    個位數，卡方近似在那個量級不可靠，連續性校正也只是補丁。math.comb 精確算，
    成本可以忽略。

    虛無假設是「兩種做法犯錯的傾向相同」，即 b 與 c 來自 p=0.5 的二項分佈。
    """
    if baseline_only_correct < 0 or candidate_only_correct < 0:
        raise ValueError("配對計數不可為負")

    discordant = baseline_only_correct + candidate_only_correct
    if discordant == 0:
        # 兩側表現完全一致，沒有任何證據指向差異
        return McNemarResult(
            baseline_only_correct=baseline_only_correct,
            candidate_only_correct=candidate_only_correct,
            p_value=1.0,
        )

    smaller = min(baseline_only_correct, candidate_only_correct)
    tail = sum(math.comb(discordant, i) for i in range(smaller + 1)) / (2**discordant)

    return McNemarResult(
        baseline_only_correct=baseline_only_correct,
        candidate_only_correct=candidate_only_correct,
        p_value=min(1.0, 2 * tail),
    )


def required_sample_size(
    baseline_rate: float,
    minimum_detectable_effect: float,
    alpha: float = DEFAULT_ALPHA,
    power: float = DEFAULT_POWER,
) -> int:
    """偵測指定幅度的差異所需的**每組**樣本數（兩比例，雙尾常態近似）。

    effect 可正可負：本專案的基準線多在 97% 上下，能問的通常是「掉 5pp 察覺得到
    嗎」而不是「漲 5pp」——後者根本沒有空間。

    存在的理由是誠實：36 則能不能撐起「顯著改善」的宣稱，應該先算再宣稱，
    而不是量完之後才發現檢定力不足。回傳值通常大得令人意外——這正是重點。
    """
    if not 0 < baseline_rate < 1:
        raise ValueError("baseline_rate 必須落在 (0, 1)")
    if minimum_detectable_effect == 0:
        raise ValueError("minimum_detectable_effect 不可為 0")

    candidate_rate = baseline_rate + minimum_detectable_effect
    if not 0 < candidate_rate < 1:
        raise ValueError("baseline_rate + effect 必須落在 (0, 1)")

    z_alpha = _STANDARD_NORMAL.inv_cdf(1 - alpha / 2)
    z_beta = _STANDARD_NORMAL.inv_cdf(power)

    pooled = (baseline_rate + candidate_rate) / 2
    numerator = (
        z_alpha * math.sqrt(2 * pooled * (1 - pooled))
        + z_beta
        * math.sqrt(baseline_rate * (1 - baseline_rate) + candidate_rate * (1 - candidate_rate))
    ) ** 2

    return math.ceil(numerator / (minimum_detectable_effect**2))


def observed_power_note(trials: int, baseline_rate: float, effect: float) -> str:
    """一句話說明本次樣本量夠不夠偵測指定幅度的變化。

    報告裡直接寫出來，是為了讓「36 則沒有顯著差異」不被讀成「兩者一樣好」——
    那是統計上最常見的誤讀，而它在求職場合會被追問。
    """
    needed = required_sample_size(baseline_rate, effect)
    verdict = "足夠" if trials >= needed else "不足"
    return (
        f"以 {baseline_rate:.1%} 為基準、要偵測 {effect:+.1%} 的變化"
        f"（α={DEFAULT_ALPHA}, power={DEFAULT_POWER:.0%}），每組需 {needed} 則；"
        f"本次 {trials} 則，檢定力{verdict}。"
    )

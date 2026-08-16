"""Agent loop 的預算與耗盡判定。

三種預算各自防一種失控：
- **步數**：防模型在 tool 之間繞圈
- **延遲**：防客戶在 wizard 前面等太久
- **成本**：防單一 session 燒掉不成比例的額度

三者都是**防災上限，不是目標值**。scripts/verify_agent 對真實模型實測的結果是
一次 loop 3 步、2–3 秒、成本 $0.0012–0.0013（2026-08-16）；預算設得比那寬鬆
一個數量級以上，是為了讓「撞到預算」明確代表異常，而非日常。真正的效能約束
來自 eval 的基準線（見設計文件〈基準線重建〉）。
"""

import json
from typing import Literal

from pydantic import BaseModel

# 一次 loop 最多幾步。實測 3 步，餘裕留給「反問一輪後補記欄位再計價」的較長路徑。
MAX_AGENT_STEPS = 8

# 累積延遲上限。分層預算：TS 端逾時 90s > 本值 60s > 單次 Gemini 呼叫約 1 秒。
MAX_AGENT_LATENCY_MS = 60_000

# 累積成本上限。約為實測值（$0.0013）的 8 倍、現行單步流程（$0.000442）的 22 倍
# ——刻意寬鬆，它是防災上限而非預期值。
MAX_AGENT_COST_USD = 0.01

# 連續幾次相同呼叫視為卡住。2 代表「做了完全一樣的事兩次」。
STUCK_REPEAT_THRESHOLD = 2

ExhaustionReason = Literal[
    "steps_exhausted",
    "latency_exhausted",
    "cost_exhausted",
    "stuck_in_loop",
]


class Budget(BaseModel):
    """一次 loop 的預算上限。可注入以便測試與日後調校。"""

    max_steps: int = MAX_AGENT_STEPS
    max_latency_ms: int = MAX_AGENT_LATENCY_MS
    max_cost_usd: float = MAX_AGENT_COST_USD
    stuck_repeat_threshold: int = STUCK_REPEAT_THRESHOLD


def call_fingerprint(tool_name: str, args: dict[str, object]) -> str:
    """把一次 tool 呼叫壓成可比較的指紋。

    參數以 sort_keys 序列化——同樣的參數換個鍵順序仍算同一次呼叫，
    否則模型只要調換欄位順序就能繞過迴圈偵測。

    對外公開（而非留成私有）是因為 eval 的 redundant_call_rate 必須用**完全
    相同**的「同一次呼叫」定義。各寫一份的話，loop 判為卡住的呼叫在指標上
    可能不算重複，兩個數字會互相矛盾而無從解釋。
    """
    return f"{tool_name}:{json.dumps(args, sort_keys=True, ensure_ascii=False)}"


class BudgetTracker:
    """追蹤一次 loop 的資源用量與重複呼叫。"""

    def __init__(self, budget: Budget | None = None) -> None:
        self._budget = budget or Budget()
        self.steps = 0
        self.latency_ms = 0
        self.cost_usd = 0.0
        self._last_fingerprint: str | None = None
        self._repeat_count = 0

    def record_step(
        self, tool_name: str, args: dict[str, object], latency_ms: int, cost_usd: float
    ) -> None:
        """記錄一步的用量。"""
        self.steps += 1
        self.latency_ms += latency_ms
        self.cost_usd += cost_usd

        fingerprint = call_fingerprint(tool_name, args)
        if fingerprint == self._last_fingerprint:
            self._repeat_count += 1
        else:
            self._repeat_count = 1
            self._last_fingerprint = fingerprint

    def exhausted(self) -> ExhaustionReason | None:
        """檢查是否該停下；未耗盡回 None。

        順序有意義：先報「卡住」再報「用完」——卡住是可診斷的行為問題，
        用完只是結果。若一個 loop 因為原地打轉而耗光步數，我們想在軌跡上
        看到 stuck_in_loop 而不是 steps_exhausted。
        """
        if self._repeat_count >= self._budget.stuck_repeat_threshold:
            return "stuck_in_loop"
        if self.steps >= self._budget.max_steps:
            return "steps_exhausted"
        if self.latency_ms >= self._budget.max_latency_ms:
            return "latency_exhausted"
        if self.cost_usd >= self._budget.max_cost_usd:
            return "cost_exhausted"
        return None

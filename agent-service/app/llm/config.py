"""Gemini 模型分層與定價。

由 TypeScript 端 src/lib/gemini/config.ts 移植，數值必須與該檔一致——
兩端會在同一份 eval 上比較，模型或定價不同就沒有可比性。

⚠️ 連動點：MODEL_TIERS 換用新模型時，務必在 MODEL_PRICING 補上該模型的單價，
   否則 compute_cost_usd 找不到定價會以 0 計算成本（見 cost.py）。
"""

from typing import Literal

from pydantic import BaseModel

# light     — 抽取 / 反問（Flash-Lite：免費層 RPD 500，對 eval 批次至關重要）
# reasoning — 需要較強推理的任務
ModelTier = Literal["light", "reasoning"]

MODEL_TIERS: dict[ModelTier, str] = {
    "light": "gemini-3.1-flash-lite",
    "reasoning": "gemini-2.5-flash",
}


class ModelPricing(BaseModel):
    """單一模型的 token 單價（USD / 每百萬 tokens）。"""

    input_per_million: float
    output_per_million: float


# 來源：ai.google.dev/gemini-api/docs/pricing。與 TS 端 config.ts 同步。
MODEL_PRICING: dict[str, ModelPricing] = {
    "gemini-3.1-flash-lite": ModelPricing(input_per_million=0.25, output_per_million=1.5),
    "gemini-2.5-flash": ModelPricing(input_per_million=0.3, output_per_million=2.5),
}

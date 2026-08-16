"""Eval 的資料形狀。

分兩層：Outcome 是「跑一則案例得到什麼」（含 IO 的產物），Metrics 是「一批
Outcome 聚合出什麼」（純計算）。這樣指標邏輯可以完全用假資料單元測試，
不需要碰 Gemini 或資料庫——移植自 TypeScript 的 `evalTypes.ts` 同一個分層。

CaseOutcome 的欄位刻意與 TS 端逐一對應（camelCase → snake_case）：A6 要把兩個
runner 的輸出並排比較，形狀不同就得先寫一層轉換，而轉換層是會出錯的地方。
"""

from typing import Literal

from pydantic import BaseModel

from eval.comparison import FieldComparison


class ToolCallRecord(BaseModel):
    """軌跡上的一次 tool 呼叫。"""

    tool_name: str
    args: dict[str, object] = {}


class TrajectoryOutcome(BaseModel):
    """agent 專屬的軌跡結果。

    單步 baseline 沒有軌跡可言，故獨立成型別而非塞進 CaseOutcome——
    強迫 None 的欄位會讓「這個指標對 baseline 不適用」這件事變得隱晦。
    """

    calls: list[ToolCallRecord]
    expected_sequence: list[str]
    steps_taken: int
    outcome: Literal["completed", "fallback"]
    fallback_reason: str | None = None


class CaseOutcome(BaseModel):
    """單則 golden case 跑完 pipeline 的結果。"""

    id: str
    fields: list[FieldComparison]
    # 程式端依 confidence 門檻判定的缺漏欄位（不變式 I-2：不由 LLM 宣稱）
    predicted_missing: list[str]
    # 標註的缺漏欄位（人工標註的正確答案）
    expected_missing: list[str]
    # 用「標註欄位」計價得到的金額——即抽取完全正確時應有的報價。
    # 標註本身即查無費率時為 None，該則不列入偏差計算。
    expected_amount: float | None
    # 用「模型抽取欄位」計價得到的金額；out_of_scope 時為 None
    actual_amount: float | None
    out_of_scope: bool
    latency_ms: int
    cost_usd: float
    model_version: str | None = None
    # 走 agent 時的軌跡；單步 baseline 為 None
    trajectory: TrajectoryOutcome | None = None


class EvalMetrics(BaseModel):
    """既有 11 項指標（PRD §8.2）。

    值為 None 代表該指標在本次執行中無法計算（分母為 0），刻意不用 0 代替——
    「沒有可評估的案例」與「表現為 0」是完全不同的意思，混用會誤導判讀。
    """

    field_extraction_accuracy: float | None
    field_extraction_f1: float | None
    clarification_precision: float | None
    clarification_recall: float | None
    hallucination_rate: float | None
    quote_deviation_avg: float | None
    quote_deviation_max: float | None
    end_to_end_success_rate: float | None
    latency_avg_ms: float | None
    latency_p95_ms: float | None
    cost_per_case_usd: float | None


class TrajectoryMetrics(BaseModel):
    """agent 專屬的 4 項指標（設計文件〈Trajectory Eval〉）。"""

    tool_sequence_match_rate: float | None
    avg_steps_per_case: float | None
    redundant_call_rate: float | None
    fallback_rate: float | None


class EvalRunResult(BaseModel):
    """一次完整執行的產物。

    放在這裡而非 runner，是為了讓 report 能引用它而不必反過來 import runner
    （那會形成循環）。這個型別是兩者之間的契約，不屬於任何一邊。
    """

    dataset_version: str
    model_version: str
    outcomes: list[CaseOutcome]
    metrics: EvalMetrics
    trajectory_metrics: TrajectoryMetrics

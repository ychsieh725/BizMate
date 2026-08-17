"""Eval 執行結果的落檔格式（A6）。

## 為什麼需要這個檔案

A6 要回答的是「agent 比單步 baseline 好嗎」，而正確的檢定方式是 **McNemar
配對檢定**——因為兩側跑的是同一批案例，不是兩組獨立樣本。配對檢定需要逐案例
的對應關係（「這則 baseline 對了但 agent 錯了」），而兩個 runner 目前都只把
結果印到終端機。彙總指標存進了 `eval_runs`，但那是 metric_name → value 的
列，逐案例資訊在聚合時就丟掉了。

所以先有這個檔案格式，才有 p 值可談。

## 為什麼獨立於 EvalRunResult

`EvalRunResult` 是**記憶體內的型別**，跟著程式碼一起改；這裡是**落在磁碟上的
檔案格式**，會被上一版程式寫出、下一版程式讀進來。兩者的生命週期不同，綁在
一起會讓「改個型別」變成「讀不了舊的結果檔」。`schema_version` 就是為此存在。

## 兩個嚴格性決策

**拒絕多餘欄位**（`extra="forbid"`）。TypeScript 端寫出的 JSON 若因改名而多帶
一個 camelCase 欄位，寬鬆解析會靜默忽略它、然後用 pydantic 的預設值頂替真正
的欄位——對照表照樣印得出來，只是數字是錯的。**寧可炸在載入，不要錯在報告。**

**baseline 的 trajectory_metrics 是 None，不是 0。** 單步流程沒有「軌跡」這個
概念，填 0 會讓 fallback 率、平均步數這類欄位在對照表上看起來像「baseline 表現
完美而 agent 較差」，那是拿不存在的東西當基準。
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from eval.outcomes import CaseOutcome, EvalMetrics, EvalRunResult, TrajectoryMetrics

# 檔案格式版本。改動既有欄位的意義或型別時 +1，純新增選填欄位不需要動。
SCHEMA_VERSION = 1

# 兩側 runner 的識別。baseline = TypeScript 單步流程，agent = Python tool-calling loop。
Variant = Literal["baseline", "agent"]


class EvalArtifact(BaseModel):
    """一次 eval 執行的完整產物，可寫成 JSON 並跨 runner 比較。"""

    model_config = ConfigDict(extra="forbid")

    schema_version: int = SCHEMA_VERSION
    variant: Variant
    # ISO 8601（UTC）。用來確認對照的兩份是同一批次跑的，而非隔了幾週的舊資料。
    generated_at: str
    dataset_version: str
    model_version: str
    outcomes: list[CaseOutcome]
    metrics: EvalMetrics
    # 只有 agent 側有值；見模組 docstring。
    trajectory_metrics: TrajectoryMetrics | None = None


def artifact_from_run(result: EvalRunResult, variant: Variant) -> EvalArtifact:
    """把記憶體內的執行結果轉成可落檔的產物。"""
    return EvalArtifact(
        variant=variant,
        generated_at=datetime.now(UTC).isoformat(),
        dataset_version=result.dataset_version,
        model_version=result.model_version,
        outcomes=result.outcomes,
        metrics=result.metrics,
        trajectory_metrics=result.trajectory_metrics if variant == "agent" else None,
    )


def write_artifact(path: Path, artifact: EvalArtifact) -> None:
    """寫出 JSON。缺少的上層目錄一併建立。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        artifact.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )


def load_artifact(path: Path) -> EvalArtifact:
    """讀入 JSON。任何形狀不符都拋 ValidationError（見模組 docstring）。"""
    return EvalArtifact.model_validate(json.loads(path.read_text(encoding="utf-8")))

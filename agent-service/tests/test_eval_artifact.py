"""Eval 執行結果的落檔格式。

這個檔案格式是 A6 的地基：兩個 runner（TypeScript 的單步 baseline、Python 的
agent）各自寫出一份，`eval.compare` 讀進來配對比較。**兩邊寫出的 JSON 必須是
同一個形狀**——形狀不同就得加一層轉換，而轉換層正是會靜默出錯的地方：
欄位對錯位不會噴例外，只會讓對照表上的數字說謊。

故此處測的重點不是「能不能存檔」，而是：
- 缺欄位、型別錯、variant 打錯字 → **必須拋錯**，不可靜默容忍
- baseline 沒有軌跡指標 → 合法（單步流程沒有軌跡可言）
- agent 有軌跡指標 → 完整保留
- 寫出去再讀回來，內容逐欄位相同（round-trip）
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from eval.artifact import EvalArtifact, artifact_from_run, load_artifact, write_artifact
from eval.comparison import FieldComparison
from eval.outcomes import (
    CaseOutcome,
    EvalMetrics,
    EvalRunResult,
    ToolCallRecord,
    TrajectoryMetrics,
    TrajectoryOutcome,
)

METRICS = EvalMetrics(
    field_extraction_accuracy=0.9,
    field_extraction_f1=0.88,
    clarification_precision=1.0,
    clarification_recall=0.75,
    hallucination_rate=0.0,
    quote_deviation_avg=0.02,
    quote_deviation_max=0.11,
    end_to_end_success_rate=0.95,
    latency_avg_ms=2400.0,
    latency_p95_ms=4100.0,
    cost_per_case_usd=0.0012,
)

TRAJECTORY_METRICS = TrajectoryMetrics(
    tool_sequence_match_rate=0.83,
    avg_steps_per_case=3.1,
    redundant_call_rate=0.05,
    fallback_rate=0.0,
)


def outcome(case_id: str = "g-001", with_trajectory: bool = False) -> CaseOutcome:
    trajectory = (
        TrajectoryOutcome(
            calls=[ToolCallRecord(tool_name="lookup_rate_card", args={"category": "x"})],
            expected_sequence=["lookup_rate_card", "record_fields", "compute_quote"],
            steps_taken=3,
            outcome="completed",
        )
        if with_trajectory
        else None
    )
    return CaseOutcome(
        id=case_id,
        fields=[FieldComparison(name="subtype", expected="頭像", actual="頭像", correct=True)],
        predicted_missing=[],
        expected_missing=[],
        expected_amount=3000.0,
        actual_amount=3000.0,
        out_of_scope=False,
        latency_ms=2400,
        cost_usd=0.0012,
        model_version="gemini-flash-lite-latest",
        trajectory=trajectory,
    )


def run_result(with_trajectory: bool = False) -> EvalRunResult:
    return EvalRunResult(
        dataset_version="2026-08-15",
        model_version="gemini-flash-lite-latest",
        outcomes=[outcome(with_trajectory=with_trajectory)],
        metrics=METRICS,
        trajectory_metrics=TRAJECTORY_METRICS,
    )


class TestArtifactFromRun:
    def test_agent_variant_keeps_trajectory_metrics(self) -> None:
        artifact = artifact_from_run(run_result(with_trajectory=True), variant="agent")

        assert artifact.variant == "agent"
        assert artifact.trajectory_metrics == TRAJECTORY_METRICS
        assert artifact.outcomes[0].trajectory is not None

    def test_baseline_variant_drops_trajectory_metrics(self) -> None:
        """單步 baseline 沒有軌跡可言，強行填 0 會讓對照表看起來像「agent 贏了」。"""
        artifact = artifact_from_run(run_result(), variant="baseline")

        assert artifact.trajectory_metrics is None

    def test_generated_at_is_iso_utc(self) -> None:
        artifact = artifact_from_run(run_result(), variant="baseline")

        assert artifact.generated_at.endswith("+00:00")


class TestRoundTrip:
    def test_write_then_load_preserves_everything(self, tmp_path: Path) -> None:
        original = artifact_from_run(run_result(with_trajectory=True), variant="agent")
        path = tmp_path / "agent.json"

        write_artifact(path, original)

        assert load_artifact(path) == original

    def test_written_json_is_snake_case(self, tmp_path: Path) -> None:
        """TypeScript 端也要寫出這個形狀；camelCase 混進來會在載入時就被擋下。"""
        path = tmp_path / "agent.json"
        write_artifact(path, artifact_from_run(run_result(with_trajectory=True), variant="agent"))

        raw = json.loads(path.read_text(encoding="utf-8"))

        assert "trajectory_metrics" in raw
        assert "dataset_version" in raw
        assert raw["outcomes"][0]["predicted_missing"] == []
        assert raw["outcomes"][0]["trajectory"]["steps_taken"] == 3

    def test_write_creates_parent_directories(self, tmp_path: Path) -> None:
        path = tmp_path / "nested" / "deeper" / "agent.json"

        write_artifact(path, artifact_from_run(run_result(), variant="baseline"))

        assert path.exists()


class TestValidation:
    def test_unknown_variant_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            EvalArtifact(
                variant="candidate",  # type: ignore[arg-type]
                generated_at="2026-08-17T00:00:00+00:00",
                dataset_version="2026-08-15",
                model_version="m",
                outcomes=[],
                metrics=METRICS,
            )

    def test_missing_field_is_rejected_on_load(self, tmp_path: Path) -> None:
        path = tmp_path / "broken.json"
        path.write_text(json.dumps({"variant": "agent"}), encoding="utf-8")

        with pytest.raises(ValidationError):
            load_artifact(path)

    def test_camel_case_payload_is_rejected(self, tmp_path: Path) -> None:
        """TS 端若忘了轉 snake_case，要在載入時立刻炸，而不是產出半空的報告。"""
        payload = json.loads(artifact_from_run(run_result(), variant="baseline").model_dump_json())
        payload["datasetVersion"] = payload.pop("dataset_version")
        path = tmp_path / "camel.json"
        path.write_text(json.dumps(payload), encoding="utf-8")

        with pytest.raises(ValidationError):
            load_artifact(path)

    def test_extra_field_is_rejected(self, tmp_path: Path) -> None:
        """多出來的欄位通常代表 schema 漂移，靜默忽略會讓漂移累積到無法察覺。"""
        payload = json.loads(artifact_from_run(run_result(), variant="baseline").model_dump_json())
        payload["surprise"] = 1
        path = tmp_path / "extra.json"
        path.write_text(json.dumps(payload), encoding="utf-8")

        with pytest.raises(ValidationError):
            load_artifact(path)

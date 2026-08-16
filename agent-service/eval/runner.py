"""Eval Runner：對真實 agent 跑整份 golden set。

    uv run python -m eval.runner              跑全部 36 則
    uv run python -m eval.runner --limit 3    先跑 3 則驗證腳本本身
    uv run python -m eval.runner --delay 0    付費層可關掉節流

需要 pnpm dev（或已部署的 WEB_SERVICE_URL）——compute_quote 與兩側計價都經
TypeScript 的內部計價 API（不變式 I-1）。

── 與 TypeScript runner 的關係 ──
`pnpm eval` 跑的是單步 baseline，這支跑的是 agent。兩者吃同一份標註、用同一套
比對規則、輸出同形狀的 CaseOutcome，A6 才能把兩邊並排比較。

── 測試資料 ──
每則會建一筆 session（agent_steps 與 cost_logs 的外鍵需要），以
EVAL_CONTACT_EMAIL 標記，事後用 `pnpm eval:clean --confirm` 清除。
刻意不自行刪除：那支腳本已經有「連帶刪到真實報價就中止」的保護，
在這裡另寫一套刪除邏輯只會多一個能誤刪 production 資料的地方。
"""

import argparse
import asyncio
import sys
import time

from app.agent.fields import CaseCategory, FieldExtraction, find_missing_fields
from app.agent.loop import LoopResult, run_agent_loop
from app.agent.prompts import build_initial_prompt
from app.agent.tools.base import ToolContext
from app.db.client import Row, as_rows, get_client
from app.db.repositories.agent_steps import TABLE_NAME as AGENT_STEPS_TABLE
from app.db.repositories.cost_logs import TABLE_NAME as COST_LOGS_TABLE
from app.db.repositories.extracted_fields import extracted_fields_repository
from app.pricing_client import PricingUnavailableError, compute_pricing
from eval.comparison import compare_fields, to_pricing_fields
from eval.dataset import GoldenCase, expected_tool_sequence, load_golden_set
from eval.metrics import compute_metrics
from eval.outcomes import CaseOutcome, EvalRunResult, ToolCallRecord, TrajectoryOutcome
from eval.report import format_report
from eval.trajectory import compute_trajectory_metrics

# 與 TypeScript 的 src/domains/eval/evalConstants.ts 同值——兩個 runner 產生的
# 測試 session 要能被同一支清理腳本認出來。
EVAL_CONTACT_EMAIL = "eval@bizmate.local"

# Gemini 免費層對 flash-lite 是 15 requests/min。**agent 一則要 3 次呼叫**，
# 故節流間隔比 TS runner 的 4500ms 長得多——沿用那個值會在第 5 則就撞 429。
DEFAULT_DELAY_MS = 14_000


async def find_eval_merchant(category: CaseCategory = "graphic_design") -> str | None:
    """找一個有在售費率的商家當 eval 的租戶脈絡。

    沒有 active 費率的商家會讓每則都走 out_of_scope，量到的全是 0。
    """
    client = await get_client()
    result = (
        await client.table("rate_card_base")
        .select("merchant_id")
        .eq("category", category)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    rows = as_rows(result.data)
    return str(rows[0]["merchant_id"]) if rows else None


async def create_eval_session(merchant_id: str, category: CaseCategory) -> str:
    client = await get_client()
    result = (
        await client.table("sessions")
        .insert(
            {
                "merchant_id": merchant_id,
                "category": category,
                "contact_email": EVAL_CONTACT_EMAIL,
                "status": "parsing",
            }
        )
        .execute()
    )
    return str(as_rows(result.data)[0]["id"])


def calls_from_rows(rows: list[Row]) -> list[ToolCallRecord]:
    """把 agent_steps 的列轉成 tool 呼叫序列。

    **排除 status=fallback 的那筆**：它是 loop 記下的「為什麼沒走完」標記
    （tool_name 存的是 llm_error 這類原因），不是一次 tool 呼叫。留著會讓
    原因字串混進 tool 序列，導致所有 fallback 案例的序列比對永遠不相符——
    那會把「agent 交棒」這一個問題誤報成「agent 走錯路」兩個問題。

    tool_args 為 NULL 時給空 dict：指紋計算需要一個 dict，而「沒有參數」與
    「參數是空的」對重複偵測而言是同一件事。
    """
    return [
        ToolCallRecord(
            tool_name=str(row["tool_name"]),
            args=row["tool_args"] if isinstance(row["tool_args"], dict) else {},
        )
        for row in rows
        if row["status"] != "fallback"
    ]


async def load_trajectory(
    run_id: str, expected: tuple[str, ...], result: LoopResult
) -> TrajectoryOutcome:
    """把 agent_steps 的軌跡讀回成可計算指標的形狀。"""
    client = await get_client()
    rows = as_rows(
        (
            await client.table(AGENT_STEPS_TABLE)
            .select("tool_name, tool_args, status")
            .eq("run_id", run_id)
            .order("step_index")
            .execute()
        ).data
    )

    return TrajectoryOutcome(
        calls=calls_from_rows(rows),
        expected_sequence=list(expected),
        steps_taken=result.steps_taken,
        outcome=result.outcome,
        fallback_reason=result.fallback_reason,
    )


async def find_model_version(session_id: str) -> str | None:
    client = await get_client()
    rows = as_rows(
        (
            await client.table(COST_LOGS_TABLE)
            .select("model")
            .eq("session_id", session_id)
            .limit(1)
            .execute()
        ).data
    )
    return str(rows[0]["model"]) if rows else None


async def price_or_none(
    merchant_id: str, category: CaseCategory, fields: dict[str, FieldExtraction]
) -> float | None:
    """計價；查無費率或計價服務不可用時回 None。

    服務不可用與 out_of_scope 都回 None 是刻意的：兩者對指標的意義相同
    （這則算不出金額），而把服務故障拋成例外會讓整份 eval 因為一則而中斷。
    真正的服務故障會在報告上表現為大量 None，看得出來。
    """
    try:
        result = await compute_pricing(merchant_id, category, fields)
    except PricingUnavailableError:
        return None
    return None if result.out_of_scope else result.total


async def run_eval_case(case: GoldenCase, merchant_id: str) -> CaseOutcome:
    """跑單一 golden case：真實 agent loop → 逐欄比對 → 兩側計價 → 取軌跡。"""
    session_id = await create_eval_session(merchant_id, case.category)

    context = ToolContext(
        session_id=session_id,
        merchant_id=merchant_id,
        category=case.category,
    )
    result = await run_agent_loop(context, build_initial_prompt(case.category, case.raw_text))

    # agent 寫進 extracted_fields 的內容即它的抽取結果；缺漏判定同樣由程式端
    # 依門檻算（不變式 I-2），不採信 agent 的說法。
    stored = await extracted_fields_repository.find_by_session(session_id)

    expected_amount = await price_or_none(
        merchant_id, case.category, to_pricing_fields(case.expected.fields)
    )
    actual_amount = await price_or_none(merchant_id, case.category, stored)

    return CaseOutcome(
        id=case.id,
        fields=compare_fields(case.expected.fields, stored),
        predicted_missing=find_missing_fields(case.category, stored),
        expected_missing=case.expected.missing_required_fields,
        expected_amount=expected_amount,
        actual_amount=actual_amount,
        out_of_scope=actual_amount is None,
        latency_ms=result.total_latency_ms,
        cost_usd=result.total_cost_usd,
        model_version=await find_model_version(session_id),
        trajectory=await load_trajectory(str(result.run_id), expected_tool_sequence(case), result),
    )


async def run_eval(
    merchant_id: str,
    limit: int | None = None,
    delay_ms: int = DEFAULT_DELAY_MS,
) -> EvalRunResult:
    """跑整份（或前 N 則）golden set 並聚合指標。"""
    golden_set = load_golden_set()
    cases = golden_set.cases if limit is None else golden_set.cases[:limit]

    outcomes: list[CaseOutcome] = []
    models: set[str] = set()

    for index, case in enumerate(cases):
        if index > 0 and delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000)

        outcome = await run_eval_case(case, merchant_id)
        outcomes.append(outcome)
        if outcome.model_version is not None:
            models.add(outcome.model_version)

        trajectory = outcome.trajectory
        path = " → ".join(call.tool_name for call in trajectory.calls) if trajectory else "—"
        print(f"[{index + 1:>2}/{len(cases)}] {case.id:<16} {path}")

    trajectories = [o.trajectory for o in outcomes if o.trajectory is not None]

    return EvalRunResult(
        dataset_version=golden_set.dataset_version,
        model_version=",".join(sorted(models)) or "unknown",
        outcomes=outcomes,
        metrics=compute_metrics(outcomes),
        trajectory_metrics=compute_trajectory_metrics(trajectories),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="對真實 agent 跑 golden set")
    parser.add_argument("--limit", type=int, default=None, help="只跑前 N 則")
    parser.add_argument(
        "--delay",
        type=int,
        default=DEFAULT_DELAY_MS,
        help=f"每則間隔毫秒（預設 {DEFAULT_DELAY_MS}，避開免費層 15 RPM）",
    )
    return parser.parse_args()


async def main() -> int:
    args = parse_args()

    merchant_id = await find_eval_merchant()
    if merchant_id is None:
        print("✗ 找不到有 active 費率的商家。請先執行 pnpm seed:rate-card。")
        return 1

    started_at = time.perf_counter()
    result = await run_eval(merchant_id, limit=args.limit, delay_ms=args.delay)
    elapsed = time.perf_counter() - started_at

    print(format_report(result))
    print(f"\n總耗時 {elapsed / 60:.1f} 分鐘")
    print(f"測試資料以 {EVAL_CONTACT_EMAIL} 標記，清理：pnpm eval:clean --confirm")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

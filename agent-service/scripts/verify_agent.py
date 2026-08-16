"""真實依賴驗證：完整 agent loop（A4 驗收）。

前面幾支腳本各驗了一段：verify_trace 驗軌跡寫得進資料庫，verify_llm 驗真實
模型會回 function_call。但**四個 tool 串成一條 loop 會不會動，到這裡為止
沒有任何證據**——單元測試全用假 LLM，模型的實際選擇從未進過測試。

這支腳本補上最後一段：真實 Gemini + 真實 Supabase + 真實計價 API，跑兩個
互補情境（欄位不齊 → ask_customer；欄位齊全 → compute_quote），確認四個
tool 都被走過、軌跡完整、成本可歸因。

順帶量出 budget.py 那三個常數的實際落點——它們目前是設計文件的估計值，
不是實測值（見設計文件〈待確認事項〉）。

沿用專案既有的 verify:* 慣例——需要真實金鑰，故不進 CI，由人手動執行。

用法：
    # 1. 另開一個終端啟動 Next.js（compute_quote 會呼叫它的內部計價 API）
    pnpm dev

    # 2.
    cd agent-service
    WEB_SERVICE_URL=http://localhost:3000 uv run python -m scripts.verify_agent

需要 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、GEMINI_API_KEY、
INTERNAL_SERVICE_SECRET（**與 Next.js 端同值**）、WEB_SERVICE_URL。
"""

import asyncio
import sys
from dataclasses import dataclass

import httpx

from app.agent.budget import (
    MAX_AGENT_COST_USD,
    MAX_AGENT_LATENCY_MS,
    MAX_AGENT_STEPS,
)
from app.agent.fields import CaseCategory
from app.agent.loop import LoopResult, run_agent_loop
from app.agent.prompts import build_initial_prompt
from app.agent.registry import build_registry
from app.agent.tools.base import SessionEvent, ToolContext
from app.config import settings
from app.db.client import Row, as_rows, get_client
from app.db.repositories.agent_steps import TABLE_NAME as AGENT_STEPS_TABLE
from app.db.repositories.cost_logs import TABLE_NAME as COST_LOGS_TABLE
from app.db.repositories.rate_card import rate_card_repository
from app.pricing_client import COMPUTE_PATH, PRICING_TIMEOUT_SECONDS

CATEGORY: CaseCategory = "graphic_design"

# 沿用 eval 的做法：測試 session 以保留信箱標記，事後認得出來也刪得掉
# （見 src/domains/eval/evalConstants.ts 的說明）。
VERIFY_CONTACT_EMAIL = "verify-agent@bizmate.local"


@dataclass(frozen=True)
class Scenario:
    """一個待驗證的情境。

    兩個情境刻意互補：單獨任一個都只走得到兩個終止類 tool 的其中一個，
    合起來才涵蓋四個 tool。
    """

    label: str
    raw_text: str
    expected_event: SessionEvent
    expected_terminal_tool: str


def build_scenarios(subtype: str) -> list[Scenario]:
    """依商家實際在售的服務項目組出情境。

    subtype 取自真實 rate card 而非寫死字串：寫死的項目不在該商家表內時，
    record_fields 會依值域檢查退回，量到的會是「資料沒對上」而不是
    「agent 不會做事」——那種雜訊最難debug。
    """
    return [
        Scenario(
            label="欄位不齊 → 應向客戶提問",
            raw_text=f"我想做{subtype}，麻煩幫我估個價。",
            expected_event="parse_incomplete",
            expected_terminal_tool="ask_customer",
        ),
        Scenario(
            label="欄位齊全 → 應直接產生報價",
            raw_text=f"我要做{subtype}，總共 3 款，需要商業授權，兩週內交件，需要提案比稿。",
            expected_event="parse_complete",
            expected_terminal_tool="compute_quote",
        ),
    ]


def report(passed: bool, message: str, detail: str = "") -> bool:
    """印一行檢查結果並原樣回傳，讓呼叫端可以直接收集成清單。"""
    mark = "✓" if passed else "✗"
    suffix = f"：{detail}" if detail and not passed else ""
    print(f"  {mark} {message}{suffix}")
    return passed


async def verify_pricing_api_reachable() -> bool:
    """先確認 TypeScript 的內部計價 API 通得到、且共用密鑰一致。

    刻意送一個必定不合規的主體：回 400 代表「連得上且通過認證」。
    回 401 則代表兩邊的 INTERNAL_SERVICE_SECRET 不同——這是最常見的設定錯誤，
    留到 compute_quote 才炸會被誤讀成「模型不肯呼叫 tool」，浪費一輪除錯。
    """
    url = f"{settings.web_service_url}{COMPUTE_PATH}"
    try:
        async with httpx.AsyncClient(timeout=PRICING_TIMEOUT_SECONDS) as client:
            response = await client.post(
                url,
                json={},
                headers={"x-internal-secret": settings.internal_service_secret},
            )
    except httpx.HTTPError as error:
        print(f"✗ 連不上計價 API（{url}）：{error}")
        print("  請在另一個終端執行 pnpm dev，並確認 WEB_SERVICE_URL 指向它。")
        return False

    if response.status_code == 401:
        print("✗ 計價 API 回 401：兩個服務的 INTERNAL_SERVICE_SECRET 不一致")
        return False
    if response.status_code != 400:
        print(f"✗ 計價 API 回應非預期狀態 {response.status_code}（預期 400）")
        return False

    print(f"✓ 計價 API 可達且認證通過（{url}）")
    return True


async def find_merchant_with_rate_card() -> str | None:
    """找一個該案件類型有在售項目的商家。

    沒有 active 費率的商家會讓每次 loop 都走 out_of_scope，驗不到正常路徑。
    """
    client = await get_client()
    result = (
        await client.table("rate_card_base")
        .select("merchant_id")
        .eq("category", CATEGORY)
        .eq("is_active", True)
        .limit(1)
        .execute()
    )
    rows = as_rows(result.data)
    return str(rows[0]["merchant_id"]) if rows else None


async def create_session(merchant_id: str) -> str:
    """建一筆測試 session。

    agent_steps、extracted_fields、clarification_turns 都以 session_id 為外鍵，
    每個情境用自己的 session，彼此的欄位才不會互相污染。
    """
    client = await get_client()
    result = (
        await client.table("sessions")
        .insert(
            {
                "merchant_id": merchant_id,
                "category": CATEGORY,
                "contact_email": VERIFY_CONTACT_EMAIL,
                "status": "parsing",
            }
        )
        .execute()
    )
    return str(as_rows(result.data)[0]["id"])


async def cleanup(session_ids: list[str]) -> None:
    """移除本次驗證產生的資料。

    先刪 cost_logs 再刪 session：cost_logs.session_id 是 ON DELETE SET NULL，
    反過來做會留下一批查不回源頭的孤兒紀錄。其餘子表（agent_steps、
    extracted_fields、clarification_turns）都是 CASCADE，隨 session 一起走。
    """
    client = await get_client()
    for session_id in session_ids:
        await client.table(COST_LOGS_TABLE).delete().eq("session_id", session_id).execute()
        await client.table("sessions").delete().eq("id", session_id).execute()


async def load_trajectory(run_id: str) -> list[Row]:
    client = await get_client()
    result = (
        await client.table(AGENT_STEPS_TABLE)
        .select("*")
        .eq("run_id", run_id)
        .order("step_index")
        .execute()
    )
    return as_rows(result.data)


async def cost_log_exists(cost_log_id: str) -> bool:
    client = await get_client()
    result = await client.table(COST_LOGS_TABLE).select("id").eq("id", cost_log_id).execute()
    return len(as_rows(result.data)) == 1


async def verify_trajectory(result: LoopResult, scenario: Scenario) -> bool:
    """檢查軌跡本身，而非只看結局。

    「結果對但路徑荒謬」正是 agent 化引入的新失效模式（見 migration 0009 的
    動機說明）。只驗 event 對不對，等於放掉了這張表存在的理由。
    """
    rows = await load_trajectory(str(result.run_id))
    tool_names = [str(row["tool_name"]) for row in rows]
    print(f"  軌跡：{' → '.join(tool_names) or '（空）'}")

    checks = [
        report(len(rows) > 0, "agent_steps 有寫入軌跡"),
        report(
            [int(row["step_index"]) for row in rows] == list(range(len(rows))),
            "step_index 從 0 起連續",
            str([row["step_index"] for row in rows]),
        ),
        report(
            len(rows) == result.steps_taken,
            "軌跡筆數與 steps_taken 一致",
            f"{len(rows)} vs {result.steps_taken}",
        ),
        report(
            tool_names[-1:] == [scenario.expected_terminal_tool],
            f"最後一步是 {scenario.expected_terminal_tool}",
            tool_names[-1] if tool_names else "（空軌跡）",
        ),
    ]

    linked = [str(row["cost_log_id"]) for row in rows if row["cost_log_id"] is not None]
    checks.append(report(len(linked) > 0, "至少一步能歸因到 cost_logs"))
    if linked:
        checks.append(
            report(await cost_log_exists(linked[0]), "cost_log_id 確實指向存在的成本紀錄")
        )

    return all(checks)


async def run_scenario(scenario: Scenario, merchant_id: str, session_id: str) -> LoopResult | None:
    """跑一個情境；未通過檢查回 None。"""
    print(f"\n--- {scenario.label} ---")
    print(f"  描述：{scenario.raw_text}")

    context = ToolContext(
        session_id=session_id,
        merchant_id=merchant_id,
        category=CATEGORY,
    )
    result = await run_agent_loop(context, build_initial_prompt(CATEGORY, scenario.raw_text))

    print(
        f"  結局：{result.outcome}｜事件：{result.event}｜步數：{result.steps_taken}"
        f"｜延遲：{result.total_latency_ms}ms｜成本：${result.total_cost_usd:.6f}"
    )

    if result.outcome != "completed":
        report(False, "loop 正常結束", f"fallback（{result.fallback_reason}）")
        await verify_trajectory(result, scenario)
        return None

    report(True, "loop 正常結束")
    ok_event = report(
        result.event == scenario.expected_event,
        f"事件為 {scenario.expected_event}",
        str(result.event),
    )
    if result.tool_result is not None:
        print(f"  終止類 tool 回傳：{result.tool_result}")

    ok_trace = await verify_trajectory(result, scenario)
    return result if ok_event and ok_trace else None


async def collect_tool_names(run_ids: list[str]) -> set[str]:
    names: set[str] = set()
    for run_id in run_ids:
        names.update(str(row["tool_name"]) for row in await load_trajectory(run_id))
    return names


def report_budget(results: list[LoopResult]) -> None:
    """把實測值與 budget.py 的上限並列。

    那三個常數目前是設計文件的估計值。這裡印出實測落點，供決定是否收緊——
    上限與實測差太多，「撞到預算」就不再是有意義的異常訊號。
    """
    print("\n--- 預算實測（vs budget.py 上限）---")
    print(f"  步數　：{max(r.steps_taken for r in results)} / {MAX_AGENT_STEPS}")
    print(f"  延遲　：{max(r.total_latency_ms for r in results)}ms / {MAX_AGENT_LATENCY_MS}ms")
    print(f"  成本　：${max(r.total_cost_usd for r in results):.6f} / ${MAX_AGENT_COST_USD}")


async def main() -> int:
    print("=== 完整 agent loop 驗證 ===\n")

    if not await verify_pricing_api_reachable():
        return 1

    merchant_id = await find_merchant_with_rate_card()
    if merchant_id is None:
        print(f"✗ 找不到 {CATEGORY} 有 active 費率的商家。")
        print("  請先執行 pnpm seed:rate-card 建立 dev 商家的價目表。")
        return 1
    print(f"✓ 測試商家：{merchant_id}")

    subtypes = await rate_card_repository.find_active_subtypes(merchant_id, CATEGORY)
    print(f"✓ 在售服務項目：{'、'.join(subtypes)}")

    scenarios = build_scenarios(subtypes[0])
    session_ids: list[str] = []
    completed: list[LoopResult] = []
    covered = False

    try:
        for scenario in scenarios:
            session_id = await create_session(merchant_id)
            session_ids.append(session_id)
            result = await run_scenario(scenario, merchant_id, session_id)
            if result is not None:
                completed.append(result)

        print("\n--- tool 覆蓋 ---")
        expected_tools = set(build_registry())
        seen = await collect_tool_names([str(r.run_id) for r in completed])
        covered = report(
            expected_tools <= seen,
            "四個 tool 都被走過",
            f"未走到：{'、'.join(sorted(expected_tools - seen)) or '無'}",
        )
    finally:
        await cleanup(session_ids)
        print("\n✓ 已清理測試資料")

    if len(completed) != len(scenarios) or not covered:
        print("\n=== 有項目未通過 ===")
        return 1

    report_budget(completed)
    print("\n=== 全部通過 ===")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

"""真實依賴驗證：agent_steps 寫入鏈路（A1 驗收）。

單元測試用假 repository 驗證記錄器的邏輯，碰不到資料庫。這支腳本補上另一半：
migration 0009 是否已套用、service_role 是否有權限、欄位型別是否對得上。

沿用專案既有的 verify:* 慣例（見根目錄 scripts/verify-*.ts）——需要真實金鑰，
故不進 CI，由人手動執行。

用法：
    cd agent-service
    uv run python -m scripts.verify_trace

需要 .env.local 或環境變數提供 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、
INTERNAL_SERVICE_SECRET。
"""

import asyncio
import sys

from app.db.client import as_rows, get_client
from app.db.repositories.agent_steps import TABLE_NAME, agent_steps_repository
from app.trace.agent_steps import AgentStepRecorder


async def find_any_session_id() -> str | None:
    """取一筆既有 session 當外鍵標的。

    agent_steps.session_id 有 FK 約束，不能用捏造的 UUID——那樣測到的是
    「外鍵擋下寫入」，不是「寫入鏈路正常」。
    """
    client = await get_client()
    result = await client.table("sessions").select("id").limit(1).execute()
    rows = as_rows(result.data)
    return str(rows[0]["id"]) if rows else None


async def cleanup(run_id: str) -> None:
    """移除本次驗證寫入的紀錄，不留測試資料在 production。"""
    client = await get_client()
    await client.table(TABLE_NAME).delete().eq("run_id", run_id).execute()


async def main() -> int:
    print("=== agent_steps 寫入鏈路驗證 ===\n")

    session_id = await find_any_session_id()
    if session_id is None:
        print("✗ 資料庫沒有任何 session，無法驗證外鍵寫入。")
        print("  請先跑一次報價流程產生 session，或執行 seed 腳本。")
        return 1
    print(f"✓ 取得測試用 session：{session_id}")

    recorder = AgentStepRecorder(session_id=session_id, repository=agent_steps_repository)
    run_id = str(recorder.run_id)

    try:
        await recorder.record(
            tool_name="lookup_rate_card",
            status="ok",
            tool_result={"subtypes": ["品牌識別設計"]},
            latency_ms=12,
        )
        await recorder.record(
            tool_name="record_fields",
            status="rejected",
            tool_args={"fields": {"subtype": "公司LOGO"}},
            error_detail="subtype 不在值域內",
            latency_ms=418,
        )
        print(f"✓ 寫入 2 筆軌跡（run_id={run_id}）")

        client = await get_client()
        result = (
            await client.table(TABLE_NAME)
            .select("*")
            .eq("run_id", run_id)
            .order("step_index")
            .execute()
        )
        rows = as_rows(result.data)

        if len(rows) != 2:
            print(f"✗ 預期讀回 2 筆，實際 {len(rows)} 筆")
            return 1
        print("✓ 讀回 2 筆，數量正確")

        if [row["step_index"] for row in rows] != [0, 1]:
            print(f"✗ step_index 不正確：{[row['step_index'] for row in rows]}")
            return 1
        print("✓ step_index 依序為 0, 1")

        if rows[1]["status"] != "rejected":
            print(f"✗ status enum 寫入不正確：{rows[1]['status']}")
            return 1
        print("✓ status enum 寫入正確")

        if rows[1]["tool_args"] != {"fields": {"subtype": "公司LOGO"}}:
            print(f"✗ JSONB 欄位不正確：{rows[1]['tool_args']}")
            return 1
        print("✓ JSONB 欄位往返正確")

        if rows[0]["cost_log_id"] is not None:
            print("✗ 未提供 cost_log_id 時應為 NULL")
            return 1
        print("✓ cost_log_id 可為 NULL")

        # UNIQUE (run_id, step_index)：重複寫入應被擋下且不拋到呼叫端。
        # 記錄器會 logger.exception 記下這次失敗，故底下會印出一段 traceback——
        # 那是預期輸出，正是 best-effort 生效的證據，不是驗證失敗。
        print("\n  ↓ 以下 traceback 為預期輸出（故意觸發重複寫入）")
        duplicate = AgentStepRecorder(
            session_id=session_id,
            repository=agent_steps_repository,
            run_id=recorder.run_id,
        )
        await duplicate.record(tool_name="lookup_rate_card", status="ok")

        result = await client.table(TABLE_NAME).select("id").eq("run_id", run_id).execute()
        if len(as_rows(result.data)) != 2:
            print("✗ UNIQUE 約束未生效，出現重複 step")
            return 1
        print("✓ UNIQUE (run_id, step_index) 生效，重複寫入被靜默吞掉")

    finally:
        await cleanup(run_id)
        print("✓ 已清理測試資料")

    print("\n=== 全部通過 ===")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

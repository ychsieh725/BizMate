/**
 * 驗證 Cost Logger（任務 2.6 驗收）。
 * 執行：pnpm verify:cost
 *
 * 建立測試 session → 用 generateStructuredAndLog 實際呼叫 Gemini 並記錄成本 →
 * 查 cost_logs 確認寫入、token 與 cost_usd 正確 → 清理所有測試資料。
 */
import { z } from "zod";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { costLogsRepository } from "@/domains/finops/repositories/costLogsRepository.ts";
import {
  computeCostUsd,
  generateStructuredAndLog,
} from "@/domains/finops/costLogger.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`驗證失敗：${message}`);
  }
}

async function main(): Promise<void> {
  const session = await sessionsRepository.create({ category: "illustration" });
  const logIds: string[] = [];

  try {
    const result = await generateStructuredAndLog({
      tier: "light",
      prompt: "客戶說：幫我畫一個角色，商用。",
      schema: z.object({ subtype: z.string(), license_scope: z.string() }),
      sessionId: session.id,
      agentName: "verify-cost",
    });
    console.log(`✅ 呼叫成功（model=${result.model}, total tokens=${result.usage.totalTokens}）`);

    const logs = await costLogsRepository.findBySession(session.id);
    logs.forEach((log) => logIds.push(log.id));

    assert(logs.length === 1, "應寫入剛好一筆 cost_logs");
    const log = logs[0];
    assert(log.model === result.model, "cost_logs.model 應與呼叫模型一致");
    assert(
      log.input_tokens === result.usage.inputTokens &&
        log.output_tokens === result.usage.outputTokens,
      "cost_logs token 數應與 usageMetadata 一致",
    );
    assert(log.latency_ms !== null && log.latency_ms > 0, "應記錄 latency_ms");

    const expectedCost = computeCostUsd(result.model, result.usage);
    assert(Number(log.cost_usd) > 0, "cost_usd 應大於 0");
    assert(
      Math.abs(Number(log.cost_usd) - expectedCost) < 1e-6,
      `cost_usd 應約等於 ${expectedCost}，實際 ${log.cost_usd}`,
    );

    console.log(`✅ cost_logs 寫入正確`);
    console.log(
      `   tokens: in=${log.input_tokens} out=${log.output_tokens} | cost_usd=${log.cost_usd} | latency=${log.latency_ms}ms`,
    );
    console.log("\n🎉 Cost Logger 驗收通過（成本計算 + 寫入 + 查詢）。");
  } finally {
    // 清理：cost_logs 的 FK 是 ON DELETE SET NULL，刪 session 不會連帶刪除，需各別刪
    for (const id of logIds) {
      await costLogsRepository.delete(id).catch(() => {});
    }
    await sessionsRepository.delete(session.id).catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});

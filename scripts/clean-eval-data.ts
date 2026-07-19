/**
 * 清理 Eval Runner 產生的測試 session（WBS 7.2 附帶治理）。
 *
 * 執行：
 *   pnpm eval:clean                     只檢視，不刪（預設 dry-run）
 *   pnpm eval:clean --confirm           刪除已標記的 eval session
 *   pnpm eval:clean --legacy            檢視標記機制上線前的孤兒 session
 *   pnpm eval:clean --legacy --confirm  一併清除上述孤兒
 *
 * ── 為何預設不刪 ──
 * sessions 的子表全是 ON DELETE CASCADE，quotes 也在其中——條件寫錯會連真實
 * 報價單一起消失且無法復原。故一律先印出影響範圍，要求明確 --confirm。
 * 只要偵測到會連帶刪除報價，即中止並要求人工介入。
 *
 * cost_logs 是 ON DELETE SET NULL，成本紀錄一律保留：成本確實發生過，
 * FinOps 的用量統計不該因清理測試資料而失真。
 */
import { evalSessionsRepository } from "@/domains/eval/repositories/evalSessionsRepository.ts";
import { EVAL_CONTACT_EMAIL } from "@/domains/eval/evalConstants.ts";
import type { CleanupTarget } from "@/domains/eval/repositories/evalSessionsRepository.ts";

const confirm = process.argv.includes("--confirm");
const includeLegacy = process.argv.includes("--legacy");

/** 報價數大於 0 代表清理條件涵蓋了真實資料，必須中止。 */
function assertSafe(label: string, target: CleanupTarget): void {
  if (target.attachedQuotes === 0) return;
  throw new Error(
    `${label} 的 ${target.sessionIds.length} 筆 session 底下有 ${target.attachedQuotes} 筆報價，` +
      "CASCADE 會一併刪除。已中止——請先確認這些是否為測試資料。",
  );
}

async function processTarget(label: string, target: CleanupTarget): Promise<number> {
  console.log(`\n── ${label} ──`);
  console.log(`符合條件的 session：${target.sessionIds.length} 筆`);
  console.log(`連帶影響的報價　　：${target.attachedQuotes} 筆`);

  assertSafe(label, target);

  if (target.sessionIds.length === 0) return 0;
  if (!confirm) {
    console.log("（dry-run，未刪除。加 --confirm 才會實際執行）");
    return 0;
  }

  const deleted = await evalSessionsRepository.deleteByIds(target.sessionIds);
  console.log(`✅ 已刪除 ${deleted} 筆 session（子表 CASCADE 連帶清除）`);
  return deleted;
}

async function main(): Promise<void> {
  console.log(
    `Eval 測試資料清理｜模式：${confirm ? "實際刪除" : "dry-run（僅檢視）"}`,
  );
  console.log(`標記依據：contact_email = ${EVAL_CONTACT_EMAIL}`);

  let total = 0;
  total += await processTarget(
    "已標記的 eval session",
    await evalSessionsRepository.findMarked(),
  );

  if (includeLegacy) {
    total += await processTarget(
      "標記機制上線前的孤兒 session（無信箱、無報價）",
      await evalSessionsRepository.findLegacyOrphans(),
    );
  } else {
    console.log(
      "\n（標記機制上線前的舊資料未納入檢視，加 --legacy 一併處理）",
    );
  }

  console.log(
    confirm
      ? `\n🎉 清理完成，共刪除 ${total} 筆 session。cost_logs 已保留（session_id 設為 null）。`
      : "\n🎉 檢視完成，未變更任何資料。",
  );
}

main().catch((error: unknown) => {
  console.error("清理腳本執行失敗：", error);
  process.exit(1);
});

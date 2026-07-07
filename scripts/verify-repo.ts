/**
 * 端到端驗證 Repository 層（任務 2.4 驗收）。
 * 執行：pnpm verify:repo
 *
 * 對真實 Supabase 跑一輪完整 CRUD，證明 client + 泛型 repo + 具體 repo + 型別
 * 全鏈路可用。測試資料在結束時一定刪除（try/finally），不留髒資料。
 */
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { ensureDevMerchant } from "./dev-merchant.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`驗證失敗：${message}`);
  }
}

async function main(): Promise<void> {
  const merchantId = await ensureDevMerchant();
  let createdId: string | null = null;

  try {
    // 1. create
    const created = await sessionsRepository.create({ category: "illustration", merchant_id: merchantId });
    createdId = created.id;
    assert(created.category === "illustration", "create 後 category 應為 illustration");
    assert(created.status === "created", "新 session 預設狀態應為 created");
    console.log(`✅ create：${created.id}`);

    // 2. findById
    const found = await sessionsRepository.findById(created.id);
    assert(found !== null && found.id === created.id, "findById 應找到剛建立的 session");
    console.log("✅ findById");

    // 3. update
    const updated = await sessionsRepository.update(created.id, { status: "parsing" });
    assert(updated.status === "parsing", "update 後狀態應為 parsing");
    console.log("✅ update");

    // 4. findByStatus（具體 repo 的領域查詢）
    const parsing = await sessionsRepository.findByStatus("parsing");
    assert(
      parsing.some((session) => session.id === created.id),
      "findByStatus('parsing') 應包含剛更新的 session",
    );
    console.log("✅ findByStatus（領域查詢）");

    // 5. delete
    await sessionsRepository.delete(created.id);
    const afterDelete = await sessionsRepository.findById(created.id);
    assert(afterDelete === null, "delete 後應查不到");
    createdId = null;
    console.log("✅ delete");

    console.log("\n🎉 Repository 層驗收通過（CRUD 全鏈路）。");
  } finally {
    // 保險清理：任何步驟失敗都不留測試資料
    if (createdId) {
      await sessionsRepository.delete(createdId).catch(() => {
        console.error(`⚠️ 清理測試資料失敗，請手動刪除 session ${createdId}`);
      });
    }
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});

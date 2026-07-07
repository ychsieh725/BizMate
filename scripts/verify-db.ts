/**
 * 驗證 Supabase 連線與 schema 是否就緒（任務 2.2 驗收）。
 * 執行：pnpm db:verify （會以 --env-file=.env.local 載入金鑰）
 *
 * 用 service_role 對每張預期資料表做 head count；能存取即代表：
 * (1) 金鑰正確、(2) migration 已套用、(3) service_role 授權正常。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";

const EXPECTED_TABLES = [
  "merchants",
  "sessions",
  "raw_inputs",
  "extracted_fields",
  "clarification_turns",
  "rate_card_base",
  "rate_card_modifiers",
  "rate_card_template_base",
  "rate_card_template_modifiers",
  "price_line_items",
  "quotes",
  "eval_runs",
  "cost_logs",
  "rate_limits",
] as const;

async function main(): Promise<void> {
  const supabase = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  let failures = 0;

  for (const table of EXPECTED_TABLES) {
    const { error } = await supabase
      .from(table)
      .select("*", { head: true, count: "exact" });

    if (error) {
      console.error(`❌ ${table.padEnd(20)} ${error.message}`);
      failures += 1;
    } else {
      console.log(`✅ ${table}`);
    }
  }

  console.log(
    `\n結果：${EXPECTED_TABLES.length - failures}/${EXPECTED_TABLES.length} 張表可存取`,
  );

  if (failures > 0) {
    console.error(
      "\n有表無法存取。請確認 0001_init.sql 已在 SQL Editor 執行成功。",
    );
    process.exit(1);
  }

  console.log("🎉 Schema 驗收通過。");
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});

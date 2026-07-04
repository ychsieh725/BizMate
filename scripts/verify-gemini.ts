/**
 * 驗證 Gemini client 與結構化輸出（任務 2.5 驗收）。
 * 執行：pnpm verify:gemini
 *
 * 用一個模擬 Intake Parser 的小 schema 實際呼叫 Gemini，確認：
 * 金鑰有效、模型可用、responseJsonSchema 生效、zod 驗證通過、usageMetadata 回傳。
 */
import { z } from "zod";
import { generateStructured } from "@/lib/gemini/generate.ts";

const extractionSchema = z.object({
  subtype: z.string().describe("案件子類型，例如 角色設計"),
  license_scope: z.string().describe("授權範圍，例如 商業使用 / 個人使用"),
  deadline_days: z.number().describe("交期天數"),
});

async function main(): Promise<void> {
  const result = await generateStructured({
    tier: "light",
    systemInstruction:
      "你是報價系統的欄位抽取器，只依使用者描述填寫指定欄位，不臆測未提及的資訊。",
    prompt: "客戶說：幫我畫一個角色，要商用，急件三天內交件。",
    schema: extractionSchema,
  });

  console.log("✅ Gemini 呼叫成功");
  console.log("模型：", result.model);
  console.log("抽取結果：", JSON.stringify(result.data, null, 2));
  console.log(
    `Token 用量：input=${result.usage.inputTokens} output=${result.usage.outputTokens} total=${result.usage.totalTokens}`,
  );
  console.log(`延遲：${result.latencyMs}ms`);
  console.log("\n🎉 Gemini client 驗收通過（結構化輸出 + zod 驗證 + usageMetadata）。");
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});

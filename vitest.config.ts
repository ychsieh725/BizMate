import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest 設定（任務 3.1 引入，作為 7.1 測試基礎設施）。
 * - tsconfigPaths：讓測試沿用 tsconfig 的 `@/*` 別名與 .ts 副檔名 import。
 * - coverage：v8 provider，門檻對齊 testing.md 的 80%。
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // 門檻只套用在已納入測試的模組（白名單）。M0 既有模組的測試由 7.1
      // 貫穿任務陸續補上，屆時把對應路徑加入此清單，門檻即開始把關該模組。
      include: [
        "src/orchestrator/**/*.ts",
        "src/domains/intake/sessionService.ts",
        "src/domains/intake/sessionSchemas.ts",
        "src/domains/intake/parserAgent.ts",
        "src/domains/intake/parserFields.ts",
        "src/domains/intake/clarificationAgent.ts",
        "src/domains/intake/clarificationFields.ts",
        "src/lib/api/**/*.ts",
        "src/lib/rateLimit/**/*.ts",
        "src/lib/agentService.ts",
        "src/lib/api/internalAuth.ts",
        "src/domains/intake/parserFields.ts",
        "src/app/api/**/route.ts",
        "src/app/wizard/lib/wizardApi.ts",
        "src/domains/pricing/basePricing.ts",
        "src/domains/pricing/quoteFormatter.ts",
        // 8.5 CI 閘門：判定邏輯錯了不會有人發現——誤放行看起來就跟沒有回歸一樣
        "src/domains/eval/gate.ts",
        "src/domains/eval/baseline.ts",
        "src/domains/eval/runArtifact.ts",
        "src/shared/testData/**/*.ts",
      ],
      exclude: ["src/**/*.{test,spec}.ts", "src/**/*.types.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});

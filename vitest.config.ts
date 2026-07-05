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
      include: ["src/orchestrator/**/*.ts"],
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

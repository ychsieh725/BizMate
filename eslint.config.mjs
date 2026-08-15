import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 測試覆蓋率報告產出（v8 HTML 資產，非原始碼）
    "coverage/**",
    // 非應用程式碼：harness 設定、規格文件、工作流模板
    ".claude/**",
    "documents/**",
    "VibeCoding_Workflow_Templates/**",
    // Python 服務由 ruff 把關；其 .venv 內含第三方 JS 資產（如 coverage
    // 的 HTML 報告腳本），不該進 TypeScript 的 lint 範圍
    "agent-service/**",
  ]),
  {
    // 底線前綴代表「刻意不使用」——測試中的假函式常需符合真實簽名
    // 卻不用到每個參數，這種情況不應被當成疏漏。
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;

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
    // 非應用程式碼：harness 設定、規格文件、工作流模板
    ".claude/**",
    "documents/**",
    "VibeCoding_Workflow_Templates/**",
  ]),
]);

export default eslintConfig;

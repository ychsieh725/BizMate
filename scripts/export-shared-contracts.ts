/**
 * 把 TypeScript 端的事實來源匯出成 canonical JSON，供 Python 側消費（A5）。
 *
 * 匯出兩份：
 *   1. golden set（36 則標註案例）→ eval/golden_set/cases.json
 *   2. 欄位契約（必要欄位、值域、confidence 門檻）→ eval/contracts/field_contract.json
 *
 * ── 為何不把資料直接抄一份到 Python ──
 * A6 要在**同一份** golden set、**同一套**欄位規則上比較 agent 與單步 baseline。
 * 兩邊各存一份，遲早會有一邊被改到——那時量到的差異是設定差異，不是能力差異，
 * 整個對照作廢。
 *
 * 這不是假想風險：A3 移植 `app/agent/fields.py` 時，coloring_complexity 的值域
 * 被抄成「線稿/平塗/厚塗」（實際是「精緻上色/簡易上色/線稿」），會讓 12 則插畫
 * 案例的該欄位全數被 record_fields 拒收。人工同步兩份常數就是會出這種事。
 *
 * 產出檔已進版控：Python 側跑 eval 不該需要先裝 Node.js 工具鏈。漂移由
 * `pnpm export:contracts --check`（CI）與 Python 的契約測試兩側把關。
 *
 * 執行：
 *   pnpm export:contracts           重新產生
 *   pnpm export:contracts --check   只檢查是否與現有檔案一致（CI 用）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { GOLDEN_CASES } from "@/domains/eval/goldenSet.ts";
import { DATASET_VERSION } from "@/domains/eval/goldenSet.types.ts";
import {
  CATEGORY_SPECIFIC_FIELDS,
  COMMON_REQUIRED_FIELDS,
  CONFIDENCE_THRESHOLD,
} from "@/domains/intake/parserFields.ts";
import {
  BOOLEAN_DOMAIN,
  COLORING_COMPLEXITY_DOMAIN,
  LICENSE_SCOPE_DOMAIN,
} from "@/shared/constants/fieldDomains.ts";

const GOLDEN_SET_PATH = "agent-service/eval/golden_set/cases.json";
const FIELD_CONTRACT_PATH = "agent-service/eval/contracts/field_contract.json";

/** 中文不轉義、2 空格縮排、結尾換行：讓 diff 讀得懂，也讓 --check 穩定。 */
function toJson(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * 序列化 golden set 為 snake_case，與 Python 側的命名慣例一致。
 * notes 一併帶過去：指標退步時報告要印得出「這則在測什麼」，
 * 少了它只看得到 id，得回頭翻 TypeScript 原始檔。
 */
function serializeGoldenSet(): string {
  return toJson({
    dataset_version: DATASET_VERSION,
    cases: GOLDEN_CASES.map((goldenCase) => ({
      id: goldenCase.id,
      category: goldenCase.category,
      raw_text: goldenCase.rawText,
      expected: {
        fields: goldenCase.expected.fields,
        missing_required_fields: goldenCase.expected.missingRequiredFields,
      },
      notes: goldenCase.notes,
    })),
  });
}

/**
 * 欄位契約：Python 端 `app/agent/fields.py` 必須逐項相符。
 *
 * 只匯出「兩邊都要用」的部分。subtype 的值域不在此——它是 per-merchant 的
 * rate card，由執行期查得，不是靜態契約。
 */
function serializeFieldContract(): string {
  return toJson({
    confidence_threshold: CONFIDENCE_THRESHOLD,
    common_required_fields: COMMON_REQUIRED_FIELDS,
    category_specific_fields: CATEGORY_SPECIFIC_FIELDS,
    boolean_field_prefix: "includes_",
    boolean_domain: BOOLEAN_DOMAIN,
    static_field_domains: {
      license_scope: LICENSE_SCOPE_DOMAIN,
      coloring_complexity: COLORING_COMPLEXITY_DOMAIN,
    },
  });
}

function writeOrCheck(path: string, content: string, label: string): void {
  if (!process.argv.includes("--check")) {
    writeFileSync(path, content, "utf8");
    console.log(`✅ 已匯出 ${label} → ${path}`);
    return;
  }

  let existing: string;
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${path} 不存在，請先執行 pnpm export:contracts`);
  }

  if (existing !== content) {
    throw new Error(
      `${path} 與 TypeScript 端不一致。\n` +
        "請執行 pnpm export:contracts 重新匯出後一併提交。",
    );
  }
  console.log(`✅ ${label} 與 TypeScript 端一致`);
}

writeOrCheck(GOLDEN_SET_PATH, serializeGoldenSet(), `golden set（${GOLDEN_CASES.length} 則）`);
writeOrCheck(FIELD_CONTRACT_PATH, serializeFieldContract(), "欄位契約");

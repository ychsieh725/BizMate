/**
 * 對真實 Gemini 跑完整 Golden Set，量測 Parser 的基準線表現（任務 7.1 驗收）。
 * 執行：pnpm verify:golden-set          （全 36 則）
 *       pnpm verify:golden-set --limit=6 （只跑前 6 則，省 token）
 *
 * ── 這支腳本的定位（與 7.2 的界線）──
 * 7.1 的交付是「資料集就緒」，本腳本只負責證明兩件事：
 *   (1) 資料集能被真實 pipeline 消費（rawText 餵得進 Parser、欄位對得上）
 *   (2) 標註是合理的（人可逐案例覆核差異，抓出標註錯誤而非模型錯誤）
 * 正式的指標定義、eval_runs 寫入、CI 閘門屬 7.2/8.5；此處的彙總數字僅供
 * 人工參考，刻意不做斷言、不寫 DB——避免在指標契約定案前先固化實作。
 *
 * 正規化比對亦刻意保持在腳本內（不進 src/），留給 7.2 提煉為正式模組。
 *
 * 會為每則案例建立測試 session（cost_logs 的 FK 需要），驗收後可自行清除。
 */
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";
import { parseIntake } from "@/domains/intake/parserAgent.ts";
import { normalizeLicenseScope } from "@/domains/pricing/basePricing.ts";
import { GOLDEN_CASES } from "@/domains/eval/goldenSet.ts";
import { DATASET_VERSION } from "@/domains/eval/goldenSet.types.ts";
import type { GoldenCase } from "@/domains/eval/goldenSet.types.ts";
import { ensureDevMerchant } from "./dev-merchant.ts";

/** 布林欄位的同義詞 → 正規形式（是/否）。 */
const AFFIRMATIVE = ["是", "true", "有", "要", "需要", "yes", "y", "1"];
const NEGATIVE = ["否", "false", "沒有", "不要", "不需要", "no", "n", "none", "0"];

/** 走 basePricing.parseQuantity 同一套回退邏輯的數量欄位。 */
const QUANTITY_FIELDS = new Set(["quantity", "page_count"]);

/**
 * 把 LLM 輸出與標註值都壓到同一形式再比對。
 *
 * ── 為何要對齊下游邏輯而非字面比對 ──
 * 衡量的對象是「抽取結果餵給 pricing 後會不會算錯」，不是「字串長得像不像」。
 * basePricing 已對 license_scope 做包含式正規化、對數量做 parseInt + 回退 1，
 * 故此處沿用同一套邏輯——否則「商業用途」vs「商業使用」會被記為錯誤，
 * 但下游其實算得完全正確，指標就成了假警報。
 *
 * 刻意「不」正規化的兩個欄位，因為下游真的會出錯，必須讓它現形：
 *   - subtype：rateCardRepository.findBase 用精確相等查表，抽到「LOGO」而非
 *     「LOGO設計」就查無資料 → outOfScope，報價直接失敗。
 *   - feature_modules：「明說不需要（無）」與「完全沒提（null）」對反問行為的
 *     期待相反，混為一談會讓客戶被問已回答過的問題。
 */
function normalize(fieldName: string, raw: string | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  if (fieldName === "license_scope") return normalizeLicenseScope(trimmed);

  // 布林正規化只套用在 includes_* 欄位——若對全欄位套用，quantity 的 "1"
  // 會被當成肯定詞轉為「是」，把正確抽取記成錯誤。
  if (fieldName.startsWith("includes_")) {
    const lowered = trimmed.toLowerCase();
    if (AFFIRMATIVE.includes(lowered)) return "是";
    if (NEGATIVE.includes(lowered)) return "否";
    return trimmed;
  }

  if (QUANTITY_FIELDS.has(fieldName)) {
    const parsed = Number.parseInt(trimmed, 10);
    // 對齊 parseQuantity：非正整數一律回退 1（保守，不放大金額）
    return Number.isInteger(parsed) && parsed > 0 ? String(parsed) : "1";
  }

  if (fieldName === "deadline_days") {
    const digits = trimmed.match(/\d+/);
    return digits ? digits[0] : trimmed;
  }

  return trimmed;
}

interface CaseOutcome {
  readonly id: string;
  readonly correctFields: number;
  readonly totalFields: number;
  /** 標註為 null（原文沒提）但模型抽出了值——即幻覺。 */
  readonly hallucinated: string[];
  /** 逐欄差異，供人工覆核標註是否有誤。 */
  readonly diffs: string[];
  readonly missingDetection: {
    readonly truePositives: number;
    readonly predicted: number;
    readonly actual: number;
  };
}

async function runCase(
  goldenCase: GoldenCase,
  merchantId: string,
): Promise<CaseOutcome> {
  const session = await sessionsRepository.create({
    category: goldenCase.category,
    merchant_id: merchantId,
  });
  const result = await parseIntake({
    sessionId: session.id,
    category: goldenCase.category,
    rawText: goldenCase.rawText,
  });

  const diffs: string[] = [];
  const hallucinated: string[] = [];
  let correctFields = 0;

  for (const [name, expectedRaw] of Object.entries(goldenCase.expected.fields)) {
    const expected = normalize(name, expectedRaw);
    const actual = normalize(name, result.fields[name]?.value ?? null);

    if (expected === actual) {
      correctFields += 1;
      continue;
    }

    if (expected === null && actual !== null) hallucinated.push(name);
    diffs.push(`${name}: 期望「${expected ?? "—"}」實得「${actual ?? "—"}」`);
  }

  const expectedMissing = new Set(goldenCase.expected.missingRequiredFields);
  const predictedMissing = result.missingRequiredFields;
  const truePositives = predictedMissing.filter((field) =>
    expectedMissing.has(field),
  ).length;

  return {
    id: goldenCase.id,
    correctFields,
    totalFields: Object.keys(goldenCase.expected.fields).length,
    hallucinated,
    diffs,
    missingDetection: {
      truePositives,
      predicted: predictedMissing.length,
      actual: expectedMissing.size,
    },
  };
}

/** 除數為 0 時回 null，避免印出 NaN 誤導判讀。 */
function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return "n/a";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/**
 * Gemini 免費層對 flash-lite 的限制是 15 requests/min，全 36 則不節流必然撞 429。
 * 預設 4.5 秒/則（約 13 RPM）留安全邊際；付費層可用 --delay=0 全速跑。
 * 7.2 Eval Runner 與 8.5 CI 會遇到同一限制，屆時需沿用或改為併發控制。
 */
const DEFAULT_DELAY_MS = 4500;

function parseNumericArg(flag: string, fallback: number): number {
  const arg = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (arg == null) return fallback;
  const parsed = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseLimit(): number {
  const limit = parseNumericArg("--limit", GOLDEN_CASES.length);
  return limit > 0 ? limit : GOLDEN_CASES.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const merchantId = await ensureDevMerchant();
  const cases = GOLDEN_CASES.slice(0, parseLimit());
  const delayMs = parseNumericArg("--delay", DEFAULT_DELAY_MS);

  console.log(
    `Golden Set ${DATASET_VERSION}｜本次執行 ${cases.length} / ${GOLDEN_CASES.length} 則`,
  );
  console.log(
    `節流 ${delayMs}ms/則，預估耗時約 ${Math.ceil((cases.length * delayMs) / 60000)} 分鐘\n`,
  );

  const outcomes: CaseOutcome[] = [];
  for (const [index, goldenCase] of cases.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    const outcome = await runCase(goldenCase, merchantId);
    outcomes.push(outcome);

    const mark = outcome.diffs.length === 0 ? "✅" : "⚠️ ";
    console.log(
      `${mark} ${outcome.id}  欄位 ${outcome.correctFields}/${outcome.totalFields}`,
    );
    for (const diff of outcome.diffs) console.log(`     ${diff}`);
  }

  // ── 彙總（僅供人工判讀，正式指標計算屬 7.2）──
  const totals = outcomes.reduce(
    (acc, outcome) => ({
      correct: acc.correct + outcome.correctFields,
      fields: acc.fields + outcome.totalFields,
      hallucinated: acc.hallucinated + outcome.hallucinated.length,
      truePositives: acc.truePositives + outcome.missingDetection.truePositives,
      predicted: acc.predicted + outcome.missingDetection.predicted,
      actual: acc.actual + outcome.missingDetection.actual,
      perfect: acc.perfect + (outcome.diffs.length === 0 ? 1 : 0),
    }),
    { correct: 0, fields: 0, hallucinated: 0, truePositives: 0, predicted: 0, actual: 0, perfect: 0 },
  );

  console.log("\n──────── 基準線（參考值） ────────");
  console.log(`欄位抽取準確率　　 ${ratio(totals.correct, totals.fields)}  (${totals.correct}/${totals.fields})`);
  console.log(`全對案例比例　　　 ${ratio(totals.perfect, outcomes.length)}  (${totals.perfect}/${outcomes.length})`);
  console.log(`缺漏判定 Precision ${ratio(totals.truePositives, totals.predicted)}`);
  console.log(`缺漏判定 Recall　　${ratio(totals.truePositives, totals.actual)}`);
  console.log(`幻覺欄位數　　　　 ${totals.hallucinated}（原文未提卻抽出值）`);

  console.log(
    "\n🎉 Golden Set 驗收完成。⚠️ 標記的案例請逐條覆核：差異來源可能是模型錯誤，也可能是標註錯誤。",
  );
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});

/**
 * 區間加成係數的確定性求值（WBS 6.1 階段一）。
 *
 * ## 背景：價目表有一半沒有生效
 *
 * `rate_card_modifiers` 有兩種係數：固定倍率（min === max）與區間（min ≠ max）。
 * 在此之前只有固定倍率會被套用，而且只認得「授權範圍=X」一種觸發條件，其餘
 * 一律跳過。實際後果是**「三天內急件」與「一個月交件」報價完全相同**。
 *
 * ## 原則：能確定性判斷的就不該交給 LLM
 *
 * 這是不變式 I-2（缺漏判定不經 LLM）的延伸。6 個區間係數裡有 3 個的觸發與
 * 取值都能從既有欄位算出來，交給模型只是多花錢並引入不確定性：
 *
 * | 係數 | 依據 |
 * | :--- | :--- |
 * | 急件加成 | `deadline_days` 是數字，門檻是 3 天 |
 * | 上色複雜度 | `coloring_complexity` 是三選一的列舉 |
 * | 功能模組複雜度 | `feature_modules` 是清單，數個數即可 |
 *
 * 另外 3 個誠實地不處理，而不是猜：
 *
 * - **印刷檔輸出**、**高解析度輸出**：沒有任何抽取欄位對應這兩件事
 * - **品牌規範完整度**：觸發條件是「需完整VI系統而非僅LOGO」，但 subtype 若已是
 *   品牌識別CI-VI，其 base_price 的 includes 就寫著「VI手冊PDF」，用 subtype
 *   觸發會重複計價
 *
 * ## 取區間下限的理由
 *
 * 確定性求值判斷得出「有沒有觸發」，判斷不出「程度」——急件加成的 0.2～0.5
 * 本來就是留給推理層決定的空間。此時取下限而非上限或中點，沿用
 * `parseQuantity`「非正整數一律回退 1（保守，不放大金額）」的既有慣例。
 *
 * 寧可少報：商家可以在終審時往上調，而 WBS 6.4 的調價指標會把「系統性低估」
 * 量出來。那個數字正是判斷「推理層值不值得做」的依據。
 */
import type { ExtractedValues } from "./pricingTypes.ts";
import { normalizeLicenseScope } from "./licenseScope.ts";
import { validateModifierRatio } from "./modifierRange.ts";

/** 求值只需要這三個欄位，不綁定完整的 Tables<"rate_card_modifiers">，便於測試。 */
export interface EvaluableModifier {
  readonly trigger_condition: string;
  readonly range_min: number | null;
  readonly range_max: number | null;
}

export interface ModifierEvaluation {
  /** 單次套用的倍率，保證已通過區間驗證。 */
  readonly ratio: number;
  /**
   * 套用次數。多數係數為 1；「每加一個模組」這類按件計算的係數為件數。
   *
   * 刻意與 ratio 分開而非相乘後回傳單一值：區間驗證的對象是**單次套用**的
   * 倍率，3 個模組 × 0.15 = 0.45 會超出 [0.15, 0.4] 而被誤判為越界。
   */
  readonly applications: number;
}

/** 未觸發或無法判斷時回 null。 */
type Evaluator = (fields: ExtractedValues) => { ratio: "min"; applications: number } | null;

/** 急件的天數門檻。與 rate card 的 trigger_condition 文字「(3天)」一致。 */
const URGENT_DEADLINE_DAYS = 3;

/** 觸發「上色複雜度加成」的值。其餘值域成員視為 base_price 已涵蓋。 */
const PREMIUM_COLORING = "精緻上色";

/** 客戶明確表示「不需要」的標記值（與 parserFields 的 NONE_VALUE 同義）。 */
const NONE_VALUE = "無";

function valueOf(fields: ExtractedValues, name: string): string | null {
  const raw = fields[name]?.value ?? null;
  const trimmed = raw?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

const URGENT: Evaluator = (fields) => {
  const raw = valueOf(fields, "deadline_days");
  if (raw === null) return null;

  const days = Number.parseInt(raw, 10);
  // 判斷不出來就不加價：非數字或非正整數一律視為未觸發，而非猜一個天數。
  if (!Number.isInteger(days) || days <= 0) return null;

  return days <= URGENT_DEADLINE_DAYS ? { ratio: "min", applications: 1 } : null;
};

const PREMIUM_COLORING_EVALUATOR: Evaluator = (fields) =>
  valueOf(fields, "coloring_complexity") === PREMIUM_COLORING
    ? { ratio: "min", applications: 1 }
    : null;

const FEATURE_MODULES: Evaluator = (fields) => {
  const raw = valueOf(fields, "feature_modules");
  if (raw === null || raw === NONE_VALUE) return null;

  // 分隔符沿用 Parser 實際會產出的兩種（頓號與半形逗號，見 golden set 標註），
  // 並濾掉分隔符之間的空白造成的空項。
  const modules = raw
    .split(/[、,]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");

  return modules.length > 0 ? { ratio: "min", applications: modules.length } : null;
};

/**
 * 觸發條件 → 求值器。
 *
 * 用查表而非 if/else 串接，理由與 `transitions.ts` 相同：新增係數是加一筆
 * 資料，不是加一個分支。認不得的條件自然落到「查無此鍵」，天然不觸發，
 * 不需要 default 分支。
 */
const EVALUATORS: Record<string, Evaluator> = {
  "交期<=急件門檻(3天)": URGENT,
  "精緻上色vs簡易上色/線稿": PREMIUM_COLORING_EVALUATOR,
  "每加一個模組(會員/金流/多語系)": FEATURE_MODULES,
};

/** 「授權範圍=X」是參數化條件，無法列進查表，單獨處理。 */
const LICENSE_SCOPE_PATTERN = /^授權範圍=(.+)$/;

function evaluateLicenseScope(
  triggerCondition: string,
  fields: ExtractedValues,
): { ratio: "min"; applications: number } | null {
  const match = triggerCondition.match(LICENSE_SCOPE_PATTERN);
  if (!match) return null;

  const required = match[1].trim();
  return normalizeLicenseScope(valueOf(fields, "license_scope")) === required
    ? { ratio: "min", applications: 1 }
    : null;
}

/**
 * 判斷一個加成係數是否觸發，以及觸發時的單次倍率與套用次數。
 *
 * 回傳的 ratio 必定已通過 `validateModifierRatio`——即使目前一律取下限、
 * 理論上不可能越界，仍然走同一條驗證路徑。這樣日後推理層接上來時，
 * 「所有寫入的倍率都經過驗證」是結構保證而非慣例。
 */
export function evaluateModifier(
  modifier: EvaluableModifier,
  fields: ExtractedValues,
): ModifierEvaluation | null {
  const evaluator = EVALUATORS[modifier.trigger_condition];
  const outcome = evaluator
    ? evaluator(fields)
    : evaluateLicenseScope(modifier.trigger_condition, fields);

  if (outcome === null) return null;

  const validated = validateModifierRatio(modifier.range_min ?? Number.NaN, {
    rangeMin: modifier.range_min,
    rangeMax: modifier.range_max,
  });
  // 區間未定義或定義有誤時不套用。沒有邊界就沒有 bounded autonomy，
  // 此處寧可少算一筆加成，也不接受一個沒有上限的倍率。
  if (!validated.ok) return null;

  return { ratio: validated.ratio, applications: outcome.applications };
}

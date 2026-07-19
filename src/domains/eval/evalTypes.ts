/**
 * Eval 的資料形狀（WBS 7.2）。
 *
 * 分成兩層：CaseOutcome 是「跑一則案例得到什麼」（含 IO），EvalMetrics 是
 * 「一批 CaseOutcome 聚合出什麼指標」（純計算）。這樣指標邏輯可以完全用假資料
 * 單元測試，不需要碰 Gemini 或資料庫。
 */

/** 單一欄位的標註 vs 抽取比對結果（值皆為正規化後的形式）。 */
export interface FieldComparison {
  readonly name: string;
  readonly expected: string | null;
  readonly actual: string | null;
  readonly correct: boolean;
}

/** 單則 golden case 跑完 pipeline 的結果。 */
export interface CaseOutcome {
  readonly id: string;
  readonly fields: readonly FieldComparison[];
  /** 程式端依 confidence 門檻判定的缺漏欄位（模型抽取後算出）。 */
  readonly predictedMissing: readonly string[];
  /** 標註的缺漏欄位（人工標註的正確答案）。 */
  readonly expectedMissing: readonly string[];
  /**
   * 用「標註欄位」跑 computeBasePricing 得到的金額——即抽取完全正確時應有的報價。
   * 標註本身即查無費率（如 subtype 標為 null）時為 null，該則不列入偏差計算。
   */
  readonly expectedAmount: number | null;
  /** 用「模型抽取欄位」跑 computeBasePricing 得到的金額；outOfScope 時為 null。 */
  readonly actualAmount: number | null;
  /** 模型的抽取結果是否導致查無費率（報價金額為 null，需人工接手）。 */
  readonly outOfScope: boolean;
  readonly latencyMs: number;
  readonly costUsd: number;
  /** 實際處理這則的模型，取自 cost_logs；查無紀錄時為 null。 */
  readonly modelVersion: string | null;
}

/**
 * PRD §8.2 的評估指標。
 * 值為 null 代表該指標在本次執行中無法計算（分母為 0），刻意不用 0 代替——
 * 「沒有可評估的案例」與「表現為 0」是完全不同的意思，混用會誤導判讀。
 */
export interface EvalMetrics {
  /** 欄位層級：完全正確的欄位比例（含正確判為 null）。 */
  readonly fieldExtractionAccuracy: number | null;
  /** 欄位層級 F1：只看「該抽到值」的欄位，懲罰漏抽與錯抽。 */
  readonly fieldExtractionF1: number | null;
  /** 反問精準率：判為缺漏的欄位中，真的該問的比例（不該問卻亂問會拉低）。 */
  readonly clarificationPrecision: number | null;
  /** 反問召回率：該問的欄位中，真的有問到的比例（漏問會導致錯價）。 */
  readonly clarificationRecall: number | null;
  /** 幻覺率：原文未提及卻被抽出值的比例。 */
  readonly hallucinationRate: number | null;
  /** 報價偏差：抽取錯誤造成的金額偏差平均（0.05 = 平均偏 5%）。 */
  readonly quoteDeviationAvg: number | null;
  /** 單則最大報價偏差——平均會稀釋極端錯價，最大值才看得到災難案例。 */
  readonly quoteDeviationMax: number | null;
  /**
   * 端到端成功率：在「標註認為應該可以計價」的案例中，實際產出金額的比例。
   * 分母排除零資訊描述（標註即無法計價）——那些轉人工是正確行為，不是失敗。
   */
  readonly endToEndSuccessRate: number | null;
  readonly latencyAvgMs: number | null;
  readonly latencyP95Ms: number | null;
  readonly costPerCaseUsd: number | null;
}

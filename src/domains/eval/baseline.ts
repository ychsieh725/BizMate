/**
 * CI 閘門的基準線門檻（WBS 8.5）。
 *
 * ## 門檻怎麼定出來的
 *
 * 來源是 2026-08-18 對 dataset v1.0.0 / gemini-3.1-flash-lite 跑的完整 36 則
 * baseline，落檔在 `eval-artifacts/a6b-baseline.json`（已進版控）。
 *
 * **門檻取的是 Wilson 95% 下界，不是觀測值。** 這件事是被資料逼出來的：
 * 同一份資料集、同一個模型，08-17 與 08-18 兩次量測的欄位準確率是 199/204
 * 與 201/204。差的那兩個欄位不是回歸，是模型本身的變異。門檻若設在觀測值
 * 98.5%，08-17 那次就會紅燈——而那次並沒有任何東西壞掉。**會誤報的閘門會
 * 被關掉，關掉的閘門等於沒有閘門。**
 *
 * 各門檻的分母（取自該次 artifact）：
 * - 欄位層級指標：204 個欄位
 * - 反問與幻覺：53 個「標註為缺漏 / 原文未提及」的欄位
 * - 案例層級指標：36 則
 *
 * ## 為什麼分 blocking 與 advisory
 *
 * 只有「答案對不對」才擋合併。成本與延遲列為 advisory，因為它們在同一份資料
 * 上的量測變異大到無法當閘門：同一份 36 則跑三次，P95 分別是 2,093ms、
 * 11,010ms、18,126ms（8.7 倍），每案成本卻只在 $0.000447～$0.000488 之間
 * （6% 以內）。延遲的變異來自 Gemini 服務端排隊，不是我們的程式碼。同一份
 * 輸入、同樣的 token 數，時間差一個數量級——拿它當門檻只會製造噪音。
 *
 * ## 改動門檻的規矩
 *
 * 調高門檻（變嚴）可以隨時做。**調低門檻必須連同一次實測 artifact 一起提交**，
 * 並在此處註明是哪一次量測、分母多少——否則基準線會在無人察覺下一路滑下去，
 * 而 CI 全程綠燈。
 */
import type { MetricThreshold } from "./gate.ts";

/** 產出這組門檻的那次量測，供報告與日後回溯對照。 */
export const BASELINE_PROVENANCE = {
  artifact: "eval-artifacts/a6b-baseline.json",
  measuredAt: "2026-08-18",
  datasetVersion: "v1.0.0",
  modelVersion: "gemini-3.1-flash-lite",
  caseCount: 36,
} as const;

export const BASELINE_THRESHOLDS: readonly MetricThreshold[] = [
  {
    metric: "fieldExtractionAccuracy",
    direction: "atLeast",
    value: 0.9577,
    severity: "blocking",
    rationale:
      "201/204 的 Wilson 95% 下界。三次量測分別為 97.5%、98.5%、98.5%，" +
      "全部落在門檻之上，且最低的那次並沒有任何東西壞掉——那正是不用觀測值當門檻的理由",
  },
  {
    metric: "fieldExtractionF1",
    direction: "atLeast",
    value: 0.9577,
    severity: "blocking",
    rationale:
      "沿用準確率的下界作為保守替代。F1 是兩個比例的調和平均、不是二項比例，" +
      "Wilson 區間對它不成立，硬算出來的數字會比它應得的可信度更好看",
  },
  {
    metric: "clarificationRecall",
    direction: "atLeast",
    value: 0.9324,
    severity: "blocking",
    rationale: "53/53 的 Wilson 95% 下界。漏問一個欄位就會用錯的假設出價，比多問一題嚴重得多",
  },
  {
    metric: "hallucinationRate",
    direction: "atMost",
    value: 0,
    severity: "blocking",
    rationale:
      "硬門檻，不取區間下界。杜撰出來的欄位會直接變成報價依據，" +
      "客戶拿到一個沒有根據的金額——這比拿不到報價傷害更大",
  },
  {
    metric: "endToEndSuccessRate",
    direction: "atLeast",
    value: 0.9036,
    severity: "blocking",
    rationale: "36/36 的 Wilson 95% 下界。分母已排除標註即無法計價的案例，那些轉人工是正確行為",
  },
  {
    metric: "quoteDeviationMax",
    direction: "atMost",
    value: 0.1,
    severity: "blocking",
    rationale:
      "刻意不設為觀測到的 0.0%。單一欄位抽錯就會讓這個值跳動，設在 0 必然誤報；" +
      "設在 10% 仍能擋下真正的災難——6.8 記錄的 illu-003 錯價是 700%",
  },
  {
    metric: "clarificationPrecision",
    direction: "atLeast",
    value: 0.9,
    severity: "advisory",
    rationale:
      "精準率下滑代表模型開始問不必要的問題。這不會算錯價，但直接侵蝕產品主張" +
      "（讓客戶少答幾題），值得看見。三次量測為 98.1%、100%、100%",
  },
  {
    metric: "costPerCaseUsd",
    direction: "atMost",
    value: 0.0015,
    severity: "advisory",
    rationale:
      "數量級警戒線，不是基準線。三次量測落在 $0.000447～$0.000488；A6 量到 agent 版本是 3 倍" +
      "（$0.001443），故此線的實際作用是「有東西讓成本跳了一個量級」時出聲",
  },
  {
    metric: "latencyP95Ms",
    direction: "atMost",
    value: 30_000,
    severity: "advisory",
    rationale:
      "同上，數量級警戒線。三次量測為 2,093ms、11,010ms、18,126ms，變異 8.7 倍，" +
      "不可能當閘門；設在 30 秒是為了抓「結構性變慢」而非抓噪音。" +
      "把延遲變成可用的指標需要改成多次量測取中位數，那是獨立的待辦",
  },
];

/**
 * 加成係數的區間驗證（WBS 6.2、FR-PR-2 AC）。
 *
 * ## 為什麼這一層要先於推理層存在
 *
 * 本專案至今的安全性建立在一條簡單的界線上：**金額完全不經 LLM**。
 * `compute_quote` 連一個可以塞數字的參數都沒有。
 *
 * 區間加成會親手打開那道門：模型將能影響最終金額。SRS 的 FR-PR-2 AC 對此
 * 的要求逐字是「系統應在寫入前做程式層驗證（**非僅依賴 prompt**）」。
 * 這個檔案就是那道鎖，而鎖要在門打開之前裝好，不是之後補。
 *
 * ## 為什麼拒絕而不夾到邊界值
 *
 * 夾住（clamp）看起來比較友善：模型給 0.9，區間上限 0.5，那就用 0.5。
 * 但那會讓「模型持續產出界的值」變成一件看不見的事——報價照常產出、
 * 沒有任何異常訊號，而模型的判斷其實已經失控。
 *
 * 拒絕會讓它現形。呼叫端據此決定退回保守值並記錄，異常因此留下痕跡。
 *
 * ## 邊界是資料而非常數
 *
 * `[range_min, range_max]` 來自 `rate_card_modifiers`，由商家自行維護
 * （SAD ADR-3：邊界的單一權威來源）。程式層驗證與日後的 agent prompt 讀的
 * 是同一份資料，兩者不會漂移。
 */

/** 係數的合法區間，取自 rate_card_modifiers。null 代表該列未定義區間。 */
export interface ModifierRange {
  readonly rangeMin: number | null;
  readonly rangeMax: number | null;
}

export type ModifierRatioValidation =
  | { readonly ok: true; readonly ratio: number }
  | { readonly ok: false; readonly reason: string };

function reject(reason: string): ModifierRatioValidation {
  return { ok: false, reason };
}

/**
 * 驗證一個加成倍率是否落在該係數的合法區間內。
 *
 * 閉區間：剛好等於上下界視為合法。固定倍率的列（min === max）因此自然地
 * 只接受該值，不需要特別處理。
 */
export function validateModifierRatio(
  ratio: number,
  range: ModifierRange,
): ModifierRatioValidation {
  const { rangeMin, rangeMax } = range;

  // 沒有邊界就沒有 bounded autonomy。區間未定義時一律拒絕，而非退回「不限制」——
  // 後者會讓一列設定不全的資料悄悄變成無上限的授權。
  if (rangeMin === null || rangeMax === null) {
    return reject("該加成係數未定義區間（range_min 或 range_max 為 null），拒絕套用");
  }

  if (rangeMin > rangeMax) {
    return reject(
      `區間定義有誤：range_min ${rangeMin} 大於 range_max ${rangeMax}，拒絕套用`,
    );
  }

  // NaN 與 Infinity 都過不了這個檢查（NaN 的任何比較皆為 false）。
  // 負值同樣落在區間外，不需要另外判斷。
  if (!Number.isFinite(ratio) || ratio < rangeMin || ratio > rangeMax) {
    return reject(
      `加成倍率 ${ratio} 超出合法區間 [${rangeMin}, ${rangeMax}]，拒絕套用`,
    );
  }

  return { ok: true, ratio };
}

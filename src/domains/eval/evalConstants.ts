/**
 * Eval 執行產生的測試資料標記（WBS 7.2 附帶治理）。
 *
 * Eval Runner 每跑一次會建 36 筆 session（cost_logs 的 FK 需要），接進 CI 後
 * 會持續累積。dev 與 production 目前共用同一個 Supabase 專案（免費層 2 專案
 * 上限的取捨，見 docs/deployment.md），故測試資料必須可辨識、可清理。
 *
 * 用 contact_email 標記而非新增 is_test 欄位：零 schema 變更（migration 管線
 * 8.6 尚未建立，加欄位得手動套到 production），且語意成立——eval session 確實
 * 沒有真實客戶信箱，填一個保留位址是誠實的表述。
 */
export const EVAL_CONTACT_EMAIL = "eval@bizmate.local";

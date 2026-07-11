# code-quality-specialist 報告

- **日期**: 2026-07-11 12:15
- **任務**: feat/mt-m4a-quote-review 分支 code review（`git diff main...HEAD`，8 commits / 21 檔案）
- **範圍**: `quoteReviewService`、`quoteReviewRepository`、2 支 dashboard quotes API、2 個報價頁面

## 結論

**品味評分 🟢，PASS 可合併。0 CRITICAL / 0 HIGH。**

四項安全查驗全部通過：

- **歸屬檢查順序無漏洞** — `findById` 是序列化 await，不在子表的 `Promise.all` 裡；跨租戶時子表零查詢。
- **無繞過 service 的路徑** — grep 全 codebase：四個子表方法的唯一非測試呼叫端就是 `quoteReviewService`。
- **404/403 不洩漏存在性** — 「不存在」與「存在但非本人」合併為同一個 `return null`，且兩條路徑都只執行 1 次 `findById`，連時間側通道都無差異。
- **`findByMerchant` 過濾無遺漏** — `merchant_id` 是查詢基底，status 是疊加的可選 filter。

測試無假陽性：service 測試 mock repository（驗的是呼叫順序不變式）、route 測試 mock service，分層正確。

## 已處理的問題

- **[MEDIUM] session 歸屬未複查** — 已修（commit `97fcfcf`）。先寫 RED 測試證明現況會吐出錯配 session 的資料，再補 `session.merchant_id` 複查。詳見 [decisions/architect-2026-07-11-1215-quote-review-tenant-isolation.md]。
- **[MEDIUM] repository 零單元測試** — 已反駁並記入 WBS 8.4。事實正確（刪掉 merchant_id 過濾測試不會紅），但解法是把 verify scripts 接進 CI，不是補脆弱的 supabase builder mock 測試。

## 行動項目（延後，不在本分支）

- [ ] 8.4：`verify:*` scripts 接進 CI
- [ ] 5.9：報價列表分頁（現況無 limit）
- [ ] 5.9：抽共用「未授權」區塊元件（4 個 dashboard 頁面重複）；詳情頁 130 行 JSX 可拆 section 元件

## 影響評估

- **嚴重度**: MEDIUM（已修的 session 複查為防禦縱深，無行為變更）
- **影響範圍**: `domains/pricing` quote review 模組

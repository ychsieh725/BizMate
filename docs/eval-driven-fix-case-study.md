# 案例研究：用 Golden Set 抓出並修復 Parser 值域缺陷

> **對應 WBS**：7.1（Golden Set 建立）→ 6.8（Parser 值域約束修復）
> **日期**：2026-07-19
> **一句話**：424 個綠燈單元測試與一條通過的 E2E 金路徑都沒抓到的錯價缺陷，
> 被一份 36 則的標註資料集在首次執行時抓到，修復後同一份資料集量到
> 欄位抽取準確率 **81.4% → 97.1%**。

---

## 1. 摘要

| 指標 | 修復前 | 修復後 | 變化 |
| :--- | ---: | ---: | :--- |
| 欄位抽取準確率 | 81.4% (166/204) | **97.1%** (198/204) | +15.7pp |
| 全對案例比例 | 30.6% (11/36) | **83.3%** (30/36) | +52.7pp |
| 缺漏判定 Precision | 91.4% | 96.4% | +5.0pp |
| 缺漏判定 Recall | 100% | 100% | 維持 |
| 幻覺欄位數 | 0 | **0** | 維持（關鍵） |

模型：`gemini-3.1-flash-lite`｜資料集：Golden Set v1.0.0（36 則）

---

## 2. 背景：為什麼既有測試擋不住這個缺陷

修復前，專案的品質防線有兩道：

| 防線 | 規模 | 為什麼擋不住 |
| :--- | :--- | :--- |
| 單元測試 | 424 個，全綠 | 餵給 Parser 的是**我們自己寫的乾淨 fixture**（`{ value: "LOGO設計" }`），驗證的是「拿到這個值之後的邏輯對不對」，而非「LLM 真的會回這個值嗎」 |
| E2E 測試（8.2） | 金路徑通過 | 只斷言**流程走得完**（登入→報價→確認→寄信），不斷言報價金額的品質。金額是 `null` 也算走完 |

**LLM 輸出的品質是完全沒有量測的盲區。** 這正是 WBS 7.1 要補的洞。

---

## 3. 缺陷發現

Golden Set 建立完成後，第一次對真實 Gemini 執行基準線量測腳本（當時為 `pnpm verify:golden-set`，7.2 已併入 `pnpm eval`），
逐案例對照立刻暴露一個系統性模式：

```
⚠️  graphic-001  欄位 3/5
     subtype: 期望「LOGO設計」實得「公司LOGO」
⚠️  graphic-002  欄位 3/5
     subtype: 期望「海報文宣」實得「活動海報」
⚠️  graphic-003  欄位 2/5
     subtype: 期望「品牌識別CI-VI」實得「品牌識別系統」
⚠️  web-002  欄位 5/7
     subtype: 期望「多頁式網站」實得「公司形象官網」
```

**`subtype` 幾乎沒有一則對得上 rate card 的標準名稱。** 模型抽的是原文詞。

---

## 4. 根因查證

發現差異後沒有直接下結論，而是追進程式碼確認嚴重性。

**第一步：`subtype` 怎麼被使用？**

`src/domains/pricing/repositories/rateCardRepository.ts`：

```ts
.eq("subtype", subtype)   // ← 精確相等比對
```

**第二步：查不到會怎樣？**

`src/domains/pricing/basePricing.ts`：

```ts
const base = subtype ? await rateCardRepository.findBase(...) : null;
if (base == null || base.base_price == null) {
  return { lineItems: [], total: 0, outOfScope: true };   // ← 報價失敗
}
```

**第三步：`outOfScope` 的下場？**

`src/orchestrator/resolveAfterParse.ts`：

```ts
finalAmount: pricing.outOfScope ? null : pricing.total,   // ← 金額為 null
```

### 結論

```
Parser 抽出「公司LOGO」
  → findBase 精確比對查無資料
  → computeBasePricing 回 outOfScope
  → quote.final_amount = null
  → 「自動報價」退化為人工填價
```

**嚴重性：HIGH**（非 CRITICAL）。系統有 `outOfScope` 的優雅降級路徑，不會崩潰，
但產品的核心價值主張——自動報價——在多數真實輸入下失效。

### 佐證：這是疏漏，不是有意設計

同一支 `basePricing.ts` 裡，`license_scope` 有專門的正規化函式：

```ts
/**
 * 將授權範圍抽取值正規化到 rate card 的授權維度值域。
 * P0 用關鍵字比對（deterministic、可測）；抽取值多變（「商用」「商業用途」），
 * 故以包含關係判斷，而非精確相等。
 */
export function normalizeLicenseScope(value: string | null): string | null
```

作者**已經意識到「抽取值多變」這個問題**並為 `license_scope` 做了處理，
卻沒對 `subtype` 做同等處理——這是不對稱的疏漏，不是刻意的設計取捨。

---

## 5. 解法評估

| 方案 | 判斷 | 理由 |
| :--- | :--- | :--- |
| **(a) schema 用 `z.enum` 限縮值域** | ✅ **採用** | 在**生成時**約束，而非事後猜測。值域來自 rate card，商家改價目表自動同步 |
| (b) 加 `normalizeSubtype` 模糊比對 | ❌ 否決 | 13 個 subtype 的誤判代價不對稱——「網站」該對「多頁式網站」還是「電商網站」？**兩者價差 10 倍** |
| (c) `findBase` 改模糊查詢 | ❌ 否決 | 風險最高，錯配即錯價，且把猜測藏進 repository 層，未來難以追查 |

### 最大風險與三層防堵

**強制 enum 會讓模型被迫從清單裡挑一個。** 客戶說「幫我做 APP 設計」而值域
沒有這項時，模型可能硬選「UI-UX設計稿」——**把「誠實的缺漏」變成「自信的錯配」，
那會比修復前更糟**（現況至少會誠實地判為缺漏並反問）。

| 層 | 措施 |
| :--- | :--- |
| 1 | schema 用 **nullable enum**，`null` 是合法輸出 |
| 2 | system instruction 明令：「不得勉強歸類——**填錯選項會導致報價錯誤，填 null 只會多問一題**」 |
| 3 | Golden Set 的三則零資訊案例（`graphic-011`/`illu-011`/`web-011`）持續守著幻覺率，此風險一旦發生即可測出 |

---

## 6. 實作

### 架構決定：值域由誰查？

`subtype` 的值域是 **per-merchant 動態的**（來自各商家的 `rate_card_base`）。
兩個選項：

- ❌ `parserAgent` 自己查 → intake domain 依賴 pricing domain，模組邊界模糊
- ✅ **orchestrator 查好傳入** → 跨域組裝本就是 orchestrator 的職責，
  `parserAgent` 保持純粹：「給我值域，我就限縮」

### 變更清單

| 檔案 | 變更 |
| :--- | :--- |
| `src/shared/constants/fieldDomains.ts` | **新增**。靜態值域單一事實來源（授權範圍／上色複雜度／布林） |
| `src/domains/intake/parserFields.ts` | `buildParseResponseSchema` 新增 `allowedSubtypes` 參數，依欄位套用 enum |
| `src/domains/intake/parserAgent.ts` | `parseIntake` 新增 `allowedSubtypes`；system instruction 補 3 條規則；prompt 列出可選項 |
| `src/domains/pricing/repositories/rateCardRepository.ts` | 新增 `findActiveSubtypes` |
| `src/orchestrator/describeFlow.ts` | 查值域後傳入 Parser |
| `src/orchestrator/answerFlow.ts` | 同上（反問補答同樣需要值域約束） |
| `scripts/verify-parser.ts`、基準線量測腳本 | 同步更新呼叫 |

無資料庫變更（`is_active` 欄位在 5.5 已存在）。

### 值域對應

| 欄位 | 值域來源 | 值 |
| :--- | :--- | :--- |
| `subtype` | **動態**（該商家 rate card 的 active 項目） | 依商家而異 |
| `license_scope` | 靜態 | 個人使用／商業使用／獨家買斷 |
| `coloring_complexity` | 靜態 | 精緻上色／簡易上色／線稿 |
| `includes_*` | 靜態（前綴規則） | 是／否 |
| `quantity`、`page_count`、`deadline_days`、`feature_modules` | 無固定值域 | 自由字串 |

**布林欄位採 `includes_` 前綴規則而非逐一列舉**：漏掉值域會靜默退回自由字串，
是不易察覺的退步；前綴規則讓日後新增同類欄位自動獲得約束。

### 邊界處理

新商家尚無任何 active 服務項目時，`allowedSubtypes` 為空陣列。
**空 enum 會讓模型無值可選而必定失敗**，故降級為自由字串——此時 rate card
本就查不到，會照既有路徑走 `outOfScope`，行為與修復前一致。

---

## 7. 測試結果

### 7.1 單元測試

```
Test Files  46 passed (46)
     Tests  435 passed (435)
```

新增測試 11 項：

| 測試檔 | 項數 | 覆蓋 |
| :--- | ---: | :--- |
| `src/domains/intake/parserFields.test.ts`（新建） | 8 | enum 是否真的編進送給 Gemini 的 JSON Schema、空清單降級、值域外的值被拒絕、null 仍合法 |
| `src/domains/intake/parserAgent.test.ts`（擴充） | 3 | 可選項寫進 prompt、空清單不出現提示、system instruction 含「不得勉強歸類」 |

**關鍵測試設計**：直接斷言 `z.toJSONSchema()` 轉換後的 JSON Schema，
而非斷言 zod 物件本身——**那才是真正送給模型的東西**，斷言 zod 物件無法
證明 enum 有傳到模型。

```ts
it("值域外的 subtype 會被 schema 拒絕", () => {
  expect(schema.safeParse(build("LOGO設計")).success).toBe(true);
  expect(schema.safeParse(build("公司LOGO")).success).toBe(false);
});
```

### 7.2 型別與 Lint

```
$ npx tsc --noEmit    # 無錯誤
$ pnpm lint           # 無錯誤
```

### 7.3 Golden Set 實測（真實 Gemini，全 36 則）

**修復前**（節錄，完整彙總見下表）：

```
⚠️  illu-006  欄位 4/5
     subtype: 期望「單張插畫」實得「插畫」
⚠️  web-001  欄位 5/7
     subtype: 期望「Landing Page」實得「landing page」
     feature_modules: 期望「無」實得「—」
⚠️  web-002  欄位 5/7
     subtype: 期望「多頁式網站」實得「公司形象官網」
⚠️  web-009  欄位 6/7
     subtype: 期望「UI-UX設計稿」實得「UI設計」

──────── 基準線 ────────
欄位抽取準確率　　 81.4%  (166/204)
全對案例比例　　　 30.6%  (11/36)
缺漏判定 Precision 91.4%
缺漏判定 Recall　　100.0%
幻覺欄位數　　　　 0
```

**修復後**（節錄）：

```
✅ graphic-007  欄位 5/5
✅ graphic-010  欄位 5/5      ← prompt injection 案例，五欄照常抽取
✅ illu-001  欄位 5/5
✅ web-001  欄位 7/7
✅ web-009  欄位 7/7
✅ web-012  欄位 7/7          ← 混淆描述（電商→landing page）判斷正確
⚠️  illu-003  欄位 4/5
     quantity: 期望「1」實得「8」
⚠️  web-002  欄位 6/7
     feature_modules: 期望「會員系統、多語系」實得「會員系統,多語系」

──────── 基準線 ────────
欄位抽取準確率　　 97.1%  (198/204)
全對案例比例　　　 83.3%  (30/36)
缺漏判定 Precision 96.4%
缺漏判定 Recall　　100.0%
幻覺欄位數　　　　 0
```

**`subtype` 全數正確。幻覺維持 0** ——這是最關鍵的一項，證明 enum 沒有逼出
「自信的錯配」，第 5 節指出的最大風險未發生。

### 7.4 Parser 端到端實測

`pnpm verify:parser` 通過，並可見交期換算規則生效：

```json
"deadline_days": {
  "value": "14",
  "confidence": 1,
  "source_span": "兩週"     ← 原文是「兩週」，已換算為 14
}
```

---

## 8. 殘留差異（6 項，皆已記入 WBS）

| # | 案例 | 差異 | 影響 | 歸屬 |
| :-- | :--- | :--- | :--- | :--- |
| 1 | `illu-003` | 「一組貼圖八款」抽為 `quantity=8` | **真實錯價風險**（會算成 8×12000） | 屬語意理解而非值域問題，留待 6.1 |
| 2 | `graphic-006` | 「一款」未抽出數量 | 無（下游 `parseQuantity` 回退 1，結果相同），但會多問一題 | 6.1 |
| 3-5 | `web-002/003/008` | `feature_modules` 分隔符與措辭發散 | 無（該欄目前未被計價使用） | 該欄無固定值域，等 6.1 用到時再定格式 |

第 1 項是刻意設計的陷阱案例（`notes` 已註明「陷阱在數量——八款是貼圖組的
內含規格，計價單位是每組」），模型仍上當。這是 Golden Set 的另一項價值：
**把已知的困難案例固化下來，避免未來的修改悄悄讓它變得更糟**。

---

## 9. 過程中的兩次自我修正

記錄下來因為它們影響了量測的可信度。

### 修正 1：量測邏輯產生假警報

第一版的 verify script 做字面比對，`license_scope` 期望「商業使用」實得
「商業用途」被記為錯誤——但 `basePricing` 有 `normalizeLicenseScope`，
**下游其實算得完全正確**。

**修正**：正規化改為沿用下游的真實邏輯（`normalizeLicenseScope` 與
`parseQuantity` 的回退規則）。衡量的對象是「抽取結果餵給 pricing 後會不會
算錯」，不是「字串長得像不像」。

反之，`subtype` 與 `feature_modules` **刻意不正規化**——因為下游真的會出錯，
必須讓它現形。

### 修正 2：布林正規化污染數值欄位

把 `"1"` 加進布林同義詞後，`quantity: "1"` 被轉成「是」，把正確抽取記成錯誤。

**修正**：布林正規化只套用在 `includes_*` 欄位。

> **教訓**：量測工具本身也需要被檢查。一個會產生假警報的指標比沒有指標更糟——
> 它會誤導修復方向，並讓後續的 CI 閘門建立在錯誤的基準上。

---

## 10. 環境限制記錄

實測時撞到 **Gemini 免費層 15 requests/min** 限制，全 36 則序列執行在第 21 則
中斷（`429 RESOURCE_EXHAUSTED`）。既有的重試機制不涵蓋配額耗盡——重試只會
繼續撞牆。

**處理**：量測腳本內建 4.5s/則節流（約 13 RPM，留安全邊際），
並提供 `--delay=` 覆寫與 `--limit=` 小量試跑。

**後續影響**：WBS 7.2（Eval Runner）與 8.5（CI 雙閘門）會遇到同一限制，
需沿用節流或改為併發控制；CI 若要縮短執行時間，需評估付費層。

---

## 11. 這個案例證明了什麼

1. **對 LLM 輸出的品質，只有跑真實模型的標註資料集擋得住。** 424 個單元測試
   與通過的 E2E 都沒抓到這個缺陷，因為它們驗證的是「程式邏輯」而非「模型行為」。

2. **指標驅動開發的閉環是可操作的**：建立基準（7.1）→ 定位缺陷 → 評估解法 →
   修復（6.8）→ **同一份資料集重測驗證成效**。每一步都有數字，不靠感覺。

3. **修復本身也要被量測。** 「幻覺維持 0」與「準確率提升」同等重要——前者
   證明沒有引入新的失敗模式。只看提升的指標，可能會忽略解法帶來的副作用。

---

## 附錄：相關檔案

| 用途 | 路徑 |
| :--- | :--- |
| 標註資料集 | `src/domains/eval/goldenCases.{graphic,illustration,web}.ts` |
| 資料集型別與正規化約定 | `src/domains/eval/goldenSet.types.ts` |
| 完整性測試（14 項） | `src/domains/eval/goldenSet.test.ts` |
| 基準線量測腳本 | `scripts/run-eval.ts`（`pnpm eval`；7.2 起取代原 `verify-golden-set.ts`） |
| 值域定義 | `src/shared/constants/fieldDomains.ts` |
| 值域 schema 測試（8 項） | `src/domains/intake/parserFields.test.ts` |

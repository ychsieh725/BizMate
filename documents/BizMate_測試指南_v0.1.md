# BizMate 測試指南 v0.1

**建立日期：** 2026-07-05
**首次引入任務：** 3.1 Orchestrator 狀態機（同時完成 7.1 測試基礎設施）
**適用範圍：** 全專案單元/整合測試策略、工具鏈、撰寫慣例與踩坑紀錄

> 這份文件記錄「測試怎麼跑、怎麼寫、以及建置時踩過哪些坑」。新增測試前先讀本文，
> 避免重蹈覆轍。踩坑章節（§7）尤其重要。

---

## 1. 測試策略

| 層級 | 工具 | 對象 | 覆蓋率要求 |
|---|---|---|---|
| 單元測試 | Vitest | 純函式、工具、狀態機、deterministic 邏輯 | 80%+（`.claude/rules/testing.md`） |
| 整合測試 | Vitest | Repository、API route、Agent 封裝 | 納入同一門檻 |
| 煙霧驗證 | `scripts/verify-*.ts` | 連真實 Supabase/Gemini 的手動驗收 | 不計入覆蓋率（見 §6） |
| E2E | Playwright（任務 7.2 引入，尚未建置） | 關鍵使用者流程 | — |

**TDD 為強制流程**（CLAUDE.md）：先寫測試（RED）→ 最小實作（GREEN）→ 重構 → 驗證覆蓋率。
3.1 即以此流程完成：107 測試先全紅，實作後全綠、覆蓋率 100%。

---

## 2. 工具鏈

| 套件 | 版本 | 用途 |
|---|---|---|
| `vitest` | 4.1.9 | 測試 runner |
| `@vitest/coverage-v8` | 4.1.9 | v8 覆蓋率 provider |
| `vite-tsconfig-paths` | 6.1.1 | 讓測試沿用 tsconfig 的 `@/*` 別名與 `.ts` 副檔名 import |

設定檔：[`vitest.config.ts`](../vitest.config.ts)（專案根目錄）。

---

## 3. 執行方式

```bash
pnpm test            # 單次跑完所有測試（CI 用）
pnpm test:watch      # 監看模式（開發用）
pnpm test:coverage   # 跑測試 + 覆蓋率報告（含 80% 門檻把關）
```

覆蓋率 HTML 報告輸出至 `coverage/`（已於 `.gitignore` 與 eslint ignores 排除）。

---

## 4. 目錄與命名慣例

- 測試檔與被測檔**同目錄併放**：`stateMachine.ts` ↔ `stateMachine.test.ts`。
- 命名：`*.test.ts`（`vitest.config.ts` 的 `include` 認 `*.{test,spec}.ts`）。
- import 一律用 `@/` 別名 + `.ts` 副檔名，與專案 ESM 慣例一致（見 §7.1）。

---

## 5. 撰寫慣例（從 3.1 萃取的可複用模式）

### 5.1 Table-driven 測試

用資料驅動取代重複的 `it()`，避免手抄 N 份雷同案例（DRY）：

```ts
it.each(EXPECTED_TRANSITIONS)("%s + %s → %s", (from, event, expected) => {
  expect(transition(from, event)).toEqual({ ok: true, state: expected });
});
```

### 5.2 獨立的「第二事實來源」

測試不該直接引用被測模組的資料表來驗證自己——那樣實作錯了測試也跟著錯。
3.1 在測試檔內**依 SDS §4.2 手寫一份 `EXPECTED_TRANSITIONS`**，與 `transitions.ts`
獨立。若實作的轉移表被改錯，這份對照能抓到偏差。

### 5.3 純函式優先

狀態機刻意設計為純函式（無 I/O、無副作用），持久化留給上層。純函式最好測：
輸入→輸出、無需 mock。實作新邏輯時盡量把「決策」與「副作用」分離，決策部分純化後單獨測。

### 5.4 Result 型別而非 throw

錯誤路徑用 `{ ok: false, error }` 回傳，測試可直接斷言結果物件，不必包 `expect().toThrow()`。

---

## 6. 覆蓋率設定：白名單策略（重要）

`vitest.config.ts` 的 `coverage.include` 採**白名單**，目前僅：

```ts
include: ["src/orchestrator/**/*.ts"]
```

**原因**：M0 既有模組（`costLogger`、各 repository、`env`、`gemini/*`）當初以
`verify-*.ts` 手動腳本驗收，**尚無 vitest 單元測試**。若把它們納入 include，全域
覆蓋率會被尚未動工的檔案拉到個位數、門檻永遠紅。

**維護規則**：7.1 貫穿任務為某個 M0 模組補上測試後，**把該模組路徑加進 include 白名單**，
門檻才開始對它把關。這樣門檻永遠只衡量「已承諾測試的範圍」，且逐步擴大。

`exclude` 排除 `*.test.ts` 與 `*.types.ts`（純型別檔無 runtime 程式碼）。

---

## 7. 踩過的坑（建置測試設施時實際遇到）

### 7.1 `.ts` 副檔名 import 需要路徑解析外掛

專案 tsconfig 開了 `allowImportingTsExtensions`，程式碼用 `@/lib/foo.ts` 這種帶副檔名
的 ESM import。Vitest（Vite）預設不認 `@/*` 別名。
**解法**：裝 `vite-tsconfig-paths` 並在 `vitest.config.ts` 掛 `plugins: [tsconfigPaths()]`，
讓測試沿用 tsconfig 的 `paths` 與副檔名設定。

### 7.2 `coverage.all: false` 在 Vitest 4 無效

想用 `all: false` 讓覆蓋率只計「被測試載入的檔案」，但 **Vitest 4 的 `CoverageOptions`
已無 `all` 屬性**（TS 直接報 `類型 'CoverageOptions' 中沒有 'all'`），設了也不生效、
全域覆蓋率仍把所有檔案算入。
**解法**：不要用 `all`，改用 §6 的 `include` 白名單控制範圍。

### 7.3 覆蓋率 include 過廣 → 門檻被未測檔案拉爆

初版 `include: ["src/**/*.ts"]` 把整個專案算進全域門檻，M0 未測檔案讓覆蓋率掉到
6.4%，門檻 80% 直接紅。
**解法**：見 §6，include 收斂為白名單，只納入已寫測試的模組。

### 7.4 eslint 掃到 coverage/ 產出

`pnpm test:coverage` 產生的 `coverage/` HTML 資產（如 `block-navigation.js`）被 eslint
掃到，報 unused eslint-disable warning。`.gitignore` 雖已排除它、不進 git，但 eslint
不吃 `.gitignore`。
**解法**：在 [`eslint.config.mjs`](../eslint.config.mjs) 的 `globalIgnores` 加 `coverage/**`。

### 7.5 vite-tsconfig-paths 的 deprecation 提示（尚未處理）

跑測試時 Vite 會提示：「vite-tsconfig-paths 已可用原生 `resolve.tsconfigPaths: true`
取代」。目前**仍用外掛**（能正常運作），未來可評估移除外掛、改用 Vite 原生設定以少一個依賴。
屬非阻塞的可選簡化，不急。

---

## 8. 與 M0 驗證腳本的關係

`scripts/verify-*.ts`（`verify-db`、`verify-repo`、`verify-gemini`、`verify-cost`）是
**連真實外部服務的手動煙霧測試**，用 `tsx --env-file=.env.local` 執行，驗證「封裝能真的
打通 Supabase/Gemini」。它們：

- **不是** vitest 單元測試，**不計入**覆蓋率。
- 需要真實 `.env.local` 憑證，不適合放進 CI 的純單元測試流程。
- 定位為「整合煙霧驗證」，與 vitest 的「隔離單元測試」互補，兩者都保留。

---

## 9. 後續（對齊 WBS 7.1 / 7.2）

- [ ] 7.1：逐步為 M0 模組補 vitest 測試，並同步擴充 §6 的覆蓋率白名單。
- [ ] 7.2：引入 Playwright 建置 E2E（關鍵使用者流程：Wizard → 報價）。
- [ ] 評估 §7.5 的外掛移除簡化。

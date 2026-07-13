# 05 · 開發工作流：測試、驗證、資料庫變更

> 這一章講「改了程式碼之後，怎麼證明它是對的」。這個專案有三層驗證，各補彼此的盲區。

## 三層驗證金字塔

```
        ╱  E2E（Playwright）  ╲        最慢、最貴，但最接近真實
       ╱   tests/e2e/ 2 支     ╲       → 開真的瀏覽器跑完整流程
      ╱─────────────────────────╲
     ╱  verify 腳本（16+ 支）      ╲     對真實外部服務驗證
    ╱   scripts/verify-*.ts        ╲    → 真的連 DB / Gemini / Resend
   ╱─────────────────────────────────╲
  ╱  單元測試（vitest，397+ 個）        ╲  最快，每次改動都跑
 ╱   src/**/*.test.ts                   ╲ → 外部依賴全部 mock
╱─────────────────────────────────────────╲
```

## 第一層：單元測試

```bash
pnpm test              # 跑全部（幾秒內跑完）
pnpm test:watch        # 監看模式，邊改邊跑
pnpm test:coverage     # 覆蓋率報告（核心模組門檻 80%）
```

- 測試檔跟被測檔放在一起：`stateMachine.ts` 旁邊就是 `stateMachine.test.ts`
- 外部依賴（Supabase、Gemini）用 `vi.mock()` 假造——所以跑得飛快，但也代表它**證明不了**「真實 DB 的權限設定對不對」「Gemini 真的會回我們要的格式」這類事
- 專案慣例是 **TDD**：先寫會失敗的測試，再寫最小實作讓它變綠（`.claude/rules/testing.md`）

## 第二層：verify 腳本（本專案特色）

單元測試 mock 掉的盲區，用這些腳本補。每支都是獨立的 TypeScript 程式，用真實金鑰連真實服務：

```bash
pnpm db:verify              # 14 張表都存取得到
pnpm verify:auth            # 用商家 A 的真實 JWT 直查 DB，證明 RLS 只回 A 的資料
pnpm verify:describe        # 真的呼叫 Gemini 跑完整解析→計價
pnpm verify:quote-actions   # 對真實 DB 驗證原子 RPC 的 CAS 與租戶隔離（含 rollback 證明）
pnpm verify:email           # 真的透過 Resend 寄一封信（人工開信箱核對）
pnpm verify:security        # 證明 RPC 的 PUBLIC 執行權已收回
# ...完整清單見 package.json 的 scripts
```

它們的共同模式：建立臨時測試資料 → 執行斷言 → **`finally` 區塊清理**（不留垃圾在 dev DB）。失敗時 `process.exit(1)`。

**什麼時候要寫新的 verify 腳本？** 當你的功能碰到「mock 測不到的邊界」：真實 DB 的權限/約束/RPC、真實 AI 的輸出品質、真實郵件的送達。專案的教訓（記錄在 WBS 8.1）：只在應用層測試的話，資料庫層的防線可能從來沒被真的觸發過。

## 第三層：E2E（Playwright）

```bash
pnpm test:e2e                          # 全部（自動啟動 dev server）
pnpm test:e2e critical-path.spec.ts    # 只跑金路徑
pnpm test:e2e:report                   # 看 HTML 報告
```

`tests/e2e/critical-path.spec.ts` 開一個真的無頭瀏覽器，把整條產品流程跑一遍：登入 → onboarding → 改價 → 開匿名視窗當客戶送需求（真的呼叫 Gemini）→ 後台確認 → 寄信（真的寄）。

注意事項：

- **不要反覆狂跑**——`POST /api/sessions` 有限流（10 次/小時），寄信吃 Resend 免費額度（100 封/天）
- 定位元素用 `data-testid` 屬性（如 `data-testid="quote-confirm"`）。改 UI 時**不要刪掉這些屬性**，否則 E2E 會壞
- 頁面物件模式（Page Object Model）：每個頁面的操作封裝在 `tests/e2e/pages/*.ts`，測試本體只描述流程

## 改資料庫結構的流程

```
1. 在 supabase/migrations/ 新增檔案，編號遞增（如 0008_xxx.sql）
2. 寫成冪等（IF NOT EXISTS / CREATE OR REPLACE）——可安全重跑
3. 新建的表記得 GRANT 權限給 service_role
   （0001 的「全表授權」只涵蓋當時已存在的表，之後建的表要自己補）
4. ⚠️ migration 不會自動套用——由人工貼到 Supabase Studio 的 SQL Editor 執行
5. 同步更新 src/lib/supabase/database.types.ts（DB 型別是手寫維護的）
6. 寫/跑對應的 verify 腳本證明 migration 生效
```

## Git 工作流（重點摘要，完整規範在 `.claude/rules/git-workflow.md`）

```
main 是保護分支，禁止直接 commit
   │
   ├─ 開功能分支：feat/xxx、fix/xxx、chore/xxx
   ├─ TDD 開發 → verify 驗證 → commit
   │    commit message 格式：主旨行 + WHY（為什麼做）/ WHAT（做了什麼）/ IMPACT（影響）
   └─ 完成後 --no-ff merge 回 main、刪分支
```

寫 commit message 的標準：想像一個從沒看過這個 repo 的人，讀完 message 就能理解這次改動的動機與影響。禁止「fix」「update」這種無意義主旨。

## 常用指令速查

| 指令 | 用途 |
|---|---|
| `pnpm dev` | 開發伺服器（http://localhost:3000） |
| `pnpm test` | 單元測試 |
| `pnpm build` | 建置 + TypeScript 型別檢查（改完大範圍程式碼後跑一次） |
| `pnpm lint` | ESLint |
| `pnpm test:e2e` | 端到端測試 |
| `pnpm verify:<name>` | 對真實服務驗證某功能 |
| `pnpm seed:rate-card` | 灌範本價目表種子資料 |

## 卡住的時候去哪找答案？

1. **「為什麼當初這樣設計？」** → `docs/superpowers/specs/`（每個功能的設計文件）和 `docs/superpowers/plans/`（實作計畫），檔名含日期與功能名
2. **「這個需求的原始定義？」** → `documents/` 下的 PRD / SRS / SAD / SDS 與多租戶重構計畫
3. **「目前整體進度？」** → `.claude/taskmaster-data/wbs.md`（任務清單，含每個任務的完成摘要與教訓）
4. **「這段程式碼在幹嘛？」** → 先讀檔案頂部的區塊註解——這個專案的檔案級註解通常會講清楚職責與設計取捨

# BizMate — Supabase 連接指南與踩坑紀錄

**日期**：2026-07-04
**對應任務**：WBS 2.2（schema migration）、2.3（環境變數驗證）、2.4（Repository 層）
**適用**：Next.js 16 + pnpm 11 + Node 24 + Supabase（Postgres）
**目的**：記錄 BizMate 連接 Supabase 的完整流程，以及實作中實際遇到的問題與解法，供日後重建環境或他人參考。

---

## 1. 建立 Supabase 專案時的安全選項

建立專案時，Data API 的 Security 區塊有三個選項，BizMate 的架構前提是**資料庫只在伺服器端存取**（Next.js API Routes 用 `service_role` key），瀏覽器永遠不直接連 Supabase、不用 anon key、不用 Supabase Auth。依此：

| 選項 | 決定 | 理由 |
|---|---|---|
| **Enable Data API** | ✅ 勾 | `@supabase/supabase-js` 走這個 PostgREST 端點；關掉就得改直連 Postgres |
| **Automatically expose new tables** | ❌ 不勾 | 這是自動把新表權限給 anon/authenticated；我們不用 anon，手動控制縮小攻擊面。`service_role` 不受此影響 |
| **Enable automatic RLS** | ✅ 勾 | 所有新表預設開 RLS；`service_role` 繞過 RLS，萬一 anon key 外洩也零存取 |

**效果**：
```
瀏覽器 / anon key  ──▶  ❌ 什麼都讀不到（未 expose + RLS 擋）
伺服器 service_role ──▶  ✅ 完整存取（繞過 RLS）
```

> 建立專案時另外要選 **Region**（台灣建議 Tokyo，延遲最低）並保存好 Database password。

---

## 2. 取得金鑰與填入位置

金鑰填在專案根目錄的 `.env.local`（已被 `.gitignore` 排除，**絕不進版控**）。範本見 `.env.example`。

| `.env.local` 欄位 | 對應 Supabase 的值 | 位置 |
|---|---|---|
| `SUPABASE_URL` | Project URL（`https://<ref>.supabase.co`） | Dashboard → **Connect** 按鈕，或 Project Settings → **Data API** |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key（標示 secret 那把，⚠️ 不是 anon/public） | Project Settings → API Keys |

填寫規則：值直接貼在 `=` 後面，**不要加引號**。目前只需填這兩項，其餘（Gemini/LINE/Gmail/Admin）留空，後續任務再補。

---

## 3. 套用 schema（migration）

BizMate 的 schema 以版本化 SQL 檔管理：`supabase/migrations/0001_init.sql`（12 張表 + 4 enum + 3 索引，對應 SDS §3）。

**套用方式**（不需把 DB 密碼交給任何工具）：
1. Supabase Dashboard → **SQL Editor** → New query
2. 貼上 `0001_init.sql` 全部內容 → **Run**
3. 看到 `Success. No rows returned` 即成功

SQL 的三個設計特性：
- **冪等**：enum 用 `DO $$ ... EXCEPTION WHEN duplicate_object`，表用 `CREATE TABLE IF NOT EXISTS`，可重複執行不報錯。
- **顯式 RLS**：每張表 `ENABLE ROW LEVEL SECURITY`，達成 deny-by-default，不依賴 dashboard 的自動 RLS 開關。
- **顯式授權**：`GRANT ALL ... TO service_role`，讓 migration 自帶伺服器端存取保證。

---

## 4. 驗證連線

```bash
pnpm db:verify
```

此指令（`tsx --env-file=.env.local scripts/verify-db.ts`）用 `service_role` 對 12 張表逐一做 head count，全部可存取即代表：金鑰正確、migration 已套用、授權正常。

預期輸出：
```
✅ sessions
✅ raw_inputs
... （共 12 張）
結果：12/12 張表可存取
🎉 Schema 驗收通過。
```

---

## 5. 踩過的坑與解法

以下都是本次實作中**實際遇到**的問題，非假設。

### 坑 1：找不到 Project URL（新版 UI 改了位置）
- **現象**：舊教學說在 Settings → API，但新版 Supabase 找不到。
- **解法**：新版移到 **Project Settings → Data API** 的最上方，或點專案頁上方綠色 **Connect** 按鈕。
- **備援**：service_role key 是 JWT，payload 內含 `ref` 欄位；Project URL 固定為 `https://<ref>.supabase.co`，可從 key 反推。

### 坑 2：`.env` 空字串讓 zod 選填驗證誤爆
- **現象**：`.env.local` 中未填的選填變數寫成 `GEMINI_API_KEY=`，`--env-file` 會把它載入成**空字串 `""`（不是 undefined）**。`z.string().min(1).optional()` 因為值「存在但為空」，`.optional()` 擋不住、`min(1)` 直接報錯。
- **解法**：選填欄位用 preprocess 先把 `""` 視為未設定：
  ```ts
  function optional<T extends z.ZodTypeAny>(schema: T) {
    return z.preprocess((v) => (v === "" ? undefined : v), schema.optional());
  }
  ```
- **教訓**：分階段開發（未來變數先留空）時，這是 env 驗證的必備處理。

### 坑 3：`tsx` 把 `.ts` 當 CJS，top-level await 失敗
- **現象**：`Top-level await is currently not supported with the "cjs" output format`。因為 `package.json` 沒設 `"type": "module"`，tsx 預設把 `.ts` 當 CJS。
- **解法**：把腳本邏輯包進 `async function main()` 再呼叫，避免 top-level await（比改模組型別更穩，不受 CJS/ESM 影響）。

### 坑 4：IDE 與 CLI 對 `.ts` 副檔名匯入判定不一致
- **現象**：IDE（Next 16 注入設定）要求 import 帶 `.ts`；但 CLI `tsc` 與 `next build`（讀磁碟上的 tsconfig）反而報 `allowImportingTsExtensions` 未啟用。兩邊各要一種寫法。
- **解法**：在 `tsconfig.json` 顯式加 `"allowImportingTsExtensions": true`（有 `noEmit: true` 前提下合法），三邊（IDE / tsc / build）判定一致，統一用 `.ts` 寫法。

### 坑 5：pnpm 11 阻擋 native build script
- **現象**：安裝 `sharp` / `unrs-resolver` / `esbuild`（tsx 依賴）時出現 `ERR_PNPM_IGNORED_BUILDS`。pnpm 11 預設不執行套件的 build script。
- **解法**：在 `pnpm-workspace.yaml` 用 `allowBuilds` 白名單放行：
  ```yaml
  allowBuilds:
    esbuild: true
    sharp: true
    unrs-resolver: true
  ```
  注意：pnpm 11 的設定家已從 `package.json` 的 `pnpm` 欄位移到 `pnpm-workspace.yaml`。

### 坑 6：`create-next-app` 拒絕大寫專案名
- **現象**：目錄名 `BizMate` 含大寫，`create-next-app` 因 npm 命名限制中止。
- **解法**：在暫存目錄用小寫名 `bizmate` 建立，再把產物搬進專案根，`package.json` 的 `name` 維持小寫。

### 坑 7：supabase-js 泛型表名下型別無法 narrow（Repository 實作時遇到）
- **現象**：想寫一個泛型 `BaseRepository<T extends TableName>` 統一 CRUD，但 `client.from(this.table)` 的 `this.table` 是泛型 `T` 時，supabase-js 高度條件式的表格型別會失效——`.eq("id", id)` 報 `"id"` 不可指派、`.select()` 結果推不出正確 Row 型別（一堆 `SelectQueryError`）。
- **解法**：基底內部改用**未參數化的 client 視圖**操作，型別安全改由**對外方法簽章**保證：
  ```ts
  // 內部：未參數化 client（借用 library 預設泛型，非 any）
  private get raw(): SupabaseClient {
    return this.client as unknown as SupabaseClient;
  }
  // 對外：仍完全型別安全
  async findById(id: string): Promise<Tables<T> | null> {
    const { data, error } = await this.raw.from(this.table).select("*").eq("id", id).maybeSingle();
    if (error) throw new RepositoryError(this.table, "findById", error.message);
    return (data as Tables<T> | null) ?? null;
  }
  ```
- **教訓**：泛型包裝 supabase-js 時，把「型別 narrow 失效」侷限在基底內部一個 `raw` getter，呼叫端維持強型別，避免 `any` 外溢。

### 坑 8（正向確認）：tsx 能解析 `@/` 別名
- **背景**：驗證腳本（`scripts/*.ts`）用 tsx 執行，原本擔心 tsx 不解析 tsconfig 的 `paths`（`@/*` → `./src/*`），得改用相對路徑。
- **實測**：tsx v4 會讀 tsconfig 並解析 `@/` 別名，腳本可直接 `import ... from "@/..."`，不需相對路徑。程式碼內外一致用 `@/` 即可。

---

## 6. Repository 層（資料存取抽象，任務 2.4）

在 client 之上封裝 Repository Pattern，業務邏輯只依賴抽象、不散落 supabase-js 呼叫。

| 檔案 | 職責 |
|---|---|
| `src/lib/supabase/database.types.ts` | 手寫 12 張表的 Row/Insert/Update 型別（對應 0001_init.sql，enum 從 `shared/types` 複用），符合 supabase-js `Database` 泛型形狀 → 型別安全查詢 |
| `src/lib/supabase/client.ts` | 伺服器端 `service_role` 單例（`persistSession:false`），繞過 RLS、不進客戶端 bundle |
| `src/lib/supabase/repository.ts` | 泛型 `BaseRepository`（`findAll/findById/create/update/delete`）+ `RepositoryError`（帶表名/操作/原始訊息） |
| `src/domains/.../repositories/*.ts` | 具體 repository，繼承泛型基底並加領域專屬查詢（如 `sessionsRepository.findByStatus`） |

**設計前提**：12 張表都有 UUID 主鍵 `id`，故 by-id 操作對全表通用。

**驗證**：`pnpm verify:repo` 對真實 DB 跑一輪完整 CRUD（create→findById→update→findByStatus→delete），`try/finally` 保證測試資料一定清除。手寫型別的好處是 schema 已固定、離線可靠；代價是 schema 變更時要與 `0001_init.sql` 同步更新。

---

## 7. 重建環境的最短路徑

```bash
# 1. 安裝依賴
pnpm install

# 2. 建立 .env.local（複製範本後填入 Supabase 兩項金鑰）
cp .env.example .env.local
#    編輯 .env.local，填 SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY

# 3. 在 Supabase SQL Editor 執行 supabase/migrations/0001_init.sql

# 4. 驗證連線與 schema
pnpm db:verify     # 應輸出 12/12 張表可存取

# 5. 驗證 Repository 層（真實 DB CRUD，會自動清理測試資料）
pnpm verify:repo   # 應輸出 Repository 層驗收通過
```

---

*本文件記錄實作事實，與 PRD/SRS/SAD/SDS 的規格文件互補。環境或流程變更時請同步更新。*

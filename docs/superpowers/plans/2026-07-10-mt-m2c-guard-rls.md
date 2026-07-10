# MT-M2c requireMerchant + RLS + Dashboard 骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or the Execute Plan phase of superpowers:sunnydata-design to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `requireMerchant` 守門工具、RLS owner policies（防禦縱深）、`/dashboard` 骨架（待審數 + 分享連結），並用自動化腳本驗證 RLS 隔離確實有效。

**Architecture:** RLS 是第二道防線，主要保證仍是應用層 `requireMerchant`（service_role 查詢，延續 5.1-5.3 既有模式）；migration 0003 需 `CREATE POLICY` 與 `GRANT SELECT` 同時到位（0001 只 GRANT 給 service_role，`authenticated` 角色目前無任何表級權限）；`verify-auth.ts` 用 admin API 建兩個獨立測試商家，以其一的真實 JWT + anon key 直查資料表證明隔離生效。

**Tech Stack:** Next.js 16、vitest、Supabase（RLS + Postgres GRANT）。

**Spec 依據：** `docs/superpowers/specs/2026-07-10-mt-m2c-guard-rls-design.md`

**執行限制：** migration 0003 需人工於 Supabase SQL Editor 執行（同 0001、0002 慣例，本專案無自動化 migration runner、無 `psql`/DATABASE_URL 可用）。Task 1 產出 SQL 檔後，會停下請你手動執行，再繼續後續依賴它的任務（Task 6 的 `verify-auth.ts` 需要 policy 已生效才能通過）。

---

### Task 1: migration 0003 — RLS owner policies + GRANT

**Files:**
- Create: `supabase/migrations/0003_owner_policies.sql`

- [ ] **Step 1: 建立檔案**

```sql
-- ── RLS owner policies：防禦縱深（第二道防線）─────────────────────
-- 主要保證仍是應用層 requireMerchant + service_role（見 5.4 spec）。
-- 這裡加的 policy 防的是「繞過我們的 Next.js app、直接用 anon key +
-- 使用者自己的 JWT 打 Supabase 公開 REST API」的情境。
--
-- 關鍵細節：0001_init.sql 只 GRANT 給 service_role，authenticated
-- 角色目前無任何表級權限。CREATE POLICY 與 GRANT 缺一都會查無資料，
-- 本檔兩者同時處理。只開 SELECT——寫入仍全部走 service_role，不擴大
-- 攻擊面。
--
-- 範圍：merchants / rate_card_base / rate_card_modifiers / quotes /
-- sessions 五張表。raw_inputs / extracted_fields / clarification_turns /
-- price_line_items 經 session_id 間接歸屬，計畫文件範圍本就不含，
-- 深層 join policy 留待真正需要時再做。

BEGIN;

CREATE POLICY merchants_owner_select ON merchants
  FOR SELECT TO authenticated
  USING (auth.uid() = id);
GRANT SELECT ON merchants TO authenticated;

CREATE POLICY rate_card_base_owner_select ON rate_card_base
  FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);
GRANT SELECT ON rate_card_base TO authenticated;

CREATE POLICY rate_card_modifiers_owner_select ON rate_card_modifiers
  FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);
GRANT SELECT ON rate_card_modifiers TO authenticated;

CREATE POLICY quotes_owner_select ON quotes
  FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);
GRANT SELECT ON quotes TO authenticated;

CREATE POLICY sessions_owner_select ON sessions
  FOR SELECT TO authenticated
  USING (auth.uid() = merchant_id);
GRANT SELECT ON sessions TO authenticated;

COMMIT;
```

- [ ] **Step 2: 人工執行（暫停等待確認）**

貼到 Supabase Dashboard → SQL Editor → Run（同 0001、0002 慣例）。執行成功後回覆確認，才繼續 Task 6（`verify-auth.ts` 依賴此 migration 已生效）。Task 2-5 不依賴此步驟，可以先做。

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_owner_policies.sql
git commit -m "feat(auth): 新增 RLS owner policies（防禦縱深，需人工於 SQL Editor 執行）"
```

---

### Task 2: requireMerchant（TDD）

**Files:**
- Create: `src/lib/auth/requireMerchant.ts`
- Test: `src/lib/auth/requireMerchant.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/serverClient.ts", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock("@/domains/merchant/repositories/merchantsRepository.ts", () => ({
  merchantsRepository: { findById: vi.fn() },
}));

import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { requireMerchant } from "./requireMerchant.ts";

const mockFindById = vi.mocked(merchantsRepository.findById);

const MERCHANT: Tables<"merchants"> = {
  id: "u1",
  display_name: "測試商家",
  public_slug: "test123",
  contact_email: "test@example.com",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireMerchant", () => {
  it("未登入 → 401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await requireMerchant();

    expect(result).toEqual({ ok: false, status: 401 });
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("已登入但無 merchant → 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFindById.mockResolvedValue(null);

    const result = await requireMerchant();

    expect(result).toEqual({ ok: false, status: 403 });
  });

  it("已登入且有 merchant → 回傳 merchantId", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFindById.mockResolvedValue(MERCHANT);

    const result = await requireMerchant();

    expect(result).toEqual({ ok: true, merchantId: "u1" });
  });

  it("Supabase 呼叫例外時 fail closed → 401", async () => {
    mockGetUser.mockRejectedValue(new Error("network error"));

    const result = await requireMerchant();

    expect(result).toEqual({ ok: false, status: 401 });
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/lib/auth/requireMerchant.test.ts`
Expected: FAIL（找不到模組）

- [ ] **Step 3: 寫最小實作**

```ts
import { createClient } from "@/lib/supabase/serverClient.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";

export type RequireMerchantResult =
  | { ok: true; merchantId: string }
  | { ok: false; status: 401 | 403 };

/**
 * dashboard API 第一行呼叫的守門工具：cookie → auth.uid() → merchant 查詢。
 * 這是租戶隔離的主要保證（RLS policy 是第二道防線，見 5.4 spec）。
 * Supabase 呼叫例外一律 fail closed（401），不可 fail open。
 */
export async function requireMerchant(): Promise<RequireMerchantResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user === null) {
      return { ok: false, status: 401 };
    }

    const merchant = await merchantsRepository.findById(user.id);
    if (merchant === null) {
      return { ok: false, status: 403 };
    }

    return { ok: true, merchantId: user.id };
  } catch {
    return { ok: false, status: 401 };
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/lib/auth/requireMerchant.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/requireMerchant.ts src/lib/auth/requireMerchant.test.ts
git commit -m "feat(auth): 新增 requireMerchant 守門工具（dashboard API 用）"
```

---

### Task 3: quotesRepository.countByStatus

**Files:**
- Modify: `src/domains/pricing/repositories/quotesRepository.ts`

沿用既有 `countByCodePrefix` 寫法與慣例（該方法無獨立測試，此方法比照辦理，行為由 Task 4 的 dashboard 頁面手動驗證涵蓋）。

- [ ] **Step 1: 修改檔案**

```ts
import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { QuoteStatus } from "@/shared/types/domain.types";

/**
 * quotes 表 repository。繼承標準 CRUD（create 用於報價寫入），
 * 額外提供 quote_code 流水號所需的前綴計數。
 */
export class QuotesRepository extends BaseRepository<"quotes"> {
  constructor() {
    super("quotes");
  }

  /**
   * 計算該商家 quote_code 以指定前綴（如 "G-2607"）開頭的既有筆數，
   * 作為當月當類型的流水號基數。流水號範圍是「商家」——
   * 唯一性最終由 DB 的 UNIQUE (merchant_id, quote_code) 兜底。
   */
  async countByCodePrefix(merchantId: string, prefix: string): Promise<number> {
    const { count, error } = await this.client
      .from("quotes")
      .select("*", { count: "exact", head: true })
      .eq("merchant_id", merchantId)
      .like("quote_code", `${prefix}%`);
    if (error) {
      throw new RepositoryError("quotes", "countByCodePrefix", error.message);
    }
    return count ?? 0;
  }

  /** 計算該商家指定狀態的報價筆數（/dashboard 待審數用）。 */
  async countByStatus(merchantId: string, status: QuoteStatus): Promise<number> {
    const { count, error } = await this.client
      .from("quotes")
      .select("*", { count: "exact", head: true })
      .eq("merchant_id", merchantId)
      .eq("status", status);
    if (error) {
      throw new RepositoryError("quotes", "countByStatus", error.message);
    }
    return count ?? 0;
  }
}

export const quotesRepository = new QuotesRepository();
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無新增錯誤

- [ ] **Step 3: Commit**

```bash
git add src/domains/pricing/repositories/quotesRepository.ts
git commit -m "feat(dashboard): quotesRepository 新增 countByStatus"
```

---

### Task 4: /dashboard 骨架

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Create: `src/app/dashboard/CopyLinkButton.tsx`

UI 依專案慣例不寫 vitest 單元測試，留待 Task 7 手動瀏覽器驗證。

- [ ] **Step 1: 建立複製按鈕（Client Component）**

```tsx
"use client";

import { useState } from "react";

export function CopyLinkButton({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/q/${slug}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded border px-4 py-2 text-sm"
    >
      {copied ? "已複製！" : `複製分享連結 /q/${slug}`}
    </button>
  );
}
```

- [ ] **Step 2: 整檔取代 page.tsx**

```tsx
import { logoutAction } from "./actions.ts";
import { CopyLinkButton } from "./CopyLinkButton.tsx";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { quotesRepository } from "@/domains/pricing/repositories/quotesRepository.ts";

export default async function DashboardPage() {
  const auth = await requireMerchant();

  if (!auth.ok) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-red-600">
          {auth.status === 401 ? "請先登入" : "查無商家資料，請先完成 onboarding"}
        </p>
      </main>
    );
  }

  const [merchant, pendingCount] = await Promise.all([
    merchantsRepository.findById(auth.merchantId),
    quotesRepository.countByStatus(auth.merchantId, "awaiting_review"),
  ]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-gray-600">待審報價：{pendingCount} 筆</p>
      {merchant !== null && <CopyLinkButton slug={merchant.public_slug} />}
      <form action={logoutAction}>
        <button type="submit" className="rounded border px-4 py-2">
          登出
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無新增錯誤

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.tsx src/app/dashboard/CopyLinkButton.tsx
git commit -m "feat(dashboard): /dashboard 骨架（requireMerchant + 待審數 + 分享連結複製）"
```

---

### Task 5: verify-auth.ts

**Files:**
- Create: `scripts/verify-auth.ts`
- Modify: `package.json`

比照 `scripts/verify-repo.ts`、`scripts/dev-merchant.ts` 的既有風格（`assert()` helper、try/finally 清理、`main().catch()` 結尾）。

- [ ] **Step 1: 建立腳本**

```ts
/**
 * 驗證 RLS owner policy 是否生效（任務 5.4 驗收）。
 * 執行：pnpm verify:auth
 *
 * 建兩個獨立測試商家 A、B，各自建立 rate_card_base 資料；
 * 用 A 的真實 JWT + anon key（非 service_role）直查 rate_card_base，
 * 證明只回 A 的列、查不到 B 的列——這是 RLS 第二道防線的直接證據。
 * 結束時無論成敗都清理兩個測試帳號（try/finally）。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env.ts";
import type { Database } from "@/lib/supabase/database.types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`驗證失敗：${message}`);
  }
}

type TestMerchant = { userId: string; email: string; password: string };

const admin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function createTestMerchant(label: string): Promise<TestMerchant> {
  const email = `verify-auth-${label}-${Date.now()}@bizmate-test.local`;
  const password = "VerifyAuthTest123";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`建立測試商家 ${label} 失敗：${error?.message}`);
  }

  const { error: merchantError } = await admin.from("merchants").insert({
    id: data.user.id,
    display_name: `驗證商家 ${label}`,
    public_slug: `verify-auth-${label}-${Date.now()}`,
    contact_email: email,
  });
  if (merchantError) {
    throw new Error(`建立商家列 ${label} 失敗：${merchantError.message}`);
  }

  const { error: rateCardError } = await admin.from("rate_card_base").insert({
    merchant_id: data.user.id,
    category: "illustration",
    subtype: "verify-auth-subtype",
    unit: "件",
    base_price: 1000,
  });
  if (rateCardError) {
    throw new Error(`建立價目表 ${label} 失敗：${rateCardError.message}`);
  }

  return { userId: data.user.id, email, password };
}

async function cleanupTestMerchant(merchant: TestMerchant): Promise<void> {
  await admin.auth.admin.deleteUser(merchant.userId).catch(() => {
    console.error(
      `⚠️ 清理測試商家失敗，請至 Supabase Studio 手動刪除 ${merchant.userId}`,
    );
  });
}

async function main(): Promise<void> {
  let merchantA: TestMerchant | null = null;
  let merchantB: TestMerchant | null = null;

  try {
    merchantA = await createTestMerchant("a");
    merchantB = await createTestMerchant("b");
    console.log("✅ 建立測試商家 A、B 完成");

    const anon = createClient<Database>(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    const { data: signInData, error: signInError } =
      await anon.auth.signInWithPassword({
        email: merchantA.email,
        password: merchantA.password,
      });
    if (signInError || !signInData.session) {
      throw new Error(`商家 A 登入失敗：${signInError?.message}`);
    }
    console.log("✅ 商家 A 登入取得 JWT");

    const { data: rows, error: queryError } = await anon
      .from("rate_card_base")
      .select("*");
    if (queryError) {
      throw new Error(`直查 rate_card_base 失敗：${queryError.message}`);
    }

    assert(rows !== null && rows.length > 0, "應查到至少一列（商家 A 自己的資料）");
    assert(
      rows!.every((row) => row.merchant_id === merchantA!.userId),
      "查到的列必須全部屬於商家 A，不可含商家 B 的資料",
    );
    assert(
      !rows!.some((row) => row.merchant_id === merchantB!.userId),
      "不可查到商家 B 的列（RLS 隔離失效）",
    );
    console.log(`✅ RLS 隔離驗證通過：只查到商家 A 自己的 ${rows!.length} 列`);

    console.log("\n🎉 RLS owner policy 驗收通過（第二道防線有效）。");
  } finally {
    if (merchantA) await cleanupTestMerchant(merchantA);
    if (merchantB) await cleanupTestMerchant(merchantB);
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
```

- [ ] **Step 2: 新增 package.json script**

在 `package.json` 的 `scripts` 區塊、`"verify:answer"` 那行之後加入：

```json
    "verify:answer": "tsx --env-file=.env.local scripts/verify-answer.ts",
    "verify:auth": "tsx --env-file=.env.local scripts/verify-auth.ts",
```

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-auth.ts package.json
git commit -m "feat(auth): 新增 verify-auth.ts 自動化驗證 RLS 隔離"
```

---

### Task 6: 執行 verify-auth.ts（需 Task 1 migration 已套用）

**Files:** 無新檔案，純驗證步驟。

- [ ] **Step 1: 確認 migration 0003 已於 Supabase SQL Editor 執行成功**

若尚未執行，停下請使用者確認後再繼續。

- [ ] **Step 2: 執行驗證腳本**

Run: `pnpm verify:auth`
Expected: 輸出 `✅ 建立測試商家 A、B 完成`、`✅ 商家 A 登入取得 JWT`、`✅ RLS 隔離驗證通過：只查到商家 A 自己的 1 列`、`🎉 RLS owner policy 驗收通過`

若失敗且錯誤訊息顯示查到 0 列或權限錯誤，最可能原因是 migration 0003 的 GRANT 或 POLICY 未正確套用，回 Task 1 檢查。

- [ ] **Step 3: 執行既有 db:verify 確認未破壞既有表存取**

Run: `pnpm db:verify`
Expected: 14/14 張表可存取（同既有基準）

---

### Task 7: 全量驗證

**Files:** 無新檔案，純驗證步驟。

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: 無錯誤

- [ ] **Step 2: 型別檢查 + build**

Run: `npx next build`
Expected: build 成功

- [ ] **Step 3: 全量測試**

Run: `npx vitest run`
Expected: 全數通過（既有 257 + 本次新增 4 = 261）

- [ ] **Step 4: 手動瀏覽器驗證**

Run: `npx next dev`

依序驗證（用 Supabase Admin API 建一個已 onboarding 的測試帳號，比照 5.2/5.3 的驗證方式）：
1. 登入已有 merchant 的帳號 → `/dashboard` 顯示「待審報價：0 筆」+「複製分享連結 /q/{slug}」按鈕
2. 點擊複製按鈕 → 按鈕文字短暫變成「已複製！」，貼上剪貼簿內容確認是完整 `/q/{slug}` URL
3. 直接用 curl 或無痕視窗訪問 `/dashboard`（未登入）→ 仍應被 middleware 擋在 `/login`（`requireMerchant` 的 401 分支理論上不會被使用者實際看到，因為 middleware 已先擋，此為防禦性程式碼）

- [ ] **Step 5: Commit（若驗證階段有修正）**

僅在 Step 1-4 發現問題並修正時才需要；若全數綠燈則跳過。

---

## 完成後

依 `git-workflow.md`：任務全數完成、驗證通過後，載入 sunnydata-branch-lifecycle skill 收尾（merge/PR/清理分支）；並更新 `.claude/taskmaster-data/wbs.md` 的 5.4 狀態為 ✅ 完成，MT-M2 里程碑標記完成，5.5 標記為下一個。

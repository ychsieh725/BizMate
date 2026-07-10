# MT-M3：服務項目管理（services CRUD API + UI） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or the Execute Plan phase of superpowers:sunnydata-design to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓商家能在 dashboard 自行管理 `rate_card_base`（新增/inline 編輯/軟刪除），`rate_card_modifiers` 唯讀顯示；停售項目不再參與計價。

**Architecture:** 沿用既有 `requireMerchant` 守門 + `route → domain repository` 薄分層慣例。新增 `servicesRepository`（dashboard CRUD 用）與既有唯讀 `rateCardRepository`（pricing 用）分開職責。軟刪除透過新增 `is_active` 欄位實現（`price_line_items.rule_id` 對 `rate_card_base` 的 FK 是 `NO ACTION`，真實 DELETE 會被擋下）。

**Tech Stack:** Next.js 16 Route Handlers、Supabase（service_role repository + RLS 防禦縱深）、zod、vitest、React 19 Client Components。

**對應 spec：** `docs/superpowers/specs/2026-07-10-mt-m3-services-design.md`

**測試基準：** 執行 Task 1 前 `pnpm test` 為 27 個檔案、261 個測試全過。本計畫預期新增 31 個測試（servicesSchemas 15 + services route 7 + services/[id] route 9），完成後預期 292 個測試全過（以 Task 9 實際執行輸出為準）。

---

### Task 1：Migration 0004 + database.types.ts + rateCardRepository 停售過濾

**Files:**
- Create: `supabase/migrations/0004_rate_card_soft_delete.sql`
- Modify: `src/lib/supabase/database.types.ts:167-196`（`rate_card_base` Row/Insert/Update 加 `is_active`）
- Modify: `src/domains/pricing/repositories/rateCardRepository.ts:16-32`（`findBase` 加 `.eq("is_active", true)`）

- [ ] **Step 1：寫 migration**

```sql
-- ── rate_card_base 軟刪除欄位 ──────────────────────────────────
-- price_line_items.rule_id REFERENCES rate_card_base(id) 未指定 ON DELETE，
-- 預設 NO ACTION：真實 DELETE 一列已被歷史報價引用過的 rate_card_base
-- 會被資料庫擋下（外鍵違反）。改用 is_active 標記表示「已停售」，
-- 既有引用完整保留，計價查詢另加 is_active = true 過濾排除停售項目。

BEGIN;

ALTER TABLE rate_card_base
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

COMMIT;
```

- [ ] **Step 2：請使用者於 Supabase Dashboard → SQL Editor 執行此 migration**

沿用 0001/0002/0003 慣例，人工於 SQL Editor 貼上執行。執行後回報「已執行」才繼續下一步（本任務所有依賴真實 DB 的驗證都建立在這張欄位存在之上）。

- [ ] **Step 3：更新 `database.types.ts` 的 `rate_card_base` 型別**

修改 `src/lib/supabase/database.types.ts:167-196`，三個區塊都加 `is_active`：

```typescript
      rate_card_base: {
        Row: {
          id: string;
          merchant_id: string;
          category: CaseCategory;
          subtype: string;
          unit: string;
          base_price: number | null;
          includes: string | null;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          merchant_id: string;
          category: CaseCategory;
          subtype: string;
          unit: string;
          base_price?: number | null;
          includes?: string | null;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          merchant_id?: string;
          category?: CaseCategory;
          subtype?: string;
          unit?: string;
          base_price?: number | null;
          includes?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
```

- [ ] **Step 4：`rateCardRepository.findBase` 加 `is_active` 過濾**

修改 `src/domains/pricing/repositories/rateCardRepository.ts:21-27`：

```typescript
    const { data, error } = await this.client
      .from("rate_card_base")
      .select("*")
      .eq("merchant_id", merchantId)
      .eq("category", category)
      .eq("subtype", subtype)
      .eq("is_active", true)
      .maybeSingle();
```

- [ ] **Step 5：執行既有測試，確認 basePricing.test.ts 無需改動仍全過（runtime 行為層面）**

Run: `pnpm test -- basePricing`
Expected: PASS（8 個測試，mock 在 `rateCardRepository.findBase` 函式層級，`.eq` 呼叫鏈的實作細節不影響 mock 呼叫）

- [ ] **Step 5.5：修正 `basePricing.test.ts` 的 `baseRow()` 工廠函式（型別層面的必要連帶修改）**

`is_active` 變成 Row 型別的必填欄位後，`basePricing.test.ts:19-30` 的 `baseRow()` 直接建構完整 `Tables<"rate_card_base">` 物件字面值，會被 tsc 檢查出缺少該欄位（TS2322）。這不是行為變更，純粹補齊型別欄位：

修改 `src/domains/pricing/basePricing.test.ts` 的 `baseRow()` 預設物件（第 19-30 行附近），加入 `is_active: true`：

```typescript
function baseRow(overrides: Partial<Tables<"rate_card_base">> = {}): Tables<"rate_card_base"> {
  return {
    id: "base-1",
    merchant_id: MERCHANT_ID,
    category: "illustration",
    subtype: "角色設計",
    unit: "每角色",
    base_price: 6000,
    includes: null,
    is_active: true,
    ...overrides,
  };
}
```

- [ ] **Step 6：型別檢查 + 全量測試**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: 型別檢查通過；261 個既有測試全過

- [ ] **Step 7：Commit**

```bash
git add supabase/migrations/0004_rate_card_soft_delete.sql src/lib/supabase/database.types.ts src/domains/pricing/repositories/rateCardRepository.ts src/domains/pricing/basePricing.test.ts
git commit -m "feat(pricing): rate_card_base 加 is_active 軟刪除欄位

為什麼：商家需要能下架服務項目，但 price_line_items.rule_id 對
rate_card_base 的外鍵是 NO ACTION，真實 DELETE 一個已被歷史報價
引用過的列會被資料庫擋下。

做了什麼：新增 migration 0004 加 is_active BOOLEAN DEFAULT true；
更新對應型別；rateCardRepository.findBase 加 is_active=true 過濾，
確保停售項目不再被計價引用。

影響：basePricing.ts 的計價查詢行為改變（停售項目視同查無 subtype，
走既有 outOfScope 分支），既有測試 mock 在函式層級不受影響。"
```

---

### Task 2：servicesSchemas.ts（TDD）

**Files:**
- Create: `src/domains/pricing/servicesSchemas.ts`
- Test: `src/domains/pricing/servicesSchemas.test.ts`

- [ ] **Step 1：寫失敗測試**

```typescript
import { describe, it, expect } from "vitest";
import {
  createServiceBodySchema,
  updateServiceBodySchema,
  serviceIdSchema,
} from "./servicesSchemas.ts";

describe("createServiceBodySchema", () => {
  it("合法 body 通過", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 6000,
      includes: "3款初稿",
    });
    expect(result.success).toBe(true);
  });

  it("category 不在列舉值 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "not_a_category",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 6000,
    });
    expect(result.success).toBe(false);
  });

  it("subtype 空字串 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "",
      unit: "每角色",
      base_price: 6000,
    });
    expect(result.success).toBe(false);
  });

  it("unit 空字串 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "",
      base_price: 6000,
    });
    expect(result.success).toBe(false);
  });

  it("base_price 缺漏 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
    });
    expect(result.success).toBe(false);
  });

  it("base_price 為 0 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 0,
    });
    expect(result.success).toBe(false);
  });

  it("base_price 為負數 → 失敗", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: -100,
    });
    expect(result.success).toBe(false);
  });

  it("includes 缺漏（選填）→ 通過", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 6000,
    });
    expect(result.success).toBe(true);
  });

  it("includes 為 null → 通過", () => {
    const result = createServiceBodySchema.safeParse({
      category: "illustration",
      subtype: "角色設計",
      unit: "每角色",
      base_price: 6000,
      includes: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateServiceBodySchema", () => {
  it("僅 base_price → 通過", () => {
    const result = updateServiceBodySchema.safeParse({ base_price: 7000 });
    expect(result.success).toBe(true);
  });

  it("空物件（全部省略）→ 通過", () => {
    const result = updateServiceBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("base_price 為負數 → 失敗", () => {
    const result = updateServiceBodySchema.safeParse({ base_price: -1 });
    expect(result.success).toBe(false);
  });

  it("unit 空字串 → 失敗", () => {
    const result = updateServiceBodySchema.safeParse({ unit: "" });
    expect(result.success).toBe(false);
  });
});

describe("serviceIdSchema", () => {
  it("合法 UUID → 通過", () => {
    expect(
      serviceIdSchema.safeParse("99999999-9999-9999-9999-999999999999")
        .success,
    ).toBe(true);
  });

  it("非 UUID → 失敗", () => {
    expect(serviceIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test -- servicesSchemas`
Expected: FAIL（`servicesSchemas.ts` 不存在）

- [ ] **Step 3：寫最小實作**

```typescript
import { z } from "zod";
import type { CaseCategory } from "@/shared/types/domain.types";
import { CASE_CATEGORIES } from "@/shared/constants/categories.ts";

const CATEGORY_VALUES = CASE_CATEGORIES as readonly [
  CaseCategory,
  ...CaseCategory[],
];

/** POST /api/dashboard/services 主體：新增一筆商家自有的基礎費率列。 */
export const createServiceBodySchema = z.object({
  category: z.enum(CATEGORY_VALUES),
  subtype: z.string().min(1, "子類型不可為空"),
  unit: z.string().min(1, "單位不可為空"),
  base_price: z.number().positive("基礎價格須為正數"),
  includes: z.string().nullable().optional(),
});
export type CreateServiceBody = z.infer<typeof createServiceBodySchema>;

/**
 * PATCH /api/dashboard/services/{id} 主體：只開放 base_price/includes/unit。
 * category/subtype 不可改（UNIQUE (merchant_id, category, subtype) 且被
 * rateCardRepository.findBase 直接引用查詢，改了會影響既有報價可追溯性）。
 */
export const updateServiceBodySchema = z.object({
  base_price: z.number().positive("基礎價格須為正數").optional(),
  includes: z.string().nullable().optional(),
  unit: z.string().min(1, "單位不可為空").optional(),
});
export type UpdateServiceBody = z.infer<typeof updateServiceBodySchema>;

/** 服務項目 id 路徑參數：必須是合法 UUID（DB 主鍵格式）。 */
export const serviceIdSchema = z.string().uuid();
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test -- servicesSchemas`
Expected: PASS（15 個測試）

- [ ] **Step 4.5：修正發現的問題——`serviceIdSchema` 改回嚴格 `.uuid()`，測試 fixture 改用合規 UUID**

執行過程中發現：本 repo 是 zod 4.4.3，`.uuid()` 會嚴格檢查 version/variant bits。既有慣例 `sessionIdSchema`（`src/domains/intake/sessionSchemas.ts:21`）用的正是嚴格 `.uuid()`，其測試 fixture 用真正合規的 UUID `550e8400-e29b-41d4-a716-446655440000`（見 `src/app/api/sessions/[id]/status/route.test.ts:11`）。上面 Step 1/3 若直接照抄用 `99999999-9999-9999-9999-999999999999`（version nibble=9，不合規）當「合法 UUID」測試值，會與嚴格 `.uuid()` 矛盾。

**修正（非放寬驗證）：** `serviceIdSchema` 維持 `z.string().uuid()`（與 `sessionIdSchema` 一致，不要改成 `.guid()`），把 Step 1 測試中「合法 UUID → 通過」案例的字串改成 `550e8400-e29b-41d4-a716-446655440000`。

同樣道理適用於 **Task 5** 的 `[id]/route.test.ts`：該檔案的 `ITEM_ID`/`OTHER_MERCHANT_ID` 常數會真的流經 route handler 內未 mock 的 `serviceIdSchema.safeParse(id)`，若沿用 `77777777-.../88888888-...` 這類重複數字 fixture 會被嚴格 `.uuid()` 擋下，導致「更新成功 → 200」等案例誤回 400。撰寫 Task 5 時，`ITEM_ID`/`OTHER_MERCHANT_ID` 也必須改用合規 UUID，例如 `ITEM_ID = "550e8400-e29b-41d4-a716-446655440000"`、`OTHER_MERCHANT_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8"`（`MERCHANT_ID` 本身不流經任何 zod `.uuid()` 檢查，維持原本的 `99999999-...` 不受影響）。

- [ ] **Step 5：Commit**

```bash
git add src/domains/pricing/servicesSchemas.ts src/domains/pricing/servicesSchemas.test.ts
git commit -m "feat(pricing): services API 的 zod 邊界驗證 schema

為什麼：POST/PATCH /api/dashboard/services 需要在系統邊界驗證輸入
（coding-style「在系統邊界驗證」），category 清單要與 CASE_CATEGORIES
單一事實來源一致，不重複列舉。

做了什麼：createServiceBodySchema（新增）、updateServiceBodySchema
（只開放 base_price/includes/unit，category/subtype 不可改）、
serviceIdSchema（UUID 路徑參數）。

影響：無，純新增檔案。"
```

---

### Task 3：servicesRepository.ts

**Files:**
- Create: `src/domains/pricing/repositories/servicesRepository.ts`

（依專案既有慣例，repository 不另開單元測試——`rateCardRepository.ts`/`quotesRepository.ts` 皆同，行為由後續 route 測試 mock 驗證 + Task 8 對真實 DB 的驗證涵蓋。）

- [ ] **Step 1：實作**

```typescript
import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

/**
 * rate_card_base 的 dashboard CRUD repository（5.5）。
 * 與既有唯讀 rateCardRepository（pricing 查表用）分開——「計價查詢」
 * 與「後台管理」是不同關注點，各自單一職責。
 * create/update/findById 繼承 BaseRepository 標準 CRUD。
 */
export class ServicesRepository extends BaseRepository<"rate_card_base"> {
  constructor() {
    super("rate_card_base");
  }

  /** 該商家所有服務項目，含已停售（is_active=false）——後台列表要能檢視。 */
  async findAllByMerchant(
    merchantId: string,
  ): Promise<Tables<"rate_card_base">[]> {
    const { data, error } = await this.client
      .from("rate_card_base")
      .select("*")
      .eq("merchant_id", merchantId)
      .order("category", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "rate_card_base",
        "findAllByMerchant",
        error.message,
      );
    }
    return data ?? [];
  }

  /** 該商家所有加成規則（唯讀顯示用，不分 category）。 */
  async findModifiersByMerchant(
    merchantId: string,
  ): Promise<Tables<"rate_card_modifiers">[]> {
    const { data, error } = await this.client
      .from("rate_card_modifiers")
      .select("*")
      .eq("merchant_id", merchantId);
    if (error) {
      throw new RepositoryError(
        "rate_card_modifiers",
        "findModifiersByMerchant",
        error.message,
      );
    }
    return data ?? [];
  }
}

export const servicesRepository = new ServicesRepository();
```

- [ ] **Step 2：型別檢查**

Run: `pnpm exec tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 3：Commit**

```bash
git add src/domains/pricing/repositories/servicesRepository.ts
git commit -m "feat(pricing): 新增 servicesRepository（dashboard CRUD 用）

為什麼：既有 rateCardRepository 是唯讀查表用（pricing 計價），混入
CRUD 會讓一個 repository 承擔兩種不同關注點。

做了什麼：ServicesRepository 繼承 BaseRepository<rate_card_base>
取得 create/update/findById，額外加 findAllByMerchant（含已停售）、
findModifiersByMerchant（唯讀顯示用）。

影響：無，純新增檔案，不影響既有 rateCardRepository 呼叫方。"
```

---

### Task 4：GET/POST /api/dashboard/services（TDD）

**Files:**
- Create: `src/app/api/dashboard/services/route.ts`
- Test: `src/app/api/dashboard/services/route.test.ts`

- [ ] **Step 1：寫失敗測試**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/repositories/servicesRepository.ts", () => ({
  servicesRepository: {
    findAllByMerchant: vi.fn(),
    findModifiersByMerchant: vi.fn(),
    create: vi.fn(),
  },
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import { GET, POST } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockFindAllByMerchant = vi.mocked(servicesRepository.findAllByMerchant);
const mockFindModifiersByMerchant = vi.mocked(
  servicesRepository.findModifiersByMerchant,
);
const mockCreate = vi.mocked(servicesRepository.create);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";

const ITEM: Tables<"rate_card_base"> = {
  id: "item-1",
  merchant_id: MERCHANT_ID,
  category: "illustration",
  subtype: "角色設計",
  unit: "每角色",
  base_price: 6000,
  includes: null,
  is_active: true,
};

function postRequest(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/dashboard/services", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/services", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(mockFindAllByMerchant).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await GET();

    expect(res.status).toBe(403);
  });

  it("成功 → 回傳 items + modifiers", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockFindAllByMerchant.mockResolvedValue([ITEM]);
    mockFindModifiersByMerchant.mockResolvedValue([]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items).toEqual([ITEM]);
    expect(json.data.modifiers).toEqual([]);
  });
});

describe("POST /api/dashboard/services", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await POST(postRequest({}));

    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("body 驗證失敗 → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await POST(postRequest({ category: "illustration" }));

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("新增成功 → 201", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockCreate.mockResolvedValue(ITEM);

    const res = await POST(
      postRequest({
        category: "illustration",
        subtype: "角色設計",
        unit: "每角色",
        base_price: 6000,
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.item).toEqual(ITEM);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "illustration",
        subtype: "角色設計",
        unit: "每角色",
        base_price: 6000,
        merchant_id: MERCHANT_ID,
      }),
    );
  });

  it("UNIQUE 撞號（category+subtype 重複）→ 409", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockCreate.mockRejectedValue(
      new Error("duplicate key value violates unique constraint"),
    );

    const res = await POST(
      postRequest({
        category: "illustration",
        subtype: "角色設計",
        unit: "每角色",
        base_price: 6000,
      }),
    );

    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test -- src/app/api/dashboard/services/route.test.ts`
Expected: FAIL（`route.ts` 不存在）

- [ ] **Step 3：寫最小實作**

```typescript
import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import { createServiceBodySchema } from "@/domains/pricing/servicesSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";

/** GET /api/dashboard/services — 該商家所有服務項目（含已停售）+ 加成規則（唯讀）。 */
export async function GET(): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  try {
    const [items, modifiers] = await Promise.all([
      servicesRepository.findAllByMerchant(auth.merchantId),
      servicesRepository.findModifiersByMerchant(auth.merchantId),
    ]);
    return apiOk({ items, modifiers });
  } catch (error) {
    console.error("[GET /api/dashboard/services] 查詢失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}

/** POST /api/dashboard/services — 新增一筆服務項目（category+subtype 需未重複）。 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = createServiceBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const created = await servicesRepository.create({
      ...parsed.data,
      merchant_id: auth.merchantId,
    });
    return apiOk({ item: created }, 201);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiFail("此分類已有相同子類型", 409);
    }
    console.error("[POST /api/dashboard/services] 新增失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}

/** Postgres 23505（unique_violation）的錯誤訊息判斷；repository 只帶回訊息字串。 */
function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("duplicate key") || message.includes("23505");
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test -- src/app/api/dashboard/services/route.test.ts`
Expected: PASS（7 個測試）

- [ ] **Step 5：Commit**

```bash
git add src/app/api/dashboard/services/route.ts src/app/api/dashboard/services/route.test.ts
git commit -m "feat(dashboard): GET/POST /api/dashboard/services

為什麼：商家 onboarding 後價目表是唯讀範本複製值，需要能自行查看
與新增服務項目才能真正客製化報價。

做了什麼：GET 回傳該商家 items（含已停售）+ modifiers（唯讀顯示）；
POST 新增一筆，UNIQUE (merchant_id, category, subtype) 撞號轉 409
友善訊息（同 /api/sessions、/api/dashboard/onboarding 既有的
route+service 薄分層與 401/403/400/409/500 錯誤慣例）。

影響：無破壞性變更，純新增路由。"
```

---

### Task 5：PATCH/DELETE /api/dashboard/services/[id]（TDD）

**Files:**
- Create: `src/app/api/dashboard/services/[id]/route.ts`
- Test: `src/app/api/dashboard/services/[id]/route.test.ts`

- [ ] **Step 1：寫失敗測試**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/repositories/servicesRepository.ts", () => ({
  servicesRepository: { findById: vi.fn(), update: vi.fn() },
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import { PATCH, DELETE } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockFindById = vi.mocked(servicesRepository.findById);
const mockUpdate = vi.mocked(servicesRepository.update);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";
const OTHER_MERCHANT_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const ITEM_ID = "550e8400-e29b-41d4-a716-446655440000";

const ITEM: Tables<"rate_card_base"> = {
  id: ITEM_ID,
  merchant_id: MERCHANT_ID,
  category: "illustration",
  subtype: "角色設計",
  unit: "每角色",
  base_price: 6000,
  includes: null,
  is_active: true,
};

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/dashboard/services/${ITEM_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(): Request {
  return new Request(`http://localhost/api/dashboard/services/${ITEM_ID}`, {
    method: "DELETE",
  });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/dashboard/services/[id]", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await PATCH(patchRequest({ base_price: 7000 }), context(ITEM_ID));

    expect(res.status).toBe(401);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("id 格式不正確 → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await PATCH(patchRequest({ base_price: 7000 }), context("not-a-uuid"));

    expect(res.status).toBe(400);
  });

  it("body 驗證失敗（負數）→ 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await PATCH(patchRequest({ base_price: -100 }), context(ITEM_ID));

    expect(res.status).toBe(400);
    expect(mockFindById).not.toHaveBeenCalled();
  });

  it("找不到資源 → 404", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockFindById.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ base_price: 7000 }), context(ITEM_ID));

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("跨租戶（非本人資源）→ 404", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockFindById.mockResolvedValue({ ...ITEM, merchant_id: OTHER_MERCHANT_ID });

    const res = await PATCH(patchRequest({ base_price: 7000 }), context(ITEM_ID));

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("更新成功 → 200", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockFindById.mockResolvedValue(ITEM);
    mockUpdate.mockResolvedValue({ ...ITEM, base_price: 7000 });

    const res = await PATCH(patchRequest({ base_price: 7000 }), context(ITEM_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.item.base_price).toBe(7000);
    expect(mockUpdate).toHaveBeenCalledWith(ITEM_ID, { base_price: 7000 });
  });
});

describe("DELETE /api/dashboard/services/[id]", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await DELETE(deleteRequest(), context(ITEM_ID));

    expect(res.status).toBe(401);
  });

  it("跨租戶（非本人資源）→ 404", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockFindById.mockResolvedValue({ ...ITEM, merchant_id: OTHER_MERCHANT_ID });

    const res = await DELETE(deleteRequest(), context(ITEM_ID));

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("軟刪除成功 → 200，is_active=false", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockFindById.mockResolvedValue(ITEM);
    mockUpdate.mockResolvedValue({ ...ITEM, is_active: false });

    const res = await DELETE(deleteRequest(), context(ITEM_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.item.is_active).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith(ITEM_ID, { is_active: false });
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test -- "src/app/api/dashboard/services/\[id\]/route.test.ts"`
Expected: FAIL（`route.ts` 不存在）

- [ ] **Step 3：寫最小實作**

```typescript
import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import {
  serviceIdSchema,
  updateServiceBodySchema,
} from "@/domains/pricing/servicesSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

/**
 * 歸屬檢查：findById 後比對 merchant_id，不符合就視同不存在（404，不回 403）——
 * 不洩漏「資源存在但非本人所有」。
 */
async function findOwnedService(
  id: string,
  merchantId: string,
): Promise<Tables<"rate_card_base"> | null> {
  const service = await servicesRepository.findById(id);
  if (service === null || service.merchant_id !== merchantId) {
    return null;
  }
  return service;
}

/** PATCH /api/dashboard/services/{id} — 只能改 base_price/includes/unit。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  const { id } = await params;
  const idParsed = serviceIdSchema.safeParse(id);
  if (!idParsed.success) {
    return apiFail("服務項目 id 格式不正確", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = updateServiceBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const owned = await findOwnedService(idParsed.data, auth.merchantId);
    if (owned === null) {
      return apiFail("找不到指定的服務項目", 404);
    }

    const updated = await servicesRepository.update(idParsed.data, parsed.data);
    return apiOk({ item: updated });
  } catch (error) {
    console.error("[PATCH /api/dashboard/services/:id] 更新失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}

/** DELETE /api/dashboard/services/{id} — 軟刪除（is_active=false），非真實刪除。 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  const { id } = await params;
  const idParsed = serviceIdSchema.safeParse(id);
  if (!idParsed.success) {
    return apiFail("服務項目 id 格式不正確", 400);
  }

  try {
    const owned = await findOwnedService(idParsed.data, auth.merchantId);
    if (owned === null) {
      return apiFail("找不到指定的服務項目", 404);
    }

    const updated = await servicesRepository.update(idParsed.data, {
      is_active: false,
    });
    return apiOk({ item: updated });
  } catch (error) {
    console.error("[DELETE /api/dashboard/services/:id] 刪除失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test -- "src/app/api/dashboard/services/\[id\]/route.test.ts"`
Expected: PASS（9 個測試）

- [ ] **Step 5：Commit**

```bash
git add "src/app/api/dashboard/services/[id]/route.ts" "src/app/api/dashboard/services/[id]/route.test.ts"
git commit -m "feat(dashboard): PATCH/DELETE /api/dashboard/services/[id]

為什麼：商家需要能調整自己服務項目的價格/單位/內含服務，以及下架
不再提供的項目。真實 DELETE 會被 price_line_items 的外鍵擋下
（見 Task 1），故 DELETE 語意是軟刪除。

做了什麼：兩者共用 findOwnedService 歸屬檢查（findById + 比對
merchant_id，不符合一律 404 不回 403，避免洩漏資源存在性，沿用
5.4 requireMerchant 的跨租戶隔離慣例）；PATCH 只接受
base_price/includes/unit；DELETE 呼叫 update(id, {is_active:false})。

影響：無破壞性變更，純新增路由。"
```

---

### Task 6：/dashboard/services 頁面（UI，手動瀏覽器驗證）

**Files:**
- Create: `src/app/dashboard/services/page.tsx`
- Create: `src/app/dashboard/services/ServicesTable.tsx`
- Create: `src/app/dashboard/services/NewServiceForm.tsx`

依專案慣例（OnboardingForm.tsx、LoginForm.tsx 皆同），UI 元件不寫 vitest 單元測試，留待 Task 9 手動瀏覽器驗證完整回圈。

- [ ] **Step 1：`NewServiceForm.tsx`**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CASE_CATEGORIES,
  CASE_CATEGORY_LABELS,
} from "@/shared/constants/categories.ts";
import type { CaseCategory } from "@/shared/types/domain.types";

export function NewServiceForm() {
  const router = useRouter();
  const [category, setCategory] = useState<CaseCategory>(CASE_CATEGORIES[0]);
  const [subtype, setSubtype] = useState("");
  const [unit, setUnit] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [includes, setIncludes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const res = await fetch("/api/dashboard/services", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category,
          subtype,
          unit,
          base_price: Number(basePrice),
          includes: includes === "" ? null : includes,
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error ?? "發生未預期的錯誤，請稍後再試");
        setIsPending(false);
        return;
      }

      setSubtype("");
      setUnit("");
      setBasePrice("");
      setIncludes("");
      setIsPending(false);
      router.refresh();
    } catch {
      setError("網路異常，請稍後再試");
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border p-4">
      <h2 className="text-lg font-medium">新增服務項目</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          分類
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as CaseCategory)}
            className="rounded border px-2 py-1"
          >
            {CASE_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CASE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          子類型
          <input
            required
            value={subtype}
            onChange={(event) => setSubtype(event.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          單位
          <input
            required
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          基礎價格
          <input
            required
            type="number"
            min="1"
            value={basePrice}
            onChange={(event) => setBasePrice(event.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm">
          包含服務（選填）
          <input
            value={includes}
            onChange={(event) => setIncludes(event.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? "新增中…" : "新增"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2：`ServicesTable.tsx`**

```tsx
"use client";

import { useState } from "react";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

type ServiceRow = Tables<"rate_card_base">;
type EditableFields = { unit: string; base_price: string; includes: string };

function toEditable(item: ServiceRow): EditableFields {
  return {
    unit: item.unit,
    base_price: String(item.base_price ?? ""),
    includes: item.includes ?? "",
  };
}

function toDraftMap(items: ServiceRow[]): Record<string, EditableFields> {
  return Object.fromEntries(items.map((item) => [item.id, toEditable(item)]));
}

export function ServicesTable({ initialItems }: { initialItems: ServiceRow[] }) {
  const [items, setItems] = useState(initialItems);
  const [drafts, setDrafts] = useState(() => toDraftMap(initialItems));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  // router.refresh()（NewServiceForm 新增成功後）會讓 page.tsx 重新查詢並傳入新的
  // initialItems 參照。依 React 官方建議的「render 期間調整 state」模式同步，
  // 不用 useEffect（避免 ESLint react-hooks/set-state-in-effect：見
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes）。
  const [prevInitialItems, setPrevInitialItems] = useState(initialItems);
  if (initialItems !== prevInitialItems) {
    setPrevInitialItems(initialItems);
    setItems(initialItems);
    setDrafts(toDraftMap(initialItems));
  }

  async function refetch(): Promise<void> {
    const res = await fetch("/api/dashboard/services");
    const json = await res.json();
    if (res.ok && json.success) {
      setItems(json.data.items);
      setDrafts(toDraftMap(json.data.items));
    }
  }

  function updateDraft(id: string, patch: Partial<EditableFields>): void {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function handleSave(id: string): Promise<void> {
    const draft = drafts[id];
    const basePrice = Number(draft.base_price);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      setErrorById((prev) => ({ ...prev, [id]: "基礎價格須為正數" }));
      return;
    }

    setSavingId(id);
    setErrorById((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/dashboard/services/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          unit: draft.unit,
          base_price: basePrice,
          includes: draft.includes === "" ? null : draft.includes,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorById((prev) => ({ ...prev, [id]: json.error ?? "儲存失敗" }));
        return;
      }
      await refetch();
    } catch {
      setErrorById((prev) => ({ ...prev, [id]: "網路異常，請稍後再試" }));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm("確定要停售這個服務項目嗎？")) return;

    setSavingId(id);
    try {
      const res = await fetch(`/api/dashboard/services/${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorById((prev) => ({ ...prev, [id]: json.error ?? "刪除失敗" }));
        return;
      }
      await refetch();
    } catch {
      setErrorById((prev) => ({ ...prev, [id]: "網路異常，請稍後再試" }));
    } finally {
      setSavingId(null);
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-gray-600">尚無服務項目，請於下方新增。</p>;
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-2">分類</th>
          <th className="py-2">子類型</th>
          <th className="py-2">單位</th>
          <th className="py-2">基礎價格</th>
          <th className="py-2">包含服務</th>
          <th className="py-2">狀態</th>
          <th className="py-2" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const draft = drafts[item.id] ?? toEditable(item);
          const disabled = !item.is_active || savingId === item.id;
          return (
            <tr key={item.id} className="border-b align-top">
              <td className="py-2">{CASE_CATEGORY_LABELS[item.category]}</td>
              <td className="py-2">{item.subtype}</td>
              <td className="py-2">
                <input
                  value={draft.unit}
                  onChange={(event) => updateDraft(item.id, { unit: event.target.value })}
                  disabled={disabled}
                  className="w-20 rounded border px-2 py-1 disabled:opacity-50"
                />
              </td>
              <td className="py-2">
                <input
                  type="number"
                  value={draft.base_price}
                  onChange={(event) =>
                    updateDraft(item.id, { base_price: event.target.value })
                  }
                  disabled={disabled}
                  className="w-24 rounded border px-2 py-1 disabled:opacity-50"
                />
              </td>
              <td className="py-2">
                <input
                  value={draft.includes}
                  onChange={(event) =>
                    updateDraft(item.id, { includes: event.target.value })
                  }
                  disabled={disabled}
                  className="w-40 rounded border px-2 py-1 disabled:opacity-50"
                />
              </td>
              <td className="py-2">
                {!item.is_active && (
                  <span className="rounded bg-gray-200 px-2 py-1 text-xs">已停售</span>
                )}
              </td>
              <td className="py-2">
                {item.is_active && (
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleSave(item.id)}
                        disabled={disabled}
                        className="rounded border px-2 py-1 disabled:opacity-50"
                      >
                        {savingId === item.id ? "儲存中…" : "儲存"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        disabled={disabled}
                        className="rounded border px-2 py-1 text-red-600 disabled:opacity-50"
                      >
                        停售
                      </button>
                    </div>
                    {errorById[item.id] && (
                      <p role="alert" className="text-xs text-red-600">
                        {errorById[item.id]}
                      </p>
                    )}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3：`page.tsx`**

```tsx
import Link from "next/link";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import { ServicesTable } from "./ServicesTable.tsx";
import { NewServiceForm } from "./NewServiceForm.tsx";

export default async function ServicesPage() {
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

  const [items, modifiers] = await Promise.all([
    servicesRepository.findAllByMerchant(auth.merchantId),
    servicesRepository.findModifiersByMerchant(auth.merchantId),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">服務項目管理</h1>
        <Link href="/dashboard" className="text-sm underline">
          返回 Dashboard
        </Link>
      </div>
      <NewServiceForm />
      <ServicesTable initialItems={items} />
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">加成規則（唯讀）</h2>
        {modifiers.length === 0 ? (
          <p className="text-sm text-gray-600">尚無加成規則</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">名稱</th>
                <th className="py-2">觸發條件</th>
                <th className="py-2">幅度</th>
              </tr>
            </thead>
            <tbody>
              {modifiers.map((modifier) => (
                <tr key={modifier.id} className="border-b">
                  <td className="py-2">{modifier.modifier_name}</td>
                  <td className="py-2">{modifier.trigger_condition}</td>
                  <td className="py-2">
                    {modifier.range_min}–{modifier.range_max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 4：型別檢查**

Run: `pnpm exec tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 5：Commit**

```bash
git add src/app/dashboard/services/
git commit -m "feat(dashboard): /dashboard/services 頁面（inline 編輯 + 新增 + 軟刪除）

為什麼：商家需要一個畫面能新增/調整/下架自己的服務項目，加成規則
本輪先唯讀顯示（CRUD 留給未來任務）。

做了什麼：page.tsx（Server Component 外殼，requireMerchant 守門）+
NewServiceForm（獨立新增表單）+ ServicesTable（逐列 inline 編輯，
點『儲存』才送出 PATCH，不做 onBlur 自動存；停售項目 disabled 並顯示
badge；刪除走瀏覽器原生 confirm() 二次確認，成功後重新 fetch）。

影響：無破壞性變更，純新增頁面。"
```

---

### Task 7：dashboard 首頁加入服務項目管理連結

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 1：加入連結**

修改 `src/app/dashboard/page.tsx`，在 `import` 區加入 `Link`：

```typescript
import Link from "next/link";
import { logoutAction } from "./actions.ts";
```

在 `<CopyLinkButton>` 之後、`<form>` 登出按鈕之前加入連結：

```tsx
      {merchant !== null && <CopyLinkButton slug={merchant.public_slug} />}
      <Link href="/dashboard/services" className="text-sm underline">
        管理服務項目
      </Link>
      <form action={logoutAction}>
```

- [ ] **Step 2：既有測試不受影響**

Run: `pnpm test -- src/app/dashboard`
Expected: PASS（`dashboard/actions.test.ts` 不涉及 page.tsx 渲染，不受影響）

- [ ] **Step 3：Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(dashboard): dashboard 首頁加入服務項目管理入口連結

為什麼：/dashboard/services 頁面建好後，商家需要一個可發現的入口
才能實際使用，否則功能形同不存在。

做了什麼：dashboard/page.tsx 加一行連結到 /dashboard/services。

影響：無破壞性變更。"
```

---

### Task 8：verify-services.ts（真實 DB 驗證軟刪除設計）

**Files:**
- Create: `scripts/verify-services.ts`
- Modify: `package.json`（加 `verify:services` script）

此腳本驗證本任務的核心架構假設（Task 1「關鍵限制」）：真實 DELETE 一個已被歷史報價引用的 `rate_card_base` 列會被 FK 擋下；軟刪除（UPDATE is_active=false）不受此限制，且事後 `rateCardRepository.findBase` 查無結果。這是唯有真實 DB 才能驗證的行為（mock 測試無法證明 Postgres FK 約束真的生效）。

- [ ] **Step 1：實作**

```typescript
/**
 * 驗證 migration 0004（rate_card_base 軟刪除）在真實 DB 上的行為（任務 5.5 驗收）。
 * 執行：pnpm verify:services
 *
 * 證明兩件事：
 * 1. 真實 DELETE 一個已被歷史報價引用的 rate_card_base 列會被 FK 擋下
 *    （NO ACTION）——這是軟刪除設計的必要性依據，不只是偏好。
 * 2. UPDATE is_active=false（軟刪除）不受此限制，且之後
 *    rateCardRepository.findBase 查無該列（basePricing 的 is_active
 *    過濾在真實 DB 上生效）。
 * 結束時無論成敗都清理測試資料（try/finally），且刻意先手動清掉
 * price_line_items/sessions 再刪使用者，不依賴跨表 cascade 順序假設。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";
import { rateCardRepository } from "../src/domains/pricing/repositories/rateCardRepository.ts";
import type { Database } from "../src/lib/supabase/database.types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`驗證失敗：${message}`);
  }
}

const admin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function main(): Promise<void> {
  let merchantId: string | null = null;
  let sessionId: string | null = null;

  try {
    const email = `verify-services-${Date.now()}@bizmate-test.local`;
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email,
      password: "VerifyServicesTest123",
      email_confirm: true,
    });
    if (userError || !userData.user) {
      throw new Error(`建立測試使用者失敗：${userError?.message}`);
    }
    merchantId = userData.user.id;

    const { error: merchantError } = await admin.from("merchants").insert({
      id: merchantId,
      display_name: "verify-services 商家",
      public_slug: `verify-services-${Date.now()}`,
      contact_email: email,
    });
    if (merchantError) {
      throw new Error(`建立商家列失敗：${merchantError.message}`);
    }

    const { data: rateCard, error: rateCardError } = await admin
      .from("rate_card_base")
      .insert({
        merchant_id: merchantId,
        category: "illustration",
        subtype: "verify-services-subtype",
        unit: "件",
        base_price: 1000,
      })
      .select()
      .single();
    if (rateCardError || !rateCard) {
      throw new Error(`建立 rate_card_base 失敗：${rateCardError?.message}`);
    }
    assert(rateCard.is_active === true, "新建列預設 is_active 應為 true");
    console.log("✅ 建立測試商家與 rate_card_base 列完成");

    const { data: session, error: sessionError } = await admin
      .from("sessions")
      .insert({
        merchant_id: merchantId,
        category: "illustration",
        contact_email: email,
        status: "confirmed",
      })
      .select()
      .single();
    if (sessionError || !session) {
      throw new Error(`建立 session 失敗：${sessionError?.message}`);
    }
    sessionId = session.id;

    const { error: lineItemError } = await admin.from("price_line_items").insert({
      session_id: session.id,
      item_name: "verify-services 基本費",
      amount: 1000,
      rule_id: rateCard.id,
    });
    if (lineItemError) {
      throw new Error(`建立 price_line_items 失敗：${lineItemError.message}`);
    }
    console.log("✅ 建立引用該 rate_card_base 的歷史報價項目完成");

    const { error: deleteError } = await admin
      .from("rate_card_base")
      .delete()
      .eq("id", rateCard.id);
    assert(
      deleteError !== null && /foreign key|violates/i.test(deleteError.message),
      `真實 DELETE 應被外鍵約束擋下，實際：${deleteError?.message ?? "無錯誤"}`,
    );
    console.log("✅ 真實 DELETE 被外鍵約束擋下，證實軟刪除是必要設計");

    const { error: softDeleteError } = await admin
      .from("rate_card_base")
      .update({ is_active: false })
      .eq("id", rateCard.id);
    assert(
      softDeleteError === null,
      `軟刪除（UPDATE is_active=false）應成功：${softDeleteError?.message}`,
    );
    console.log("✅ 軟刪除成功，歷史報價引用未受影響");

    const found = await rateCardRepository.findBase(
      merchantId,
      "illustration",
      "verify-services-subtype",
    );
    assert(
      found === null,
      "軟刪除後 rateCardRepository.findBase 應查無結果（is_active 過濾生效）",
    );
    console.log("✅ basePricing 查詢已排除停售項目");

    console.log("\n🎉 MT-M3 軟刪除設計驗收通過。");
  } finally {
    if (sessionId) {
      await admin.from("price_line_items").delete().eq("session_id", sessionId);
      await admin.from("sessions").delete().eq("id", sessionId);
    }
    if (merchantId) {
      await admin.auth.admin.deleteUser(merchantId).catch(() => {
        console.error(
          `⚠️ 清理測試商家失敗，請至 Supabase Studio 手動刪除 ${merchantId}`,
        );
      });
    }
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
```

- [ ] **Step 2：加入 package.json script**

修改 `package.json` 的 `scripts` 區塊，在 `"verify:auth"` 之後加一行：

```json
    "verify:auth": "tsx --env-file=.env.local scripts/verify-auth.ts",
    "verify:services": "tsx --env-file=.env.local scripts/verify-services.ts",
```

- [ ] **Step 3：執行驗證（需 Task 1 的 migration 已於 Supabase 執行）**

Run: `pnpm verify:services`
Expected: 全部 `✅` 通過，最後印出「🎉 MT-M3 軟刪除設計驗收通過。」；若失敗，先確認 migration 0004 是否已在 Supabase Dashboard 執行

- [ ] **Step 4：Commit**

```bash
git add scripts/verify-services.ts package.json
git commit -m "test(pricing): verify-services 腳本驗證軟刪除設計於真實 DB 生效

為什麼：mock 測試無法證明 Postgres FK 約束真的擋下真實 DELETE，
這是本任務架構假設（見 Task 1「關鍵限制」）能否成立的關鍵，需要
對真實 Supabase 專案驗證。

做了什麼：建測試商家 + rate_card_base 列 + 引用它的歷史報價項目 →
證明真實 DELETE 被 FK 擋下 → 證明軟刪除（UPDATE is_active=false）
不受此限制 → 證明軟刪除後 rateCardRepository.findBase 查無結果。
清理時先手動刪 price_line_items/sessions 再刪使用者，不依賴跨表
cascade 順序假設。

影響：新增 pnpm verify:services 指令，不影響既有流程。"
```

---

### Task 9：全量驗證 + 手動瀏覽器驗證 + 分支收尾

**Files:** 無新檔案，本任務為驗證與收尾。

- [ ] **Step 1：全量自動化驗證**

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Expected：lint 無錯誤；型別檢查通過；測試全過（預期 292 個，27+3=30 個檔案，實際數字以輸出為準）；build 成功

- [ ] **Step 2：手動瀏覽器驗證完整回圈**

啟動 `pnpm dev`，使用既有測試商家帳號（或建新帳號）登入，走過：

1. 從 `/dashboard` 點「管理服務項目」進入 `/dashboard/services`
2. 確認範本複製來的項目正確列出（category/subtype 唯讀、unit/base_price/includes 可編輯）
3. 新增一筆服務項目 → 確認出現在列表
4. 編輯某一列的 base_price → 點「儲存」→ 確認數值更新、無需重新整理頁面
5. 點「停售」→ confirm 對話框 → 確認後該列變 disabled 並顯示「已停售」badge
6. 確認加成規則區塊唯讀顯示、無任何可互動元件
7. 開瀏覽器 DevTools Network，確認 PATCH/DELETE 都帶正確 cookie（沿用既有 session）

- [ ] **Step 3：更新 WBS**

讀取 `.claude/taskmaster-data/wbs.md`，將 5.5 MT-M3 狀態改為 `✅ 完成`，5.6 MT-M4a 標記為下一個任務，寫回檔案並 commit：

```bash
git add .claude/taskmaster-data/wbs.md
git commit -m "docs(wbs): 5.5 MT-M3 服務項目管理完成"
```

- [ ] **Step 4：載入 sunnydata-branch-lifecycle skill Phase 2 完成分支收尾**

依專案慣例（5.2/5.3/5.4 皆同）：驗證測試通過 → 審視 commit 歷史 → 呈現選項（本 repo 慣例是 `--no-ff` 併回 main）→ 執行 → 刪除功能分支。

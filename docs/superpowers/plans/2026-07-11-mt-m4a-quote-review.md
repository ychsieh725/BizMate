# MT-M4a 報價列表 + 詳情 Implementation Plan

> **For agentic workers:** 依 superpowers:sunnydata-design 的 Execute Plan 階段逐任務實作。步驟以 checkbox（`- [ ]`）追蹤。

**Goal:** 商家能在後台看到客戶送進來的報價列表，並點進單筆看到完整可追溯脈絡（費用明細、抽取欄位、澄清歷程、原始描述）。

**Architecture:** route 薄殼 → `quoteReviewService`（歸屬檢查 + 資料聚合的唯一入口）→ `quoteReviewRepository`（唯讀查詢）。頁面為 Server Component 直接呼叫 service；API 端點供 5.7 的 client 互動使用。安全不變式：子表查詢只接受經 quote 歸屬檢查後帶出的 `session_id`。

**Tech Stack:** Next.js 16（App Router / Server Components）、TypeScript、zod 4、Supabase（service_role client）、Vitest、Tailwind 4

**Spec:** `docs/superpowers/specs/2026-07-11-mt-m4a-quote-review-design.md`

---

## Task 1：常數、型別、schemas

**Files:**
- Create: `src/shared/constants/quoteStatus.ts`
- Create: `src/domains/pricing/quoteReviewTypes.ts`
- Create: `src/domains/pricing/quoteReviewSchemas.ts`
- Test: `src/domains/pricing/quoteReviewSchemas.test.ts`

- [ ] **Step 1：寫失敗的測試**

`src/domains/pricing/quoteReviewSchemas.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { listQuotesQuerySchema, quoteIdSchema } from "./quoteReviewSchemas.ts";

describe("quoteIdSchema", () => {
  it("合法 UUID 通過", () => {
    const result = quoteIdSchema.safeParse("11111111-1111-1111-1111-111111111111");
    expect(result.success).toBe(true);
  });

  it("非 UUID 字串失敗", () => {
    expect(quoteIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("listQuotesQuerySchema", () => {
  it("無 status（空物件）通過，status 為 undefined", () => {
    const result = listQuotesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBeUndefined();
    }
  });

  it("合法 status 通過", () => {
    const result = listQuotesQuerySchema.safeParse({ status: "awaiting_review" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("awaiting_review");
    }
  });

  it("非法 status 失敗", () => {
    expect(listQuotesQuerySchema.safeParse({ status: "pending" }).success).toBe(false);
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test src/domains/pricing/quoteReviewSchemas.test.ts`
Expected: FAIL — 找不到模組 `./quoteReviewSchemas.ts`

- [ ] **Step 3：寫實作**

`src/shared/constants/quoteStatus.ts`：

```ts
import type { QuoteStatus } from "@/shared/types/domain.types";

/** 報價狀態的中文顯示標籤（對應 DB enum quote_status）。 */
export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "草稿",
  awaiting_review: "待審",
  confirmed: "已確認",
  sent: "已寄出",
};

/** 供後台篩選 tab 依序渲染的狀態清單，並作為 zod enum 的值域來源。 */
export const QUOTE_STATUSES = [
  "draft",
  "awaiting_review",
  "confirmed",
  "sent",
] as const satisfies readonly QuoteStatus[];
```

`src/domains/pricing/quoteReviewTypes.ts`：

```ts
import type { Tables } from "@/lib/supabase/database.types.ts";
import type { CaseCategory, QuoteStatus } from "@/shared/types/domain.types";

/**
 * 後台列表的一列：quotes 本體 + 該 session 的 category / 客戶 email。
 * category/contact_email 可能為 null（FK 保證 session 必存在，但防禦式建模：
 * 資料不一致時列表仍能渲染，不整頁爆掉）。
 */
export type QuoteListRow = {
  id: string;
  quote_code: string;
  final_amount: number | null;
  status: QuoteStatus;
  is_conservative: boolean;
  created_at: string;
  category: CaseCategory | null;
  contact_email: string | null;
};

/** 後台詳情：一張報價的完整可追溯脈絡。 */
export type QuoteDetail = {
  quote: Tables<"quotes">;
  session: Tables<"sessions">;
  lineItems: Tables<"price_line_items">[];
  extractedFields: Tables<"extracted_fields">[];
  clarifications: Tables<"clarification_turns">[];
  rawInputs: Tables<"raw_inputs">[];
};
```

`src/domains/pricing/quoteReviewSchemas.ts`：

```ts
import { z } from "zod";
import { QUOTE_STATUSES } from "@/shared/constants/quoteStatus.ts";

/** 報價 id 路徑參數：必須是合法 UUID（同 serviceIdSchema 慣例）。 */
export const quoteIdSchema = z.string().uuid();

/** GET /api/dashboard/quotes 查詢參數：status 選填，值域為 quote_status enum。 */
export const listQuotesQuerySchema = z.object({
  status: z.enum(QUOTE_STATUSES).optional(),
});
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test src/domains/pricing/quoteReviewSchemas.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5：Commit**

```bash
git add src/shared/constants/quoteStatus.ts src/domains/pricing/quoteReviewTypes.ts src/domains/pricing/quoteReviewSchemas.ts src/domains/pricing/quoteReviewSchemas.test.ts
git commit -m "feat(quotes): add quote review types, status constants and schemas"
```

---

## Task 2：quoteReviewRepository

**Files:**
- Create: `src/domains/pricing/repositories/quoteReviewRepository.ts`

無單元測試——repository 層與其他 repository 一致（`servicesRepository` / `quotesRepository` 皆無 `.test.ts`），正確性由 Task 8 的 `verify-quotes.ts` 對真實 DB 驗證。

- [ ] **Step 1：寫實作**

`src/domains/pricing/repositories/quoteReviewRepository.ts`：

```ts
import { BaseRepository, RepositoryError } from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";
import type { QuoteStatus } from "@/shared/types/domain.types";

/**
 * 後台報價審核的唯讀查詢 repository（5.6）。
 * 與既有 quotesRepository（報價寫入 + quote_code 流水號）分開——
 * 「報價產生」與「後台審核」是不同關注點（比照 rateCardRepository vs
 * servicesRepository 的切分）。
 *
 * ⚠ 安全約定：以 sessionId 為參數的四個子表方法只能由 quoteReviewService
 * 在完成 quote 歸屬檢查之後呼叫。price_line_items / extracted_fields /
 * clarification_turns / raw_inputs 沒有 merchant_id，自身無法判斷租戶歸屬，
 * 且本 client 走 service_role 繞過 RLS。
 */
export class QuoteReviewRepository extends BaseRepository<"quotes"> {
  constructor() {
    super("quotes");
  }

  /** 該商家的報價，status 選填過濾，依建立時間新到舊。 */
  async findByMerchant(
    merchantId: string,
    status?: QuoteStatus,
  ): Promise<Tables<"quotes">[]> {
    const byMerchant = this.client
      .from("quotes")
      .select("*")
      .eq("merchant_id", merchantId);
    const filtered =
      status === undefined ? byMerchant : byMerchant.eq("status", status);

    const { data, error } = await filtered.order("created_at", {
      ascending: false,
    });
    if (error) {
      throw new RepositoryError("quotes", "findByMerchant", error.message);
    }
    return data ?? [];
  }

  /** 依 id 批次取 sessions（列表需顯示 category / 客戶 email）。 */
  async findSessionsByIds(ids: string[]): Promise<Tables<"sessions">[]> {
    if (ids.length === 0) return [];

    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .in("id", ids);
    if (error) {
      throw new RepositoryError("sessions", "findSessionsByIds", error.message);
    }
    return data ?? [];
  }

  /** 單一 session（詳情頁的案件本體）。 */
  async findSessionById(sessionId: string): Promise<Tables<"sessions"> | null> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) {
      throw new RepositoryError("sessions", "findSessionById", error.message);
    }
    return data ?? null;
  }

  /** 費用明細，依建立順序。 */
  async findLineItems(
    sessionId: string,
  ): Promise<Tables<"price_line_items">[]> {
    const { data, error } = await this.client
      .from("price_line_items")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "price_line_items",
        "findLineItems",
        error.message,
      );
    }
    return data ?? [];
  }

  /** 抽取欄位，依欄位名穩定排序（不隨 upsert 順序跳動）。 */
  async findExtractedFields(
    sessionId: string,
  ): Promise<Tables<"extracted_fields">[]> {
    const { data, error } = await this.client
      .from("extracted_fields")
      .select("*")
      .eq("session_id", sessionId)
      .order("field_name", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "extracted_fields",
        "findExtractedFields",
        error.message,
      );
    }
    return data ?? [];
  }

  /** 澄清歷程（含未回答的最後一輪），依輪次遞增。 */
  async findClarifications(
    sessionId: string,
  ): Promise<Tables<"clarification_turns">[]> {
    const { data, error } = await this.client
      .from("clarification_turns")
      .select("*")
      .eq("session_id", sessionId)
      .order("round", { ascending: true });
    if (error) {
      throw new RepositoryError(
        "clarification_turns",
        "findClarifications",
        error.message,
      );
    }
    return data ?? [];
  }

  /** 客戶的原始描述——全部列出（非只有最新一筆），後台需看到說過的每一句。 */
  async findRawInputs(sessionId: string): Promise<Tables<"raw_inputs">[]> {
    const { data, error } = await this.client
      .from("raw_inputs")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    if (error) {
      throw new RepositoryError("raw_inputs", "findRawInputs", error.message);
    }
    return data ?? [];
  }
}

export const quoteReviewRepository = new QuoteReviewRepository();
```

- [ ] **Step 2：型別檢查**

Run: `pnpm exec tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 3：Commit**

```bash
git add src/domains/pricing/repositories/quoteReviewRepository.ts
git commit -m "feat(quotes): add read-only quote review repository"
```

---

## Task 3：quoteReviewService（安全核心）

**Files:**
- Create: `src/domains/pricing/quoteReviewService.ts`
- Test: `src/domains/pricing/quoteReviewService.test.ts`

- [ ] **Step 1：寫失敗的測試**

`src/domains/pricing/quoteReviewService.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("./repositories/quoteReviewRepository.ts", () => ({
  quoteReviewRepository: {
    findByMerchant: vi.fn(),
    findSessionsByIds: vi.fn(),
    findById: vi.fn(),
    findSessionById: vi.fn(),
    findLineItems: vi.fn(),
    findExtractedFields: vi.fn(),
    findClarifications: vi.fn(),
    findRawInputs: vi.fn(),
  },
}));

import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import { listQuotes, getQuoteDetail } from "./quoteReviewService.ts";

const repo = vi.mocked(quoteReviewRepository);

const MERCHANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MERCHANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SESSION_ID = "55555555-5555-5555-5555-555555555555";
const QUOTE_ID = "66666666-6666-6666-6666-666666666666";

const QUOTE_A: Tables<"quotes"> = {
  id: QUOTE_ID,
  session_id: SESSION_ID,
  merchant_id: MERCHANT_A,
  quote_code: "I-2607-001",
  final_amount: 8000,
  status: "awaiting_review",
  pdf_url: null,
  created_at: "2026-07-11T02:00:00.000Z",
  sent_at: null,
  is_conservative: false,
};

const SESSION_A: Tables<"sessions"> = {
  id: SESSION_ID,
  merchant_id: MERCHANT_A,
  category: "illustration",
  contact_email: "client@example.com",
  status: "awaiting_review",
  current_step: 4,
  created_at: "2026-07-11T01:00:00.000Z",
  updated_at: "2026-07-11T02:00:00.000Z",
};

/** 四張子表：沒有 merchant_id，歸屬檢查失敗時一次都不該被呼叫。 */
const subTableQueries = [
  () => repo.findLineItems,
  () => repo.findExtractedFields,
  () => repo.findClarifications,
  () => repo.findRawInputs,
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listQuotes", () => {
  it("無報價 → 回空陣列，且不查 sessions", async () => {
    repo.findByMerchant.mockResolvedValue([]);

    const rows = await listQuotes(MERCHANT_A);

    expect(rows).toEqual([]);
    expect(repo.findSessionsByIds).not.toHaveBeenCalled();
  });

  it("以 session 補上 category / contact_email", async () => {
    repo.findByMerchant.mockResolvedValue([QUOTE_A]);
    repo.findSessionsByIds.mockResolvedValue([SESSION_A]);

    const rows = await listQuotes(MERCHANT_A);

    expect(rows).toEqual([
      {
        id: QUOTE_ID,
        quote_code: "I-2607-001",
        final_amount: 8000,
        status: "awaiting_review",
        is_conservative: false,
        created_at: "2026-07-11T02:00:00.000Z",
        category: "illustration",
        contact_email: "client@example.com",
      },
    ]);
  });

  it("status 過濾條件傳遞至 repository", async () => {
    repo.findByMerchant.mockResolvedValue([]);

    await listQuotes(MERCHANT_A, "sent");

    expect(repo.findByMerchant).toHaveBeenCalledWith(MERCHANT_A, "sent");
  });
});

describe("getQuoteDetail", () => {
  it("報價不存在 → null，且不碰任何子表", async () => {
    repo.findById.mockResolvedValue(null);

    const detail = await getQuoteDetail(QUOTE_ID, MERCHANT_A);

    expect(detail).toBeNull();
    for (const query of subTableQueries) {
      expect(query()).not.toHaveBeenCalled();
    }
  });

  it("跨租戶：B 商家取 A 的報價 → null，且四張子表一次都沒被查（安全不變式）", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);

    const detail = await getQuoteDetail(QUOTE_ID, MERCHANT_B);

    expect(detail).toBeNull();
    expect(repo.findSessionById).not.toHaveBeenCalled();
    for (const query of subTableQueries) {
      expect(query()).not.toHaveBeenCalled();
    }
  });

  it("歸屬正確 → 聚合四張子表，且子表只以 quote.session_id 查詢", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue(SESSION_A);
    repo.findLineItems.mockResolvedValue([]);
    repo.findExtractedFields.mockResolvedValue([]);
    repo.findClarifications.mockResolvedValue([]);
    repo.findRawInputs.mockResolvedValue([]);

    const detail = await getQuoteDetail(QUOTE_ID, MERCHANT_A);

    expect(detail).toEqual({
      quote: QUOTE_A,
      session: SESSION_A,
      lineItems: [],
      extractedFields: [],
      clarifications: [],
      rawInputs: [],
    });
    for (const query of subTableQueries) {
      expect(query()).toHaveBeenCalledWith(SESSION_ID);
    }
  });

  it("session 遺失（資料不一致）→ null", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue(null);
    repo.findLineItems.mockResolvedValue([]);
    repo.findExtractedFields.mockResolvedValue([]);
    repo.findClarifications.mockResolvedValue([]);
    repo.findRawInputs.mockResolvedValue([]);

    const detail = await getQuoteDetail(QUOTE_ID, MERCHANT_A);

    expect(detail).toBeNull();
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test src/domains/pricing/quoteReviewService.test.ts`
Expected: FAIL — 找不到模組 `./quoteReviewService.ts`

- [ ] **Step 3：寫實作**

`src/domains/pricing/quoteReviewService.ts`：

```ts
import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import type { QuoteDetail, QuoteListRow } from "./quoteReviewTypes.ts";
import type { QuoteStatus } from "@/shared/types/domain.types";

/**
 * 後台報價審核的唯讀 service（5.6）。
 *
 * 安全不變式（本模組存在的主要理由）：
 * price_line_items / extracted_fields / clarification_turns / raw_inputs
 * 四張子表只有 session_id、沒有 merchant_id，而 repository 走 service_role
 * 繞過 RLS。因此「以 quote.merchant_id 驗證歸屬」必須在任何子表查詢之前完成，
 * 且子表只接受由該 quote 帶出的 session_id——絕不接受外部傳入的 session_id。
 */

/** 該商家的報價列表（status 選填過濾）。 */
export async function listQuotes(
  merchantId: string,
  status?: QuoteStatus,
): Promise<QuoteListRow[]> {
  const quotes = await quoteReviewRepository.findByMerchant(merchantId, status);
  if (quotes.length === 0) {
    return [];
  }

  const sessions = await quoteReviewRepository.findSessionsByIds(
    quotes.map((quote) => quote.session_id),
  );
  const sessionById = new Map(
    sessions.map((session) => [session.id, session] as const),
  );

  return quotes.map((quote) => {
    const session = sessionById.get(quote.session_id);
    return {
      id: quote.id,
      quote_code: quote.quote_code,
      final_amount: quote.final_amount,
      status: quote.status,
      is_conservative: quote.is_conservative,
      created_at: quote.created_at,
      category: session?.category ?? null,
      contact_email: session?.contact_email ?? null,
    };
  });
}

/**
 * 單張報價的完整脈絡。查無或不屬於該商家一律回 null——
 * 呼叫端轉 404（不回 403，不洩漏「資源存在但非本人所有」）。
 */
export async function getQuoteDetail(
  quoteId: string,
  merchantId: string,
): Promise<QuoteDetail | null> {
  const quote = await quoteReviewRepository.findById(quoteId);
  if (quote === null || quote.merchant_id !== merchantId) {
    return null;
  }

  // ── 歸屬檢查已通過，此後才准使用 quote.session_id 查子表 ──
  const sessionId = quote.session_id;
  const [session, lineItems, extractedFields, clarifications, rawInputs] =
    await Promise.all([
      quoteReviewRepository.findSessionById(sessionId),
      quoteReviewRepository.findLineItems(sessionId),
      quoteReviewRepository.findExtractedFields(sessionId),
      quoteReviewRepository.findClarifications(sessionId),
      quoteReviewRepository.findRawInputs(sessionId),
    ]);

  if (session === null) {
    return null;
  }

  return { quote, session, lineItems, extractedFields, clarifications, rawInputs };
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test src/domains/pricing/quoteReviewService.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5：Commit**

```bash
git add src/domains/pricing/quoteReviewService.ts src/domains/pricing/quoteReviewService.test.ts
git commit -m "feat(quotes): add quote review service with tenant ownership guard"
```

---

## Task 4：GET /api/dashboard/quotes（列表 API）

**Files:**
- Create: `src/app/api/dashboard/quotes/route.ts`
- Test: `src/app/api/dashboard/quotes/route.test.ts`

- [ ] **Step 1：寫失敗的測試**

`src/app/api/dashboard/quotes/route.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QuoteListRow } from "@/domains/pricing/quoteReviewTypes.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/quoteReviewService.ts", () => ({
  listQuotes: vi.fn(),
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { listQuotes } from "@/domains/pricing/quoteReviewService.ts";
import { GET } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockListQuotes = vi.mocked(listQuotes);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";

const ROW: QuoteListRow = {
  id: "66666666-6666-6666-6666-666666666666",
  quote_code: "I-2607-001",
  final_amount: 8000,
  status: "awaiting_review",
  is_conservative: false,
  created_at: "2026-07-11T02:00:00.000Z",
  category: "illustration",
  contact_email: "client@example.com",
};

function getRequest(query = ""): Request {
  return new Request(`http://localhost/api/dashboard/quotes${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/quotes", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await GET(getRequest());

    expect(res.status).toBe(401);
    expect(mockListQuotes).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await GET(getRequest());

    expect(res.status).toBe(403);
    expect(mockListQuotes).not.toHaveBeenCalled();
  });

  it("status 非法值 → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await GET(getRequest("?status=pending"));

    expect(res.status).toBe(400);
    expect(mockListQuotes).not.toHaveBeenCalled();
  });

  it("無 status → 回全部（status 傳 undefined）", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockListQuotes.mockResolvedValue([ROW]);

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.items).toEqual([ROW]);
    expect(mockListQuotes).toHaveBeenCalledWith(MERCHANT_ID, undefined);
  });

  it("帶合法 status → 過濾條件傳遞至 service", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockListQuotes.mockResolvedValue([]);

    const res = await GET(getRequest("?status=awaiting_review"));

    expect(res.status).toBe(200);
    expect(mockListQuotes).toHaveBeenCalledWith(MERCHANT_ID, "awaiting_review");
  });

  it("service 拋錯 → 500", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockListQuotes.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(getRequest());

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test src/app/api/dashboard/quotes/route.test.ts`
Expected: FAIL — 找不到模組 `./route.ts`

- [ ] **Step 3：寫實作**

`src/app/api/dashboard/quotes/route.ts`：

```ts
import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { listQuotes } from "@/domains/pricing/quoteReviewService.ts";
import { listQuotesQuerySchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";

/** GET /api/dashboard/quotes?status= — 該商家報價列表；status 選填，未帶則回全部。 */
export async function GET(request: Request): Promise<Response> {
  const auth = await requireMerchant();
  if (!auth.ok) {
    return apiFail(
      auth.status === 401 ? "請先登入" : "查無商家資料",
      auth.status,
    );
  }

  const statusParam = new URL(request.url).searchParams.get("status");
  const parsed = listQuotesQuerySchema.safeParse(
    statusParam === null ? {} : { status: statusParam },
  );
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const items = await listQuotes(auth.merchantId, parsed.data.status);
    return apiOk({ items });
  } catch (error) {
    console.error("[GET /api/dashboard/quotes] 查詢失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test src/app/api/dashboard/quotes/route.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5：Commit**

```bash
git add src/app/api/dashboard/quotes/route.ts src/app/api/dashboard/quotes/route.test.ts
git commit -m "feat(quotes): add GET /api/dashboard/quotes list endpoint"
```

---

## Task 5：GET /api/dashboard/quotes/[id]（詳情 API）

**Files:**
- Create: `src/app/api/dashboard/quotes/[id]/route.ts`
- Test: `src/app/api/dashboard/quotes/[id]/route.test.ts`

- [ ] **Step 1：寫失敗的測試**

`src/app/api/dashboard/quotes/[id]/route.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QuoteDetail } from "@/domains/pricing/quoteReviewTypes.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/quoteReviewService.ts", () => ({
  getQuoteDetail: vi.fn(),
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { getQuoteDetail } from "@/domains/pricing/quoteReviewService.ts";
import { GET } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockGetQuoteDetail = vi.mocked(getQuoteDetail);

const MERCHANT_ID = "99999999-9999-9999-9999-999999999999";
// zod 4 的 .uuid() 嚴格檢查 RFC 4122 variant/version bits——
// 「6666…」「5555…」這類重複數字不是合法 UUID，route 會回 400。
const QUOTE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const SESSION_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";

const DETAIL: QuoteDetail = {
  quote: {
    id: QUOTE_ID,
    session_id: SESSION_ID,
    merchant_id: MERCHANT_ID,
    quote_code: "I-2607-001",
    final_amount: 8000,
    status: "awaiting_review",
    pdf_url: null,
    created_at: "2026-07-11T02:00:00.000Z",
    sent_at: null,
    is_conservative: false,
  },
  session: {
    id: SESSION_ID,
    merchant_id: MERCHANT_ID,
    category: "illustration",
    contact_email: "client@example.com",
    status: "awaiting_review",
    current_step: 4,
    created_at: "2026-07-11T01:00:00.000Z",
    updated_at: "2026-07-11T02:00:00.000Z",
  },
  lineItems: [],
  extractedFields: [],
  clarifications: [],
  rawInputs: [],
};

function getRequest(): Request {
  return new Request(`http://localhost/api/dashboard/quotes/${QUOTE_ID}`);
}

function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/quotes/[id]", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await GET(getRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(401);
    expect(mockGetQuoteDetail).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await GET(getRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(403);
  });

  it("id 非 UUID → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await GET(getRequest(), routeParams("not-a-uuid"));

    expect(res.status).toBe(400);
    expect(mockGetQuoteDetail).not.toHaveBeenCalled();
  });

  it("查無報價（或跨租戶）→ 404", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockGetQuoteDetail.mockResolvedValue(null);

    const res = await GET(getRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(404);
  });

  it("成功 → 200 帶完整 detail", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockGetQuoteDetail.mockResolvedValue(DETAIL);

    const res = await GET(getRequest(), routeParams(QUOTE_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.detail).toEqual(DETAIL);
    expect(mockGetQuoteDetail).toHaveBeenCalledWith(QUOTE_ID, MERCHANT_ID);
  });

  it("service 拋錯 → 500", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockGetQuoteDetail.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(getRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test "src/app/api/dashboard/quotes/[id]/route.test.ts"`
Expected: FAIL — 找不到模組 `./route.ts`

- [ ] **Step 3：寫實作**

`src/app/api/dashboard/quotes/[id]/route.ts`：

```ts
import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { getQuoteDetail } from "@/domains/pricing/quoteReviewService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";

/**
 * GET /api/dashboard/quotes/{id} — 單張報價的完整脈絡。
 * 不存在與非本商家所有一律回 404（不回 403：不洩漏資源存在性，
 * 同 services/[id] 的 findOwnedService 慣例）。
 */
export async function GET(
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
  const idParsed = quoteIdSchema.safeParse(id);
  if (!idParsed.success) {
    return apiFail("報價 id 格式不正確", 400);
  }

  try {
    const detail = await getQuoteDetail(idParsed.data, auth.merchantId);
    if (detail === null) {
      return apiFail("找不到指定的報價", 404);
    }
    return apiOk({ detail });
  } catch (error) {
    console.error("[GET /api/dashboard/quotes/:id] 查詢失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test "src/app/api/dashboard/quotes/[id]/route.test.ts"`
Expected: PASS（6 tests）

- [ ] **Step 5：Commit**

```bash
git add "src/app/api/dashboard/quotes/[id]/route.ts" "src/app/api/dashboard/quotes/[id]/route.test.ts"
git commit -m "feat(quotes): add GET /api/dashboard/quotes/[id] detail endpoint"
```

---

## Task 6：路由常數 + 顯示格式化工具

**Files:**
- Modify: `src/shared/constants/routes.ts`
- Create: `src/app/dashboard/quotes/formatters.ts`
- Test: `src/app/dashboard/quotes/formatters.test.ts`

- [ ] **Step 1：寫失敗的測試**

`src/app/dashboard/quotes/formatters.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { formatAmount, formatDateTime } from "./formatters.ts";

describe("formatAmount", () => {
  it("數字加上千分位與幣別前綴", () => {
    expect(formatAmount(8000)).toBe("NT$ 8,000");
  });

  it("null（尚未定價）→ 破折號，不顯示 NT$ 0 誤導", () => {
    expect(formatAmount(null)).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("ISO 字串轉台北時區的年月日時分", () => {
    // 2026-07-11T02:00:00Z = 台北時間 10:00
    expect(formatDateTime("2026-07-11T02:00:00.000Z")).toBe("2026/07/11 10:00");
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test src/app/dashboard/quotes/formatters.test.ts`
Expected: FAIL — 找不到模組 `./formatters.ts`

- [ ] **Step 3：寫實作**

`src/app/dashboard/quotes/formatters.ts`：

```ts
/**
 * 後台報價頁面的顯示格式化（列表與詳情共用）。
 * 純函式，與 React 無關——可獨立測試。
 */

const AMOUNT_FORMATTER = new Intl.NumberFormat("zh-TW");

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 金額：尚未定價（null）顯示破折號，不顯示 NT$ 0 誤導商家。 */
export function formatAmount(amount: number | null): string {
  if (amount === null) {
    return "—";
  }
  return `NT$ ${AMOUNT_FORMATTER.format(amount)}`;
}

/** 時間：DB 存 UTC，後台一律以台北時區顯示（不依伺服器時區）。 */
export function formatDateTime(isoString: string): string {
  const parts = DATE_TIME_FORMATTER.formatToParts(new Date(isoString));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test src/app/dashboard/quotes/formatters.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5：補路由常數**

修改 `src/shared/constants/routes.ts`，在 `PAGE_ROUTES` 的 `dashboard` 之後加入：

```ts
  dashboardQuotes: "/dashboard/quotes",
  dashboardQuote: (id: string) => `/dashboard/quotes/${id}`,
```

在 `API_ROUTES` 的 `status` 之後加入：

```ts
  dashboardQuotes: "/api/dashboard/quotes",
  dashboardQuote: (id: string) => `/api/dashboard/quotes/${id}`,
```

- [ ] **Step 6：Commit**

```bash
git add src/shared/constants/routes.ts src/app/dashboard/quotes/formatters.ts src/app/dashboard/quotes/formatters.test.ts
git commit -m "feat(quotes): add dashboard quote routes and display formatters"
```

---

## Task 7：列表頁 + 詳情頁 + Dashboard 連結

**Files:**
- Create: `src/app/dashboard/quotes/page.tsx`
- Create: `src/app/dashboard/quotes/[id]/page.tsx`
- Modify: `src/app/dashboard/page.tsx`

無單元測試——與 5.5 的頁面元件一致（專案不對 `.tsx` 寫單元測試），行為由 Task 8 的 verify script 與手動 curl 驗證。

- [ ] **Step 1：列表頁**

`src/app/dashboard/quotes/page.tsx`：

```tsx
import Link from "next/link";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { listQuotes } from "@/domains/pricing/quoteReviewService.ts";
import { listQuotesQuerySchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { formatAmount, formatDateTime } from "./formatters.ts";

const ALL_TAB = { label: "全部", href: PAGE_ROUTES.dashboardQuotes } as const;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
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

  const { status: statusParam } = await searchParams;
  const parsed = listQuotesQuerySchema.safeParse(
    statusParam === undefined ? {} : { status: statusParam },
  );
  // 網址帶入非法 status 不報錯，視同「全部」——瀏覽器網址列不是 API 邊界。
  const activeStatus = parsed.success ? parsed.data.status : undefined;
  const items = await listQuotes(auth.merchantId, activeStatus);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">報價管理</h1>
        <Link href={PAGE_ROUTES.dashboard} className="text-sm underline">
          返回 Dashboard
        </Link>
      </div>

      <nav aria-label="狀態篩選" className="flex gap-2 text-sm">
        <Link
          href={ALL_TAB.href}
          aria-current={activeStatus === undefined ? "page" : undefined}
          className="rounded border px-3 py-1 aria-[current=page]:bg-gray-900 aria-[current=page]:text-white"
        >
          {ALL_TAB.label}
        </Link>
        {QUOTE_STATUSES.map((status) => (
          <Link
            key={status}
            href={`${PAGE_ROUTES.dashboardQuotes}?status=${status}`}
            aria-current={activeStatus === status ? "page" : undefined}
            className="rounded border px-3 py-1 aria-[current=page]:bg-gray-900 aria-[current=page]:text-white"
          >
            {QUOTE_STATUS_LABELS[status]}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="text-sm text-gray-600">
          尚無報價。把你的專屬連結傳給客戶，他們送出的需求會出現在這裡。
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">報價列表</caption>
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">報價編號</th>
              <th className="py-2">分類</th>
              <th className="py-2">客戶 Email</th>
              <th className="py-2">金額</th>
              <th className="py-2">狀態</th>
              <th className="py-2">建立時間</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="py-2 font-mono">{item.quote_code}</td>
                <td className="py-2">
                  {item.category === null ? "—" : CASE_CATEGORY_LABELS[item.category]}
                </td>
                <td className="py-2">{item.contact_email ?? "—"}</td>
                <td className="py-2">
                  {formatAmount(item.final_amount)}
                  {item.is_conservative && (
                    <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      保守估算
                    </span>
                  )}
                </td>
                <td className="py-2">{QUOTE_STATUS_LABELS[item.status]}</td>
                <td className="py-2">{formatDateTime(item.created_at)}</td>
                <td className="py-2">
                  <Link
                    href={PAGE_ROUTES.dashboardQuote(item.id)}
                    className="underline"
                  >
                    查看
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 2：詳情頁**

`src/app/dashboard/quotes/[id]/page.tsx`：

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { getQuoteDetail } from "@/domains/pricing/quoteReviewService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";
import { QUOTE_STATUS_LABELS } from "@/shared/constants/quoteStatus.ts";
import { CASE_CATEGORY_LABELS } from "@/shared/constants/categories.ts";
import { fieldLabel } from "@/shared/constants/fieldLabels.ts";
import { PAGE_ROUTES } from "@/shared/constants/routes.ts";
import { formatAmount, formatDateTime } from "../formatters.ts";

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  const { id } = await params;
  const idParsed = quoteIdSchema.safeParse(id);
  if (!idParsed.success) {
    notFound();
  }

  // 查無或非本商家所有一律 404（service 已做歸屬檢查）。
  const detail = await getQuoteDetail(idParsed.data, auth.merchantId);
  if (detail === null) {
    notFound();
  }

  const { quote, session, lineItems, extractedFields, clarifications, rawInputs } =
    detail;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          報價 <span className="font-mono">{quote.quote_code}</span>
        </h1>
        <Link href={PAGE_ROUTES.dashboardQuotes} className="text-sm underline">
          返回報價列表
        </Link>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">報價摘要</h2>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-gray-600">分類</dt>
          <dd>{CASE_CATEGORY_LABELS[session.category]}</dd>
          <dt className="text-gray-600">客戶 Email</dt>
          <dd>{session.contact_email ?? "—"}</dd>
          <dt className="text-gray-600">金額</dt>
          <dd>
            {formatAmount(quote.final_amount)}
            {quote.is_conservative && (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                保守估算（資訊不足，客戶未完成反問）
              </span>
            )}
          </dd>
          <dt className="text-gray-600">狀態</dt>
          <dd>{QUOTE_STATUS_LABELS[quote.status]}</dd>
          <dt className="text-gray-600">建立時間</dt>
          <dd>{formatDateTime(quote.created_at)}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">費用明細</h2>
        {lineItems.length === 0 ? (
          <p className="text-sm text-gray-600">無費用明細</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">費用明細</caption>
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">項目</th>
                <th className="py-2">金額</th>
                <th className="py-2">計價依據</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.id} className="border-b align-top">
                  <td className="py-2">{item.item_name}</td>
                  <td className="py-2">{formatAmount(item.amount)}</td>
                  <td className="py-2 text-gray-600">
                    {item.agent_reasoning ?? "固定費率查表"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">抽取欄位</h2>
        {extractedFields.length === 0 ? (
          <p className="text-sm text-gray-600">無抽取欄位</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">從客戶描述抽取的欄位</caption>
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">欄位</th>
                <th className="py-2">值</th>
                <th className="py-2">信心</th>
                <th className="py-2">來源文字</th>
              </tr>
            </thead>
            <tbody>
              {extractedFields.map((field) => (
                <tr key={field.id} className="border-b align-top">
                  <td className="py-2">{fieldLabel(field.field_name)}</td>
                  <td className="py-2">{field.value ?? "—"}</td>
                  <td className="py-2">
                    {field.confidence === null ? "—" : field.confidence.toFixed(2)}
                  </td>
                  <td className="py-2 text-gray-600">{field.source_span ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">澄清歷程</h2>
        {clarifications.length === 0 ? (
          <p className="text-sm text-gray-600">未觸發反問</p>
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            {clarifications.map((turn) => (
              <li key={turn.id} className="rounded border p-3">
                <p className="text-gray-600">
                  第 {turn.round} 輪 · 觸發欄位：{fieldLabel(turn.triggered_field)}
                </p>
                <p className="mt-1">Q：{turn.question}</p>
                <p className="mt-1">A：{turn.answer ?? "（未回答）"}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">客戶原始描述</h2>
        {rawInputs.length === 0 ? (
          <p className="text-sm text-gray-600">無原始描述</p>
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            {rawInputs.map((input) => (
              <li key={input.id} className="rounded border p-3">
                <p className="text-gray-600">{formatDateTime(input.created_at)}</p>
                <p className="mt-1 whitespace-pre-wrap">{input.raw_text}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 3：Dashboard 待審數改為可點連結**

修改 `src/app/dashboard/page.tsx`：
1. 於 import 區塊加入 `import { PAGE_ROUTES } from "@/shared/constants/routes.ts";`
2. 將這一行

```tsx
      <p className="text-gray-600">待審報價：{pendingCount} 筆</p>
```

替換為

```tsx
      <Link
        href={`${PAGE_ROUTES.dashboardQuotes}?status=awaiting_review`}
        className="text-gray-600 underline"
      >
        待審報價：{pendingCount} 筆
      </Link>
```

3. 於「管理服務項目」連結之前，加入報價列表入口：

```tsx
      <Link href={PAGE_ROUTES.dashboardQuotes} className="text-sm underline">
        報價管理
      </Link>
```

- [ ] **Step 4：型別 + lint + build 驗證**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 三者全綠

- [ ] **Step 5：Commit**

```bash
git add src/app/dashboard/quotes/page.tsx "src/app/dashboard/quotes/[id]/page.tsx" src/app/dashboard/page.tsx
git commit -m "feat(quotes): add quote list and detail pages"
```

---

## Task 8：verify script（對真實 DB 的跨租戶驗證）+ 全綠收尾

**Files:**
- Create: `scripts/verify-quotes.ts`
- Modify: `package.json`

- [ ] **Step 1：寫 verify script**

`scripts/verify-quotes.ts`：

```ts
/**
 * 驗證 5.6 後台報價查詢在真實 DB 上的租戶隔離（MT-M4a 驗收）。
 * 執行：pnpm verify:quotes
 *
 * 證明三件事：
 * 1. listQuotes(B) 只回 B 自己的報價——看不到 A 的。
 * 2. getQuoteDetail(A 的 quote, B 的 merchantId) 回 null（跨租戶取詳情失敗）。
 * 3. getQuoteDetail(A 的 quote, A 的 merchantId) 回完整脈絡（四張子表都撈到）。
 * 結束時無論成敗都清理測試資料（try/finally）。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";
import {
  listQuotes,
  getQuoteDetail,
} from "../src/domains/pricing/quoteReviewService.ts";
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

type Fixture = { merchantId: string; sessionId: string; quoteId: string };

/** 建立一個商家 + 一筆走完流程的報價（含四張子表各一列）。 */
async function createMerchantWithQuote(tag: string): Promise<Fixture> {
  const stamp = `${Date.now()}-${tag}`;
  const email = `verify-quotes-${stamp}@bizmate-test.local`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: "VerifyQuotesTest123",
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`建立測試使用者失敗：${userError?.message}`);
  }
  const merchantId = userData.user.id;

  const { error: merchantError } = await admin.from("merchants").insert({
    id: merchantId,
    display_name: `verify-quotes 商家 ${tag}`,
    public_slug: `verify-quotes-${stamp}`.slice(0, 32),
    contact_email: email,
  });
  if (merchantError) {
    throw new Error(`建立商家列失敗：${merchantError.message}`);
  }

  const { data: session, error: sessionError } = await admin
    .from("sessions")
    .insert({
      merchant_id: merchantId,
      category: "illustration",
      contact_email: `client-${tag}@example.com`,
      status: "awaiting_review",
    })
    .select()
    .single();
  if (sessionError || !session) {
    throw new Error(`建立 session 失敗：${sessionError?.message}`);
  }

  const subTableResults = await Promise.all([
    admin.from("raw_inputs").insert({
      session_id: session.id,
      raw_text: `${tag} 商家的客戶描述`,
    }),
    admin.from("extracted_fields").insert({
      session_id: session.id,
      field_name: "quantity",
      value: "3",
      confidence: 0.9,
      source_span: "三張",
    }),
    admin.from("clarification_turns").insert({
      session_id: session.id,
      round: 1,
      question: "請問授權範圍？",
      answer: "商用",
      triggered_field: "license_scope",
    }),
    admin.from("price_line_items").insert({
      session_id: session.id,
      item_name: "插畫基本費",
      amount: 6000,
    }),
  ]);
  const failed = subTableResults.find((result) => result.error !== null);
  if (failed?.error) {
    throw new Error(`建立子表資料失敗：${failed.error.message}`);
  }

  const { data: quote, error: quoteError } = await admin
    .from("quotes")
    .insert({
      session_id: session.id,
      merchant_id: merchantId,
      quote_code: `I-2607-${tag}`,
      final_amount: 6000,
      status: "awaiting_review",
    })
    .select()
    .single();
  if (quoteError || !quote) {
    throw new Error(`建立 quote 失敗：${quoteError?.message}`);
  }

  return { merchantId, sessionId: session.id, quoteId: quote.id };
}

async function cleanup(fixture: Fixture | null): Promise<void> {
  if (fixture === null) return;
  await admin.from("quotes").delete().eq("id", fixture.quoteId);
  await admin.from("price_line_items").delete().eq("session_id", fixture.sessionId);
  await admin.from("clarification_turns").delete().eq("session_id", fixture.sessionId);
  await admin.from("extracted_fields").delete().eq("session_id", fixture.sessionId);
  await admin.from("raw_inputs").delete().eq("session_id", fixture.sessionId);
  await admin.from("sessions").delete().eq("id", fixture.sessionId);
  await admin.auth.admin.deleteUser(fixture.merchantId).catch(() => {
    console.error(
      `⚠️ 清理測試商家失敗，請至 Supabase Studio 手動刪除 ${fixture.merchantId}`,
    );
  });
}

async function main(): Promise<void> {
  let merchantA: Fixture | null = null;
  let merchantB: Fixture | null = null;

  try {
    merchantA = await createMerchantWithQuote("A");
    merchantB = await createMerchantWithQuote("B");
    console.log("✅ 建立 A / B 兩商家各一筆報價（含四張子表）完成");

    const listB = await listQuotes(merchantB.merchantId);
    assert(listB.length === 1, `B 的列表應只有 1 筆，實際 ${listB.length} 筆`);
    assert(
      listB[0].id === merchantB.quoteId,
      "B 的列表應只包含 B 自己的報價",
    );
    assert(
      listB[0].category === "illustration" && listB[0].contact_email !== null,
      "列表應帶出 session 的 category / contact_email",
    );
    console.log("✅ 列表只回自己的報價，且正確帶出 session 欄位");

    const filtered = await listQuotes(merchantB.merchantId, "sent");
    assert(filtered.length === 0, "B 沒有 sent 狀態的報價，過濾後應為空");
    console.log("✅ status 過濾生效");

    const crossTenant = await getQuoteDetail(
      merchantA.quoteId,
      merchantB.merchantId,
    );
    assert(crossTenant === null, "B 取 A 的報價詳情必須回 null（跨租戶隔離）");
    console.log("✅ 跨租戶取詳情被擋下（回 null → route 轉 404）");

    const owned = await getQuoteDetail(merchantA.quoteId, merchantA.merchantId);
    assert(owned !== null, "A 取自己的報價詳情應成功");
    assert(owned!.session.id === merchantA.sessionId, "詳情的 session 應為該報價的 session");
    assert(owned!.lineItems.length === 1, "應撈到 1 筆費用明細");
    assert(owned!.extractedFields.length === 1, "應撈到 1 筆抽取欄位");
    assert(owned!.clarifications.length === 1, "應撈到 1 輪澄清歷程");
    assert(owned!.rawInputs.length === 1, "應撈到 1 筆原始描述");
    console.log("✅ 本人取詳情成功，四張子表完整聚合");

    console.log("\n🎉 MT-M4a 報價查詢租戶隔離驗收通過。");
  } finally {
    await cleanup(merchantA);
    await cleanup(merchantB);
  }
}

main().catch((error: unknown) => {
  console.error("驗證腳本執行失敗：", error);
  process.exit(1);
});
```

- [ ] **Step 2：註冊 npm script**

修改 `package.json`，在 `"verify:services"` 之後加入：

```json
    "verify:quotes": "tsx --env-file=.env.local scripts/verify-quotes.ts",
```

- [ ] **Step 3：對真實 DB 執行 verify script**

Run: `pnpm verify:quotes`
Expected: 五個 ✅ 後印出 `🎉 MT-M4a 報價查詢租戶隔離驗收通過。`

- [ ] **Step 4：全套測試 + 型別 + lint + build**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 全綠（測試數由 292 增至 315 左右）

- [ ] **Step 5：Commit**

```bash
git add scripts/verify-quotes.ts package.json
git commit -m "test(quotes): verify tenant isolation of quote review against real DB"
```

---

## 完成後

1. 執行 `/verify` 做完整驗證
2. 載入 `sunnydata-code-review` skill 自我審查（重點：安全不變式是否有繞過路徑）
3. 更新 WBS 5.6 為 ✅ 完成，清除 `.current-task`
4. `--no-ff` 併回 `main`，刪除分支

# MT-M4b 調金額 + 確認 Implementation Plan

> **For agentic workers:** 依 superpowers:sunnydata-design 的 Execute Plan 階段逐任務實作。步驟以 checkbox（`- [ ]`）追蹤。

**Goal:** 商家能在後台調整報價金額並確認送出，讓 session 與 quote 原子地推進到 `confirmed`，供 5.8 寄信。

**Architecture:** 應用層（`quoteActionsService`）負責歸屬檢查與狀態機驗證，算出 from/to status 後交給 Postgres RPC 做原子寫入 + CAS。RPC 內不含業務知識——`transitions.ts` 維持狀態機的唯一事實來源。調金額由 RPC 自算差額並寫入「手動調整」明細列，維持 `sum(line_items) == final_amount` 恆成立。

**Tech Stack:** Next.js 16、TypeScript、zod 4、Supabase（service_role client + plpgsql RPC）、Vitest、Tailwind 4

**Spec:** `docs/superpowers/specs/2026-07-11-mt-m4b-quote-confirm-design.md`

---

## Task 1：Migration 0005（兩個原子 RPC）+ 型別宣告

**Files:**
- Create: `supabase/migrations/0005_quote_actions.sql`
- Modify: `src/lib/supabase/database.types.ts`（`Functions` 區塊）

- [ ] **Step 1：寫 migration**

`supabase/migrations/0005_quote_actions.sql`：

```sql
-- ── 後台終審的兩個原子動作（5.7 MT-M4b）────────────────────────
-- 動機：quotes.status 與 sessions.status 是同一份狀態存兩份，而 Supabase JS
--       不提供多語句 transaction。確認動作必須同時推進兩者，否則會出現
--       「列表顯示待審、但 session 已 confirmed」的半套資料。
--
-- 分工原則：RPC 內不放業務知識。合法轉移由應用層的狀態機（transitions.ts）
--       判定後，把 from/to status 當參數傳入；RPC 只負責
--       ① 單一 transaction 的跨表寫入 ② CAS（WHERE status = p_from_status）。
--       若把 awaiting_review → confirmed 硬編進 SQL，狀態機就有兩份定義。
--
-- 授權：0001 的 GRANT 只涵蓋當時已存在的物件，後建的 FUNCTION 必須顯式
--       GRANT EXECUTE 給 service_role，否則呼叫時 permission denied（見 0002）。

BEGIN;

-- 確認報價：原子推進 quotes.status 與 sessions.status。
-- 回傳 TRUE  = 已推進；
-- 回傳 FALSE = CAS 條件不成立（非該商家的報價、或已被確認/寄出、或併發搶先）。
CREATE OR REPLACE FUNCTION confirm_quote(
  p_quote_id    UUID,
  p_merchant_id UUID,
  p_from_status TEXT,
  p_to_status   TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_session_id   UUID;
  v_quote_rows   INTEGER;
  v_session_rows INTEGER;
BEGIN
  -- p_merchant_id 進 WHERE 是防禦縱深第二道（應用層已做歸屬檢查）。
  UPDATE quotes
     SET status = p_to_status::quote_status
   WHERE id = p_quote_id
     AND merchant_id = p_merchant_id
     AND status = p_from_status::quote_status
  RETURNING session_id INTO v_session_id;

  GET DIAGNOSTICS v_quote_rows = ROW_COUNT;
  IF v_quote_rows = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE sessions
     SET status = p_to_status::session_status
   WHERE id = v_session_id
     AND merchant_id = p_merchant_id
     AND status = p_from_status::session_status;

  GET DIAGNOSTICS v_session_rows = ROW_COUNT;
  IF v_session_rows = 0 THEN
    -- 兩表狀態不同步（資料不一致，不該發生）。拋例外讓整個 function 回滾——
    -- 絕不留下「quote 已 confirmed 但 session 沒動」的半套資料。
    RAISE EXCEPTION
      'confirm_quote: session % 不在 % 狀態，已回滾', v_session_id, p_from_status;
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION confirm_quote IS
  '原子確認報價：單一 transaction 內以 CAS 同時推進 quotes.status 與 sessions.status。';

-- 調整最終金額：更新 final_amount，並以「手動調整」明細列補上差額，
-- 使不變式 sum(price_line_items.amount) = quotes.final_amount 恆成立。
-- 回傳 TRUE = 已調整；FALSE = CAS 條件不成立（非該商家、或不在可編輯狀態）。
CREATE OR REPLACE FUNCTION adjust_quote_amount(
  p_quote_id    UUID,
  p_merchant_id UUID,
  p_new_amount  NUMERIC,
  p_from_status TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE
  v_session_id UUID;
  v_base_sum   NUMERIC;
  v_diff       NUMERIC;
  v_rows       INTEGER;
BEGIN
  UPDATE quotes
     SET final_amount = p_new_amount
   WHERE id = p_quote_id
     AND merchant_id = p_merchant_id
     AND status = p_from_status::quote_status
  RETURNING session_id INTO v_session_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN FALSE;
  END IF;

  -- 手動調整列的唯一識別：rule_id 與 modifier_id 皆為 NULL。
  -- 前提（已驗證 basePricing.ts:79-96）：計價產出的明細必帶 rule_id（基礎費）
  -- 或 modifier_id（加成）其中之一。未來若新增兩者皆 NULL 的明細類型，
  -- 必須改這個識別條件，否則會誤刪。
  -- 先刪再插 → 重複調整不累積多列調整。
  DELETE FROM price_line_items
   WHERE session_id = v_session_id
     AND rule_id IS NULL
     AND modifier_id IS NULL;

  SELECT COALESCE(SUM(amount), 0) INTO v_base_sum
    FROM price_line_items
   WHERE session_id = v_session_id;

  v_diff := p_new_amount - v_base_sum;

  -- 差額為 0 時不插入空列（例如商家把金額改回原值）。
  IF v_diff <> 0 THEN
    INSERT INTO price_line_items (session_id, item_name, amount, agent_reasoning)
    VALUES (
      v_session_id,
      '商家手動調整',
      v_diff,
      '商家於後台終審時調整最終金額'
    );
  END IF;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION adjust_quote_amount IS
  '原子調整報價金額：更新 final_amount 並以手動調整明細列補差額，維持明細加總 = 總額。';

GRANT EXECUTE ON FUNCTION confirm_quote(UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION adjust_quote_amount(UUID, UUID, NUMERIC, TEXT) TO service_role;

COMMIT;
```

- [ ] **Step 2：補型別宣告**

修改 `src/lib/supabase/database.types.ts`，在 `Functions` 區塊的 `increment_rate_limit` 之後加入：

```ts
      confirm_quote: {
        Args: {
          p_quote_id: string;
          p_merchant_id: string;
          p_from_status: string;
          p_to_status: string;
        };
        Returns: boolean;
      };
      adjust_quote_amount: {
        Args: {
          p_quote_id: string;
          p_merchant_id: string;
          p_new_amount: number;
          p_from_status: string;
        };
        Returns: boolean;
      };
```

- [ ] **Step 3：型別檢查**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0

- [ ] **Step 4：人工檢查點 —— 手動套用 migration**

⚠️ **這一步必須由使用者執行，不可跳過。** 專案慣例：migration 手動貼到 Supabase SQL Editor 執行。

停下來請使用者：
1. 打開 Supabase Dashboard → SQL Editor
2. 貼上 `supabase/migrations/0005_quote_actions.sql` 全文並 Run
3. 確認無錯誤後回報

未套用的話 Task 8 的 verify script 會以「function does not exist」失敗——這是預期的守門機制，不是 bug。

- [ ] **Step 5：Commit**

```bash
git add supabase/migrations/0005_quote_actions.sql src/lib/supabase/database.types.ts
git commit -m "feat(db): add atomic confirm_quote and adjust_quote_amount RPCs"
```

---

## Task 2：schemas 與結果型別

**Files:**
- Create: `src/domains/pricing/quoteActionsSchemas.ts`
- Test: `src/domains/pricing/quoteActionsSchemas.test.ts`

- [ ] **Step 1：寫失敗的測試**

`src/domains/pricing/quoteActionsSchemas.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { adjustAmountBodySchema } from "./quoteActionsSchemas.ts";

describe("adjustAmountBodySchema", () => {
  it("正數金額通過", () => {
    const result = adjustAmountBodySchema.safeParse({ final_amount: 9000 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.final_amount).toBe(9000);
    }
  });

  it("零或負數失敗", () => {
    expect(adjustAmountBodySchema.safeParse({ final_amount: 0 }).success).toBe(false);
    expect(adjustAmountBodySchema.safeParse({ final_amount: -100 }).success).toBe(false);
  });

  it("缺欄位失敗", () => {
    expect(adjustAmountBodySchema.safeParse({}).success).toBe(false);
  });

  it("字串金額失敗（不做隱式轉型）", () => {
    expect(adjustAmountBodySchema.safeParse({ final_amount: "9000" }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test src/domains/pricing/quoteActionsSchemas.test.ts`
Expected: FAIL — 找不到模組 `./quoteActionsSchemas.ts`

- [ ] **Step 3：寫實作**

`src/domains/pricing/quoteActionsSchemas.ts`：

```ts
import { z } from "zod";
import type { Tables } from "@/lib/supabase/database.types.ts";

/** PATCH /api/dashboard/quotes/{id} 主體：只開放調整最終金額。 */
export const adjustAmountBodySchema = z.object({
  final_amount: z.number().positive("金額須為正數"),
});
export type AdjustAmountBody = z.infer<typeof adjustAmountBodySchema>;

/**
 * 後台動作的結果型別。
 * not_found → route 轉 404（不存在或非本商家所有，不洩漏存在性）
 * conflict  → route 轉 409（報價已確認/已寄出，或併發下被搶先）
 */
export type QuoteActionResult =
  | { readonly ok: true; readonly quote: Tables<"quotes"> }
  | { readonly ok: false; readonly reason: "not_found" | "conflict" };
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test src/domains/pricing/quoteActionsSchemas.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5：Commit**

```bash
git add src/domains/pricing/quoteActionsSchemas.ts src/domains/pricing/quoteActionsSchemas.test.ts
git commit -m "feat(quotes): add quote action schemas and result type"
```

---

## Task 3：quoteActionsRepository（RPC 封裝）

**Files:**
- Create: `src/domains/pricing/repositories/quoteActionsRepository.ts`

無單元測試——與專案其他 repository 一致，正確性由 Task 8 的 verify script 對真實 DB 驗證。

- [ ] **Step 1：寫實作**

`src/domains/pricing/repositories/quoteActionsRepository.ts`：

```ts
import { getSupabaseClient } from "@/lib/supabase/client.ts";
import { RepositoryError } from "@/lib/supabase/repository.ts";
import type { QuoteStatus, SessionStatus } from "@/shared/types/domain.types";

/**
 * 後台終審動作的 repository：封裝兩個原子 RPC（migration 0005）。
 *
 * 這裡刻意不繼承 BaseRepository —— 它提供的是單表 CRUD，而這兩個動作的重點
 * 正是「跨表原子寫入」，用不上也不該用單表 update。
 *
 * RPC 回傳 boolean：FALSE 代表 CAS 條件不成立（非該商家的報價、報價不在
 * 預期狀態、或併發下被搶先），呼叫端一律視為 conflict。
 */

/** 確認報價：原子推進 quotes.status 與 sessions.status。 */
export async function callConfirmQuote(params: {
  quoteId: string;
  merchantId: string;
  fromStatus: SessionStatus;
  toStatus: SessionStatus;
}): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("confirm_quote", {
    p_quote_id: params.quoteId,
    p_merchant_id: params.merchantId,
    p_from_status: params.fromStatus,
    p_to_status: params.toStatus,
  });
  if (error) {
    throw new RepositoryError("quotes", "callConfirmQuote", error.message);
  }
  return data === true;
}

/** 調整金額：更新 final_amount 並以手動調整明細列補差額。 */
export async function callAdjustQuoteAmount(params: {
  quoteId: string;
  merchantId: string;
  newAmount: number;
  fromStatus: QuoteStatus;
}): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc("adjust_quote_amount", {
    p_quote_id: params.quoteId,
    p_merchant_id: params.merchantId,
    p_new_amount: params.newAmount,
    p_from_status: params.fromStatus,
  });
  if (error) {
    throw new RepositoryError("quotes", "callAdjustQuoteAmount", error.message);
  }
  return data === true;
}
```

- [ ] **Step 2：型別檢查**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0

- [ ] **Step 3：Commit**

```bash
git add src/domains/pricing/repositories/quoteActionsRepository.ts
git commit -m "feat(quotes): add quote actions repository wrapping atomic RPCs"
```

---

## Task 4：quoteActionsService（核心）

**Files:**
- Create: `src/domains/pricing/quoteActionsService.ts`
- Test: `src/domains/pricing/quoteActionsService.test.ts`

- [ ] **Step 1：寫失敗的測試**

`src/domains/pricing/quoteActionsService.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("./repositories/quoteReviewRepository.ts", () => ({
  quoteReviewRepository: {
    findById: vi.fn(),
    findSessionById: vi.fn(),
  },
}));

vi.mock("./repositories/quoteActionsRepository.ts", () => ({
  callConfirmQuote: vi.fn(),
  callAdjustQuoteAmount: vi.fn(),
}));

import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import {
  callConfirmQuote,
  callAdjustQuoteAmount,
} from "./repositories/quoteActionsRepository.ts";
import { adjustQuoteAmount, confirmQuote } from "./quoteActionsService.ts";

const repo = vi.mocked(quoteReviewRepository);
const mockConfirm = vi.mocked(callConfirmQuote);
const mockAdjust = vi.mocked(callAdjustQuoteAmount);

const MERCHANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MERCHANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUOTE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
const SESSION_ID = "a3bb189e-8bf9-4888-9912-ace4e6543002";

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("adjustQuoteAmount", () => {
  it("報價不存在 → not_found，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue(null);

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("跨租戶：B 調 A 的報價 → not_found，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_B,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("報價已確認（非 awaiting_review）→ conflict，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue({ ...QUOTE_A, status: "confirmed" });

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("RPC 回 false（併發下被搶先）→ conflict", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    mockAdjust.mockResolvedValue(false);

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("成功 → 回傳更新後的報價，RPC 參數正確", async () => {
    const updated = { ...QUOTE_A, final_amount: 9000 };
    repo.findById
      .mockResolvedValueOnce(QUOTE_A)
      .mockResolvedValueOnce(updated);
    mockAdjust.mockResolvedValue(true);

    const result = await adjustQuoteAmount({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      finalAmount: 9000,
    });

    expect(result).toEqual({ ok: true, quote: updated });
    expect(mockAdjust).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      newAmount: 9000,
      fromStatus: "awaiting_review",
    });
  });
});

describe("confirmQuote", () => {
  it("跨租戶：B 確認 A 的報價 → not_found，且不呼叫 RPC", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_B,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(repo.findSessionById).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("session 屬於其他商家 → not_found", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue({
      ...SESSION_A,
      merchant_id: MERCHANT_B,
    });

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("session 已 confirmed（狀態機不接受 quote_confirmed）→ conflict", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue({
      ...SESSION_A,
      status: "confirmed",
    });

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("RPC 回 false（併發下被搶先）→ conflict", async () => {
    repo.findById.mockResolvedValue(QUOTE_A);
    repo.findSessionById.mockResolvedValue(SESSION_A);
    mockConfirm.mockResolvedValue(false);

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
    });

    expect(result).toEqual({ ok: false, reason: "conflict" });
  });

  it("成功 → from/to status 來自狀態機（非硬編碼），回傳確認後的報價", async () => {
    const confirmed = { ...QUOTE_A, status: "confirmed" as const };
    repo.findById
      .mockResolvedValueOnce(QUOTE_A)
      .mockResolvedValueOnce(confirmed);
    repo.findSessionById.mockResolvedValue(SESSION_A);
    mockConfirm.mockResolvedValue(true);

    const result = await confirmQuote({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
    });

    expect(result).toEqual({ ok: true, quote: confirmed });
    expect(mockConfirm).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_A,
      fromStatus: "awaiting_review",
      toStatus: "confirmed",
    });
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test src/domains/pricing/quoteActionsService.test.ts`
Expected: FAIL — 找不到模組 `./quoteActionsService.ts`

- [ ] **Step 3：寫實作**

`src/domains/pricing/quoteActionsService.ts`：

```ts
import { transition } from "@/orchestrator/stateMachine.ts";
import { quoteReviewRepository } from "./repositories/quoteReviewRepository.ts";
import {
  callConfirmQuote,
  callAdjustQuoteAmount,
} from "./repositories/quoteActionsRepository.ts";
import type { QuoteActionResult } from "./quoteActionsSchemas.ts";

/**
 * 後台終審的兩個寫入動作（5.7）。與唯讀的 quoteReviewService 分開——
 * 「看報價」與「改報價」是不同關注點。
 *
 * 共同流程：
 *   1. 歸屬檢查（重用 quoteReviewRepository.findById，同 5.6 的 404 慣例）
 *   2. 業務規則 / 狀態機驗證 → 不通過即 conflict
 *   3. 呼叫原子 RPC（migration 0005），RPC 以 CAS 擋下併發
 *
 * 狀態機（transitions.ts）是合法轉移的唯一事實來源；RPC 只收 from/to status
 * 當參數，不含業務知識。
 */

/** 可編輯的報價狀態——只有待審中的報價能改金額。 */
const EDITABLE_QUOTE_STATUS = "awaiting_review";

/** 調整最終金額。差額如何攤進明細由 RPC 負責，本層不算錢。 */
export async function adjustQuoteAmount(params: {
  quoteId: string;
  merchantId: string;
  finalAmount: number;
}): Promise<QuoteActionResult> {
  const { quoteId, merchantId, finalAmount } = params;

  const quote = await quoteReviewRepository.findById(quoteId);
  if (quote === null || quote.merchant_id !== merchantId) {
    return { ok: false, reason: "not_found" };
  }
  if (quote.status !== EDITABLE_QUOTE_STATUS) {
    return { ok: false, reason: "conflict" };
  }

  const applied = await callAdjustQuoteAmount({
    quoteId,
    merchantId,
    newAmount: finalAmount,
    fromStatus: EDITABLE_QUOTE_STATUS,
  });
  if (!applied) {
    return { ok: false, reason: "conflict" };
  }

  return reloadQuote(quoteId);
}

/** 確認報價：quote_confirmed 事件落地，原子推進 quote 與 session。 */
export async function confirmQuote(params: {
  quoteId: string;
  merchantId: string;
}): Promise<QuoteActionResult> {
  const { quoteId, merchantId } = params;

  const quote = await quoteReviewRepository.findById(quoteId);
  if (quote === null || quote.merchant_id !== merchantId) {
    return { ok: false, reason: "not_found" };
  }

  // session 是狀態機的載體；歸屬同樣要複查（quotes 的兩個 FK 各自獨立，
  // DB 沒有 composite FK 保證兩者一致——見 5.6 的同名修正）。
  const session = await quoteReviewRepository.findSessionById(quote.session_id);
  if (session === null || session.merchant_id !== merchantId) {
    return { ok: false, reason: "not_found" };
  }

  const next = transition(session.status, "quote_confirmed");
  if (!next.ok) {
    return { ok: false, reason: "conflict" };
  }

  const applied = await callConfirmQuote({
    quoteId,
    merchantId,
    fromStatus: session.status,
    toStatus: next.state,
  });
  if (!applied) {
    return { ok: false, reason: "conflict" };
  }

  return reloadQuote(quoteId);
}

/** RPC 只回 boolean，成功後重讀報價回傳給前端。 */
async function reloadQuote(quoteId: string): Promise<QuoteActionResult> {
  const updated = await quoteReviewRepository.findById(quoteId);
  if (updated === null) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, quote: updated };
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test src/domains/pricing/quoteActionsService.test.ts`
Expected: PASS（10 tests）

- [ ] **Step 5：Commit**

```bash
git add src/domains/pricing/quoteActionsService.ts src/domains/pricing/quoteActionsService.test.ts
git commit -m "feat(quotes): add quote actions service with state machine validation"
```

---

## Task 5：PATCH /api/dashboard/quotes/[id]

**Files:**
- Modify: `src/app/api/dashboard/quotes/[id]/route.ts`（既有 `GET` 不動，新增 `PATCH`）
- Modify: `src/app/api/dashboard/quotes/[id]/route.test.ts`（新增 `PATCH` 的 describe 區塊）

- [ ] **Step 1：寫失敗的測試**

在 `src/app/api/dashboard/quotes/[id]/route.test.ts` 的檔案結尾追加。同時要把檔案開頭的 service mock 補上兩個新函式——把既有的

```ts
vi.mock("@/domains/pricing/quoteReviewService.ts", () => ({
  getQuoteDetail: vi.fn(),
}));
```

之後補上：

```ts
vi.mock("@/domains/pricing/quoteActionsService.ts", () => ({
  adjustQuoteAmount: vi.fn(),
  confirmQuote: vi.fn(),
}));
```

並在 import 區塊補：

```ts
import { adjustQuoteAmount } from "@/domains/pricing/quoteActionsService.ts";
import { GET, PATCH } from "./route.ts";
```

（原本的 `import { GET } from "./route.ts";` 改為上面這行。）

在 mock 別名區塊補：

```ts
const mockAdjustQuoteAmount = vi.mocked(adjustQuoteAmount);

const UPDATED_QUOTE = { ...DETAIL.quote, final_amount: 9000 };

function patchRequest(body: unknown, raw = false): Request {
  return new Request(`http://localhost/api/dashboard/quotes/${QUOTE_ID}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}
```

檔案結尾追加：

```ts
describe("PATCH /api/dashboard/quotes/[id]", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(401);
    expect(mockAdjustQuoteAmount).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(403);
  });

  it("id 非 UUID → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams("bad-id"));

    expect(res.status).toBe(400);
    expect(mockAdjustQuoteAmount).not.toHaveBeenCalled();
  });

  it("body 非合法 JSON → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await PATCH(patchRequest("{not json", true), routeParams(QUOTE_ID));

    expect(res.status).toBe(400);
  });

  it("金額非正數 → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await PATCH(patchRequest({ final_amount: -1 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(400);
    expect(mockAdjustQuoteAmount).not.toHaveBeenCalled();
  });

  it("跨租戶或不存在 → 404", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockAdjustQuoteAmount.mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(404);
  });

  it("報價已確認/已寄出 → 409", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockAdjustQuoteAmount.mockResolvedValue({ ok: false, reason: "conflict" });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(409);
  });

  it("成功 → 200，回傳更新後的報價", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockAdjustQuoteAmount.mockResolvedValue({ ok: true, quote: UPDATED_QUOTE });

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.quote).toEqual(UPDATED_QUOTE);
    expect(mockAdjustQuoteAmount).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_ID,
      finalAmount: 9000,
    });
  });

  it("service 拋錯 → 500", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockAdjustQuoteAmount.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await PATCH(patchRequest({ final_amount: 9000 }), routeParams(QUOTE_ID));

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test "src/app/api/dashboard/quotes/[id]/route.test.ts"`
Expected: FAIL — `PATCH` is not a function（route 尚未匯出）

- [ ] **Step 3：寫實作**

在 `src/app/api/dashboard/quotes/[id]/route.ts` 的 import 區塊補：

```ts
import { adjustQuoteAmount } from "@/domains/pricing/quoteActionsService.ts";
import { adjustAmountBodySchema } from "@/domains/pricing/quoteActionsSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";
```

在檔案結尾追加：

```ts
/**
 * PATCH /api/dashboard/quotes/{id} — 調整最終金額（限 awaiting_review）。
 * 404：不存在或非本商家所有；409：報價已確認/已寄出，或併發下被搶先。
 */
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
  const idParsed = quoteIdSchema.safeParse(id);
  if (!idParsed.success) {
    return apiFail("報價 id 格式不正確", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = adjustAmountBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const result = await adjustQuoteAmount({
      quoteId: idParsed.data,
      merchantId: auth.merchantId,
      finalAmount: parsed.data.final_amount,
    });
    if (!result.ok) {
      return result.reason === "not_found"
        ? apiFail("找不到指定的報價", 404)
        : apiFail("這張報價已確認或寄出，無法再調整金額", 409);
    }
    return apiOk({ quote: result.quote });
  } catch (error) {
    console.error("[PATCH /api/dashboard/quotes/:id] 調整金額失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
```

- [ ] **Step 4：執行測試確認通過**

Run: `pnpm test "src/app/api/dashboard/quotes/[id]/route.test.ts"`
Expected: PASS（15 tests —— 既有 GET 的 6 條 + 新增 PATCH 的 9 條）

- [ ] **Step 5：Commit**

```bash
git add "src/app/api/dashboard/quotes/[id]/route.ts" "src/app/api/dashboard/quotes/[id]/route.test.ts"
git commit -m "feat(quotes): add PATCH endpoint for adjusting quote amount"
```

---

## Task 6：POST /api/dashboard/quotes/[id]/confirm

**Files:**
- Create: `src/app/api/dashboard/quotes/[id]/confirm/route.ts`
- Test: `src/app/api/dashboard/quotes/[id]/confirm/route.test.ts`
- Modify: `src/shared/constants/routes.ts`

- [ ] **Step 1：寫失敗的測試**

`src/app/api/dashboard/quotes/[id]/confirm/route.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/lib/auth/requireMerchant.ts", () => ({
  requireMerchant: vi.fn(),
}));

vi.mock("@/domains/pricing/quoteActionsService.ts", () => ({
  confirmQuote: vi.fn(),
}));

import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { confirmQuote } from "@/domains/pricing/quoteActionsService.ts";
import { POST } from "./route.ts";

const mockRequireMerchant = vi.mocked(requireMerchant);
const mockConfirmQuote = vi.mocked(confirmQuote);

const MERCHANT_ID = "99999999-9999-4999-8999-999999999999";
const QUOTE_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

const CONFIRMED_QUOTE: Tables<"quotes"> = {
  id: QUOTE_ID,
  session_id: "a3bb189e-8bf9-4888-9912-ace4e6543002",
  merchant_id: MERCHANT_ID,
  quote_code: "I-2607-001",
  final_amount: 9000,
  status: "confirmed",
  pdf_url: null,
  created_at: "2026-07-11T02:00:00.000Z",
  sent_at: null,
  is_conservative: false,
};

function postRequest(): Request {
  return new Request(
    `http://localhost/api/dashboard/quotes/${QUOTE_ID}/confirm`,
    { method: "POST" },
  );
}

function routeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/dashboard/quotes/[id]/confirm", () => {
  it("未登入 → 401", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 401 });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(401);
    expect(mockConfirmQuote).not.toHaveBeenCalled();
  });

  it("已登入無 merchant → 403", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: false, status: 403 });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(403);
  });

  it("id 非 UUID → 400", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });

    const res = await POST(postRequest(), routeParams("bad-id"));

    expect(res.status).toBe(400);
    expect(mockConfirmQuote).not.toHaveBeenCalled();
  });

  it("跨租戶或不存在 → 404", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockConfirmQuote.mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(404);
  });

  it("已確認過（狀態機不接受）→ 409", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockConfirmQuote.mockResolvedValue({ ok: false, reason: "conflict" });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(409);
  });

  it("成功 → 200，報價狀態為 confirmed", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockConfirmQuote.mockResolvedValue({ ok: true, quote: CONFIRMED_QUOTE });

    const res = await POST(postRequest(), routeParams(QUOTE_ID));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.quote.status).toBe("confirmed");
    expect(mockConfirmQuote).toHaveBeenCalledWith({
      quoteId: QUOTE_ID,
      merchantId: MERCHANT_ID,
    });
  });

  it("service 拋錯 → 500", async () => {
    mockRequireMerchant.mockResolvedValue({ ok: true, merchantId: MERCHANT_ID });
    mockConfirmQuote.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(postRequest(), routeParams(QUOTE_ID));

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2：執行測試確認失敗**

Run: `pnpm test "src/app/api/dashboard/quotes/[id]/confirm/route.test.ts"`
Expected: FAIL — 找不到模組 `./route.ts`

- [ ] **Step 3：寫實作**

`src/app/api/dashboard/quotes/[id]/confirm/route.ts`：

```ts
import { apiOk, apiFail } from "@/lib/api/response.ts";
import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { confirmQuote } from "@/domains/pricing/quoteActionsService.ts";
import { quoteIdSchema } from "@/domains/pricing/quoteReviewSchemas.ts";

/**
 * POST /api/dashboard/quotes/{id}/confirm — 商家終審確認。
 * quote_confirmed 事件落地：原子推進 quotes.status 與 sessions.status → confirmed。
 * 404：不存在或非本商家所有；409：狀態機不接受（已確認/已寄出），或併發下被搶先。
 */
export async function POST(
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
    const result = await confirmQuote({
      quoteId: idParsed.data,
      merchantId: auth.merchantId,
    });
    if (!result.ok) {
      return result.reason === "not_found"
        ? apiFail("找不到指定的報價", 404)
        : apiFail("這張報價已確認或寄出，請重新整理後查看", 409);
    }
    return apiOk({ quote: result.quote });
  } catch (error) {
    console.error("[POST /api/dashboard/quotes/:id/confirm] 確認失敗：", error);
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
```

- [ ] **Step 4：補路由常數**

修改 `src/shared/constants/routes.ts`，在 `API_ROUTES` 的 `dashboardQuote` 之後加入：

```ts
  dashboardQuoteConfirm: (id: string) => `/api/dashboard/quotes/${id}/confirm`,
```

- [ ] **Step 5：執行測試確認通過**

Run: `pnpm test "src/app/api/dashboard/quotes/[id]/confirm/route.test.ts"`
Expected: PASS（7 tests）

- [ ] **Step 6：Commit**

```bash
git add "src/app/api/dashboard/quotes/[id]/confirm" src/shared/constants/routes.ts
git commit -m "feat(quotes): add POST confirm endpoint landing quote_confirmed event"
```

---

## Task 7：詳情頁操作區（client component）

**Files:**
- Create: `src/app/dashboard/quotes/[id]/QuoteActions.tsx`
- Modify: `src/app/dashboard/quotes/[id]/page.tsx`

無單元測試——與專案既有頁面元件慣例一致（5.5 的 ServicesTable、5.6 的兩個頁面皆無）。

- [ ] **Step 1：寫 client component**

`src/app/dashboard/quotes/[id]/QuoteActions.tsx`：

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { API_ROUTES } from "@/shared/constants/routes.ts";

/**
 * 待審報價的操作區（調金額 + 確認）。
 * 僅在 quote.status === "awaiting_review" 時由詳情頁掛載——
 * 已確認/已寄出的報價是唯讀的，不渲染本元件。
 */
export function QuoteActions({
  quoteId,
  initialAmount,
}: {
  quoteId: string;
  initialAmount: number | null;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(initialAmount ?? ""));
  const [pending, setPending] = useState<"none" | "save" | "confirm">("none");
  const [error, setError] = useState("");

  async function handleSave(): Promise<void> {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("金額須為正數");
      return;
    }

    setPending("save");
    setError("");
    try {
      const res = await fetch(API_ROUTES.dashboardQuote(quoteId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ final_amount: parsed }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "儲存失敗");
        return;
      }
      router.refresh();
    } catch {
      setError("網路異常，請稍後再試");
    } finally {
      setPending("none");
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!window.confirm("確認後將無法再調整金額，確定要確認這張報價嗎？")) {
      return;
    }

    setPending("confirm");
    setError("");
    try {
      const res = await fetch(API_ROUTES.dashboardQuoteConfirm(quoteId), {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "確認失敗");
        return;
      }
      router.refresh();
    } catch {
      setError("網路異常，請稍後再試");
    } finally {
      setPending("none");
    }
  }

  const busy = pending !== "none";

  return (
    <section className="flex flex-col gap-3 rounded border p-4">
      <h2 className="text-lg font-medium">終審操作</h2>

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          最終金額（NT$）
          <input
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={busy}
            className="w-40 rounded border px-2 py-1 disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          {pending === "save" ? "儲存中…" : "儲存金額"}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={busy}
          className="rounded bg-gray-900 px-3 py-1 text-white disabled:opacity-50"
        >
          {pending === "confirm" ? "確認中…" : "確認報價"}
        </button>
      </div>

      <p className="text-xs text-gray-600">
        調整金額後，差額會以「商家手動調整」列入費用明細，客戶看到的明細加總與總額一致。
      </p>

      {error !== "" && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 2：掛上詳情頁**

修改 `src/app/dashboard/quotes/[id]/page.tsx`：

1. import 區塊補：

```tsx
import { QuoteActions } from "./QuoteActions.tsx";
```

2. 在「報價摘要」的 `</section>` 之後、「費用明細」的 `<section>` 之前，插入：

```tsx
      {quote.status === "awaiting_review" && (
        <QuoteActions quoteId={quote.id} initialAmount={quote.final_amount} />
      )}
```

- [ ] **Step 3：型別 + lint + build 驗證**

Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 三者全綠

- [ ] **Step 4：Commit**

```bash
git add "src/app/dashboard/quotes/[id]/QuoteActions.tsx" "src/app/dashboard/quotes/[id]/page.tsx"
git commit -m "feat(quotes): add review actions UI to quote detail page"
```

---

## Task 8：verify script（對真實 DB 證明原子性）+ 全綠收尾

**Files:**
- Create: `scripts/verify-quote-actions.ts`
- Modify: `package.json`

- [ ] **Step 1：寫 verify script**

`scripts/verify-quote-actions.ts`：

```ts
/**
 * 驗證 migration 0005 的兩個原子 RPC 在真實 DB 上的行為（5.7 MT-M4b 驗收）。
 * 執行：pnpm verify:quote-actions
 *
 * 證明五件事：
 * 1. 調金額後 sum(price_line_items) == quotes.final_amount（不變式成立）。
 * 2. 重複調金額不累積多筆「手動調整」列（先刪再插）。
 * 3. 確認後 quotes.status 與 sessions.status 同步推進為 confirmed（原子）。
 * 4. 重複確認回 FALSE（CAS 擋下；併發下的第二個呼叫者）。
 * 5. 跨租戶：以 B 的 merchantId 呼叫 RPC 動 A 的報價 → FALSE 且資料不變。
 * 結束時無論成敗都清理測試資料（try/finally）。
 *
 * 前提：migration 0005 已套用至 Supabase。未套用會以
 * 「function ... does not exist」失敗——這是預期的守門機制。
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "../src/lib/env.ts";
import {
  adjustQuoteAmount,
  confirmQuote,
} from "../src/domains/pricing/quoteActionsService.ts";
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

/** 建立一個商家 + 一筆待審報價（兩筆明細，加總 8000）。 */
async function createMerchantWithQuote(tag: string): Promise<Fixture> {
  const stamp = `${Date.now()}-${tag.toLowerCase()}`;
  const email = `verify-actions-${stamp}@bizmate-test.local`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: "VerifyActionsTest123",
    email_confirm: true,
  });
  if (userError || !userData.user) {
    throw new Error(`建立測試使用者失敗：${userError?.message}`);
  }
  const merchantId = userData.user.id;

  try {
    const { error: merchantError } = await admin.from("merchants").insert({
      id: merchantId,
      display_name: `verify-actions 商家 ${tag}`,
      // public_slug 只收小寫（0001 的 CHECK 約束）。
      public_slug: `verify-actions-${stamp}`.slice(0, 32),
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
        subtype: `verify-actions-${tag.toLowerCase()}`,
        unit: "件",
        base_price: 6000,
      })
      .select()
      .single();
    if (rateCardError || !rateCard) {
      throw new Error(`建立 rate_card_base 失敗：${rateCardError?.message}`);
    }

    const { data: session, error: sessionError } = await admin
      .from("sessions")
      .insert({
        merchant_id: merchantId,
        category: "illustration",
        contact_email: `client-${tag.toLowerCase()}@example.com`,
        status: "awaiting_review",
      })
      .select()
      .single();
    if (sessionError || !session) {
      throw new Error(`建立 session 失敗：${sessionError?.message}`);
    }

    // 兩筆明細，加總 8000：基礎費帶 rule_id、加成帶 modifier_id ——
    // 兩者皆非「手動調整」列（rule_id 與 modifier_id 皆 NULL），不該被 RPC 刪掉。
    const { data: modifier, error: modifierError } = await admin
      .from("rate_card_modifiers")
      .insert({
        merchant_id: merchantId,
        category: "illustration",
        modifier_name: `verify-actions-${tag.toLowerCase()}`,
        trigger_condition: "急件",
        range_min: 0.2,
        range_max: 0.5,
      })
      .select()
      .single();
    if (modifierError || !modifier) {
      throw new Error(`建立 rate_card_modifiers 失敗：${modifierError?.message}`);
    }

    const { error: lineItemsError } = await admin.from("price_line_items").insert([
      {
        session_id: session.id,
        item_name: "插畫基本費",
        amount: 6000,
        rule_id: rateCard.id,
      },
      {
        session_id: session.id,
        item_name: "急件加成",
        amount: 2000,
        modifier_id: modifier.id,
      },
    ]);
    if (lineItemsError) {
      throw new Error(`建立 price_line_items 失敗：${lineItemsError.message}`);
    }

    const { data: quote, error: quoteError } = await admin
      .from("quotes")
      .insert({
        session_id: session.id,
        merchant_id: merchantId,
        quote_code: `I-2607-${tag}`,
        final_amount: 8000,
        status: "awaiting_review",
      })
      .select()
      .single();
    if (quoteError || !quote) {
      throw new Error(`建立 quote 失敗：${quoteError?.message}`);
    }

    return { merchantId, sessionId: session.id, quoteId: quote.id };
  } catch (error) {
    // fixture 建到一半失敗 → 先刪 auth 使用者（merchants 對其 ON DELETE CASCADE），
    // 不留孤兒帳號。
    await admin.auth.admin.deleteUser(merchantId).catch(() => {});
    throw error;
  }
}

/** 該 session 的明細加總。 */
async function sumLineItems(sessionId: string): Promise<number> {
  const { data, error } = await admin
    .from("price_line_items")
    .select("amount")
    .eq("session_id", sessionId);
  if (error) {
    throw new Error(`查詢明細失敗：${error.message}`);
  }
  return (data ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
}

/** 該 session 的「手動調整」列數（rule_id 與 modifier_id 皆 NULL）。 */
async function countAdjustmentRows(sessionId: string): Promise<number> {
  const { count, error } = await admin
    .from("price_line_items")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .is("rule_id", null)
    .is("modifier_id", null);
  if (error) {
    throw new Error(`查詢調整列失敗：${error.message}`);
  }
  return count ?? 0;
}

async function cleanup(fixture: Fixture | null): Promise<void> {
  if (fixture === null) return;
  await admin.from("quotes").delete().eq("id", fixture.quoteId);
  await admin.from("price_line_items").delete().eq("session_id", fixture.sessionId);
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
    console.log("✅ 建立 A / B 兩商家各一筆待審報價（明細加總 8000）完成");

    // ① 調金額 → 不變式成立
    const adjusted = await adjustQuoteAmount({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
      finalAmount: 9000,
    });
    assert(adjusted.ok, "A 調整自己的報價金額應成功");
    assert(
      adjusted.ok && Number(adjusted.quote.final_amount) === 9000,
      "final_amount 應更新為 9000",
    );
    assert(
      (await sumLineItems(merchantA.sessionId)) === 9000,
      "明細加總應等於 final_amount（9000）",
    );
    assert(
      (await countAdjustmentRows(merchantA.sessionId)) === 1,
      "應插入 1 筆手動調整列（差額 +1000）",
    );
    console.log("✅ 調金額後 sum(line_items) == final_amount，調整列 1 筆");

    // ② 重複調金額 → 不累積調整列
    const readjusted = await adjustQuoteAmount({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
      finalAmount: 7000,
    });
    assert(readjusted.ok, "再次調整金額應成功");
    assert(
      (await sumLineItems(merchantA.sessionId)) === 7000,
      "重調後明細加總應等於 7000",
    );
    assert(
      (await countAdjustmentRows(merchantA.sessionId)) === 1,
      "重複調整不應累積多筆調整列（先刪再插）",
    );
    console.log("✅ 重複調金額不累積調整列，不變式維持");

    // ③ 跨租戶：B 動 A 的報價
    const crossAdjust = await adjustQuoteAmount({
      quoteId: merchantA.quoteId,
      merchantId: merchantB.merchantId,
      finalAmount: 99999,
    });
    assert(
      !crossAdjust.ok && crossAdjust.reason === "not_found",
      "B 調 A 的報價金額必須回 not_found",
    );
    assert(
      (await sumLineItems(merchantA.sessionId)) === 7000,
      "跨租戶調整失敗後，A 的資料不得被改動",
    );

    const crossConfirm = await confirmQuote({
      quoteId: merchantA.quoteId,
      merchantId: merchantB.merchantId,
    });
    assert(
      !crossConfirm.ok && crossConfirm.reason === "not_found",
      "B 確認 A 的報價必須回 not_found",
    );
    console.log("✅ 跨租戶調金額/確認皆被擋下，且資料未被改動");

    // ④ 確認 → 兩個 status 同步推進
    const confirmed = await confirmQuote({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
    });
    assert(confirmed.ok, "A 確認自己的報價應成功");
    assert(
      confirmed.ok && confirmed.quote.status === "confirmed",
      "quotes.status 應為 confirmed",
    );

    const { data: session } = await admin
      .from("sessions")
      .select("status")
      .eq("id", merchantA.sessionId)
      .single();
    assert(
      session?.status === "confirmed",
      `sessions.status 應同步為 confirmed，實際：${session?.status}`,
    );
    console.log("✅ 確認後 quotes.status 與 sessions.status 原子同步為 confirmed");

    // ⑤ 重複確認 → CAS 擋下
    const reconfirm = await confirmQuote({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
    });
    assert(
      !reconfirm.ok && reconfirm.reason === "conflict",
      "重複確認必須回 conflict（狀態機不接受 / CAS 擋下）",
    );

    // 已確認的報價不可再調金額
    const adjustAfterConfirm = await adjustQuoteAmount({
      quoteId: merchantA.quoteId,
      merchantId: merchantA.merchantId,
      finalAmount: 5000,
    });
    assert(
      !adjustAfterConfirm.ok && adjustAfterConfirm.reason === "conflict",
      "已確認的報價不可再調金額",
    );
    assert(
      (await sumLineItems(merchantA.sessionId)) === 7000,
      "確認後的報價金額不得被改動",
    );
    console.log("✅ 重複確認與確認後調金額皆被擋下，資料未被改動");

    console.log("\n🎉 MT-M4b 原子 RPC 與租戶隔離驗收通過。");
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

修改 `package.json`，在 `"verify:quotes"` 之後加入：

```json
    "verify:quote-actions": "tsx --env-file=.env.local scripts/verify-quote-actions.ts",
```

- [ ] **Step 3：對真實 DB 執行 verify script**

Run: `pnpm verify:quote-actions`
Expected: 六個 ✅ 後印出 `🎉 MT-M4b 原子 RPC 與租戶隔離驗收通過。`

若出現 `function confirm_quote does not exist`，代表 Task 1 Step 4 的 migration 尚未套用——停下來請使用者套用，不要繞過。

- [ ] **Step 4：全套測試 + 型別 + lint + build**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Expected: 全綠（測試數由 320 增至 350 左右）

- [ ] **Step 5：Commit**

```bash
git add scripts/verify-quote-actions.ts package.json
git commit -m "test(quotes): verify atomic RPCs and tenant isolation against real DB"
```

---

## 完成後

1. 載入 `sunnydata-code-review` skill 自我審查（重點：RPC 是否洩漏業務知識、CAS 是否真能擋併發）
2. 更新 WBS 5.7 為 ✅ 完成，清除 `.current-task`
3. `--no-ff` 併回 `main`，刪除分支
4. MT-M4 里程碑（後台終審）完成 → 下一個是 5.8 MT-M5 Email 寄送

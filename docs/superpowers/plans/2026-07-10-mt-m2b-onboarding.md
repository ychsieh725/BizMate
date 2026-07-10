# MT-M2b Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or the Execute Plan phase of superpowers:sunnydata-design to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用者登入後透過 `/onboarding` 建立自己的 `merchants` 列（slug 自動生成）+ 複製範本價目表；middleware 依「是否已有 merchant」在 `/dashboard`、`/onboarding`、`/login`、`/signup` 間正確導流。

**Architecture:** slug 生成與碰撞重試抽成純函式（`slugGenerator.ts`，`isTaken`/`random` 皆可注入，脫離 DB 可測）；`onboardMerchant` 是獨立檔案（非塞進既有 `onboardingService.ts`），透過 import 呼叫既有 `copyTemplateRateCard`，確保測試時能乾淨 mock 掉範本複製；`POST /api/dashboard/onboarding` 走真實 REST route + service 薄分層（同 `/api/sessions` 慣例，非 Server Action）；`decideRedirect` 擴充 `hasMerchant` 參數（預設 `true` 保證舊測試全數不動）。

**Tech Stack:** Next.js 16 App Router、vitest、zod。

**Spec 依據：** `docs/superpowers/specs/2026-07-10-mt-m2b-onboarding-design.md`

**與 spec 的一處落差（可測試性調整）：** spec 寫「新增 onboardMerchant()」語意上暗示塞進既有 `onboardingService.ts`。實際執行改為獨立新檔 `src/domains/merchant/onboardMerchant.ts`，import 既有 `copyTemplateRateCard`（`onboardingService.ts` 完全不動）。原因：若同檔案內互相呼叫，vitest 的 `vi.mock` 無法攔截同模組內的函式呼叫（mock 只對外部 import 者生效），會導致測試 `onboardMerchant` 時意外觸發真實的 `copyTemplateRateCard`（進而觸發真實 DB 呼叫）。拆檔後可乾淨 mock，也更符合 coding-style.md「多個小檔案 > 少數大檔案、高內聚低耦合」。

---

### Task 1: slug 生成純函式（TDD）

**Files:**
- Create: `src/domains/merchant/slugGenerator.ts`
- Test: `src/domains/merchant/slugGenerator.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect, vi } from "vitest";
import {
  sanitizeEmailPrefix,
  slugBaseFromEmail,
  randomSlugBase,
  generateUniqueSlug,
  ADJECTIVES,
  NOUNS,
} from "./slugGenerator.ts";

describe("sanitizeEmailPrefix", () => {
  it("轉小寫並去除非英數字元", () => {
    expect(sanitizeEmailPrefix("Zhang.Wei+test@gmail.com")).toBe(
      "zhangweitest",
    );
  });

  it("中文字元全部去除，僅保留數字", () => {
    expect(sanitizeEmailPrefix("老板123@gmail.com")).toBe("123");
  });

  it("純中文前綴清洗後為空字串", () => {
    expect(sanitizeEmailPrefix("老板@gmail.com")).toBe("");
  });

  it("超長前綴截斷至 20 字元", () => {
    const longPrefix = "a".repeat(30);
    expect(sanitizeEmailPrefix(`${longPrefix}@gmail.com`)).toHaveLength(20);
  });
});

describe("slugBaseFromEmail", () => {
  it("清洗後長度足夠時直接採用", () => {
    expect(slugBaseFromEmail("abc123@gmail.com")).toBe("abc123");
  });

  it("清洗後長度恰為 3 時仍採用（不觸發 fallback）", () => {
    expect(slugBaseFromEmail("老板123@gmail.com")).toBe("123");
  });

  it("清洗後長度不足 3 時改用隨機詞組", () => {
    const random = () => 0;
    const result = slugBaseFromEmail("老板@gmail.com", random);
    expect(result).toBe(`${ADJECTIVES[0]}-${NOUNS[0]}-0000`);
  });
});

describe("randomSlugBase", () => {
  it("random 恆回 0 時取第一個形容詞/名詞 + 0000", () => {
    expect(randomSlugBase(() => 0)).toBe(`${ADJECTIVES[0]}-${NOUNS[0]}-0000`);
  });

  it("random 恆接近 1 時取最後一個形容詞/名詞", () => {
    const result = randomSlugBase(() => 0.9999);
    expect(result).toContain(ADJECTIVES[ADJECTIVES.length - 1]);
    expect(result).toContain(NOUNS[NOUNS.length - 1]);
  });
});

describe("generateUniqueSlug", () => {
  it("基底未被使用時直接回傳", async () => {
    const isTaken = vi.fn().mockResolvedValue(false);
    const result = await generateUniqueSlug("abc123@gmail.com", isTaken);
    expect(result).toBe("abc123");
    expect(isTaken).toHaveBeenCalledTimes(1);
  });

  it("基底碰撞時加數字後綴重試", async () => {
    const isTaken = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const result = await generateUniqueSlug(
      "abc123@gmail.com",
      isTaken,
      () => 0,
    );
    expect(result).toBe("abc123-000");
  });

  it("數字後綴 5 次都碰撞後改用完全隨機詞組", async () => {
    const isTaken = vi
      .fn()
      .mockResolvedValueOnce(true) // base
      .mockResolvedValueOnce(true) // suffix 1
      .mockResolvedValueOnce(true) // suffix 2
      .mockResolvedValueOnce(true) // suffix 3
      .mockResolvedValueOnce(true) // suffix 4
      .mockResolvedValueOnce(true) // suffix 5
      .mockResolvedValueOnce(false); // random fallback 1
    const result = await generateUniqueSlug(
      "abc123@gmail.com",
      isTaken,
      () => 0,
    );
    expect(result).toBe(`${ADJECTIVES[0]}-${NOUNS[0]}-0000`);
    expect(isTaken).toHaveBeenCalledTimes(7);
  });

  it("全部候選都碰撞時拋出例外", async () => {
    const isTaken = vi.fn().mockResolvedValue(true);
    await expect(
      generateUniqueSlug("abc123@gmail.com", isTaken, () => 0),
    ).rejects.toThrow("無法產生唯一 slug");
    expect(isTaken).toHaveBeenCalledTimes(11);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/domains/merchant/slugGenerator.test.ts`
Expected: FAIL（找不到模組）

- [ ] **Step 3: 寫最小實作**

```ts
/**
 * slug 生成：優先用商家帳號 email 前綴，清洗後太短則改用隨機詞組。
 * isTaken 由呼叫端注入（實際查 DB），本模組不碰網路，可獨立測試。
 */

export const ADJECTIVES = [
  "swift", "brave", "calm", "eager", "gentle",
  "happy", "jolly", "kind", "lively", "merry",
  "nimble", "proud", "quiet", "rapid", "sunny",
  "tidy", "vivid", "warm", "witty", "zesty",
] as const;

export const NOUNS = [
  "fox", "otter", "panda", "eagle", "tiger",
  "koala", "falcon", "dolphin", "lynx", "heron",
  "badger", "wren", "orca", "puma", "raven",
  "seal", "hawk", "ibis", "mole", "yak",
] as const;

const EMAIL_PREFIX_MAX_LENGTH = 20;
const MIN_VALID_PREFIX_LENGTH = 3;
const SUFFIX_RETRY_ATTEMPTS = 5;
const RANDOM_FALLBACK_ATTEMPTS = 5;

function randomIndex(random: () => number, length: number): number {
  return Math.floor(random() * length);
}

function randomDigits(random: () => number, length: number): string {
  const max = 10 ** length;
  return String(randomIndex(random, max)).padStart(length, "0");
}

/** 清洗 email 前綴：轉小寫、只保留 [a-z0-9]，截斷至安全長度。 */
export function sanitizeEmailPrefix(email: string): string {
  const prefix = email.split("@")[0] ?? "";
  return prefix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, EMAIL_PREFIX_MAX_LENGTH);
}

/** 完全隨機的形容詞-名詞-4 位數字組合，當清洗結果太短時的 fallback。 */
export function randomSlugBase(random: () => number = Math.random): string {
  const adjective = ADJECTIVES[randomIndex(random, ADJECTIVES.length)];
  const noun = NOUNS[randomIndex(random, NOUNS.length)];
  return `${adjective}-${noun}-${randomDigits(random, 4)}`;
}

/** slug 候選基底：優先用清洗後的 email 前綴，太短（< 3 字元）則用隨機詞組。 */
export function slugBaseFromEmail(
  email: string,
  random: () => number = Math.random,
): string {
  const cleaned = sanitizeEmailPrefix(email);
  return cleaned.length >= MIN_VALID_PREFIX_LENGTH
    ? cleaned
    : randomSlugBase(random);
}

/**
 * 產生唯一 slug。基底撞了先加數字後綴重試，仍撞改完全隨機詞組重試；
 * 全部撞光（機率上不可能）則拋出例外，由呼叫端轉為系統錯誤回應。
 */
export async function generateUniqueSlug(
  email: string,
  isTaken: (candidate: string) => Promise<boolean>,
  random: () => number = Math.random,
): Promise<string> {
  const base = slugBaseFromEmail(email, random);
  if (!(await isTaken(base))) {
    return base;
  }

  for (let i = 0; i < SUFFIX_RETRY_ATTEMPTS; i++) {
    const candidate = `${base}-${randomDigits(random, 3)}`;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  for (let i = 0; i < RANDOM_FALLBACK_ATTEMPTS; i++) {
    const candidate = randomSlugBase(random);
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }

  throw new Error("無法產生唯一 slug（重試次數已達上限）");
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/domains/merchant/slugGenerator.test.ts`
Expected: PASS（13 tests）

- [ ] **Step 5: Commit**

```bash
git add src/domains/merchant/slugGenerator.ts src/domains/merchant/slugGenerator.test.ts
git commit -m "feat(onboarding): 新增 slug 生成純函式（email 前綴 + 隨機 fallback + 碰撞重試）"
```

---

### Task 2: onboardMerchant（TDD）

**Files:**
- Create: `src/domains/merchant/onboardMerchant.ts`
- Test: `src/domains/merchant/onboardMerchant.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tables } from "@/lib/supabase/database.types.ts";

vi.mock("@/domains/merchant/repositories/merchantsRepository.ts", () => ({
  merchantsRepository: {
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/domains/merchant/onboardingService.ts", () => ({
  copyTemplateRateCard: vi.fn(),
}));

import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { copyTemplateRateCard } from "@/domains/merchant/onboardingService.ts";
import { onboardMerchant } from "./onboardMerchant.ts";

const mockFindById = vi.mocked(merchantsRepository.findById);
const mockFindBySlug = vi.mocked(merchantsRepository.findBySlug);
const mockCreate = vi.mocked(merchantsRepository.create);
const mockCopyTemplateRateCard = vi.mocked(copyTemplateRateCard);

const MERCHANT: Tables<"merchants"> = {
  id: "u1",
  display_name: "測試商家",
  public_slug: "abc123",
  contact_email: "abc123@gmail.com",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("onboardMerchant", () => {
  it("已有 merchant 時直接回傳，不建立、不複製範本（真冪等）", async () => {
    mockFindById.mockResolvedValue(MERCHANT);

    const result = await onboardMerchant("u1", "abc123@gmail.com", "新名稱");

    expect(result).toEqual({ merchant: MERCHANT, created: false });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCopyTemplateRateCard).not.toHaveBeenCalled();
  });

  it("無 merchant 且 slug 未碰撞：建立 merchant 並複製範本", async () => {
    mockFindById.mockResolvedValue(null);
    mockFindBySlug.mockResolvedValue(null);
    mockCreate.mockResolvedValue(MERCHANT);

    const result = await onboardMerchant("u1", "abc123@gmail.com", "測試商家");

    expect(mockCreate).toHaveBeenCalledWith({
      id: "u1",
      display_name: "測試商家",
      public_slug: "abc123",
      contact_email: "abc123@gmail.com",
    });
    expect(mockCopyTemplateRateCard).toHaveBeenCalledWith(MERCHANT.id);
    expect(result).toEqual({ merchant: MERCHANT, created: true });
  });

  it("slug 碰撞時仍能建立，且 create 收到帶後綴的 slug", async () => {
    mockFindById.mockResolvedValue(null);
    mockFindBySlug
      .mockResolvedValueOnce(MERCHANT) // 基底已被使用
      .mockResolvedValueOnce(null); // 後綴候選可用
    mockCreate.mockResolvedValue(MERCHANT);

    await onboardMerchant("u1", "abc123@gmail.com", "測試商家");

    expect(mockFindBySlug).toHaveBeenCalledTimes(2);
    const createArg = mockCreate.mock.calls[0][0];
    expect(createArg.public_slug).toMatch(/^abc123-\d{3}$/);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/domains/merchant/onboardMerchant.test.ts`
Expected: FAIL

- [ ] **Step 3: 寫最小實作**

```ts
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { copyTemplateRateCard } from "@/domains/merchant/onboardingService.ts";
import { generateUniqueSlug } from "@/domains/merchant/slugGenerator.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

export type OnboardResult = { merchant: Tables<"merchants">; created: boolean };

/**
 * onboarding 核心：使用者第一次登入後建立自己的 merchant 列 + 複製範本價目表。
 * 真冪等：已有 merchant 直接回傳既有列，不覆蓋 display_name、不重複複製範本。
 */
export async function onboardMerchant(
  userId: string,
  email: string,
  displayName: string,
): Promise<OnboardResult> {
  const existing = await merchantsRepository.findById(userId);
  if (existing !== null) {
    return { merchant: existing, created: false };
  }

  const slug = await generateUniqueSlug(email, async (candidate) => {
    const found = await merchantsRepository.findBySlug(candidate);
    return found !== null;
  });

  const merchant = await merchantsRepository.create({
    id: userId,
    display_name: displayName,
    public_slug: slug,
    contact_email: email,
  });

  await copyTemplateRateCard(merchant.id);

  return { merchant, created: true };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/domains/merchant/onboardMerchant.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add src/domains/merchant/onboardMerchant.ts src/domains/merchant/onboardMerchant.test.ts
git commit -m "feat(onboarding): 新增 onboardMerchant（冪等建立 merchant + 複製範本）"
```

---

### Task 3: onboarding 請求驗證 schema

**Files:**
- Create: `src/domains/merchant/onboardingSchemas.ts`

沿用 `sessionSchemas.ts` 的 zod schema 慣例；無獨立測試檔（同該檔案慣例，驗證行為由 Task 4 的 route 測試涵蓋）。

- [ ] **Step 1: 建立檔案**

```ts
import { z } from "zod";

export const DISPLAY_NAME_MAX_LENGTH = 100;

/** POST /api/dashboard/onboarding 主體：僅商家名稱，slug 由系統自動產生。 */
export const onboardingBodySchema = z.object({
  display_name: z
    .string()
    .min(1, "商家名稱不可為空")
    .max(
      DISPLAY_NAME_MAX_LENGTH,
      `商家名稱長度不可超過 ${DISPLAY_NAME_MAX_LENGTH} 字`,
    ),
});
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無新增錯誤

- [ ] **Step 3: Commit**

```bash
git add src/domains/merchant/onboardingSchemas.ts
git commit -m "feat(onboarding): 新增 onboarding 請求 body 驗證 schema"
```

---

### Task 4: POST /api/dashboard/onboarding（TDD）

**Files:**
- Create: `src/app/api/dashboard/onboarding/route.ts`
- Test: `src/app/api/dashboard/onboarding/route.test.ts`

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

vi.mock("@/domains/merchant/onboardMerchant.ts", () => ({
  onboardMerchant: vi.fn(),
}));

import { onboardMerchant } from "@/domains/merchant/onboardMerchant.ts";
import { POST } from "./route.ts";

const mockOnboardMerchant = vi.mocked(onboardMerchant);

const MERCHANT: Tables<"merchants"> = {
  id: "99999999-9999-9999-9999-999999999999",
  display_name: "測試商家",
  public_slug: "test123",
  contact_email: "test@example.com",
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
};

function postRequest(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/dashboard/onboarding", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/dashboard/onboarding", () => {
  it("未登入 → 401", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(postRequest({ display_name: "測試商家" }));

    expect(res.status).toBe(401);
    expect(mockOnboardMerchant).not.toHaveBeenCalled();
  });

  it("display_name 空白 → 400", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "u1", email: "test@example.com" } },
    });

    const res = await POST(postRequest({ display_name: "" }));

    expect(res.status).toBe(400);
    expect(mockOnboardMerchant).not.toHaveBeenCalled();
  });

  it("新建 merchant → 201", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: MERCHANT.id, email: MERCHANT.contact_email } },
    });
    mockOnboardMerchant.mockResolvedValue({ merchant: MERCHANT, created: true });

    const res = await POST(postRequest({ display_name: "測試商家" }));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.merchant).toEqual(MERCHANT);
    expect(mockOnboardMerchant).toHaveBeenCalledWith(
      MERCHANT.id,
      MERCHANT.contact_email,
      "測試商家",
    );
  });

  it("已有 merchant（冪等命中）→ 200", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: MERCHANT.id, email: MERCHANT.contact_email } },
    });
    mockOnboardMerchant.mockResolvedValue({ merchant: MERCHANT, created: false });

    const res = await POST(postRequest({ display_name: "測試商家" }));

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npx vitest run src/app/api/dashboard/onboarding/route.test.ts`
Expected: FAIL

- [ ] **Step 3: 寫最小實作**

```ts
import { apiOk, apiFail } from "@/lib/api/response.ts";
import { createClient } from "@/lib/supabase/serverClient.ts";
import { onboardMerchant } from "@/domains/merchant/onboardMerchant.ts";
import { onboardingBodySchema } from "@/domains/merchant/onboardingSchemas.ts";
import { formatZodError } from "@/domains/intake/sessionSchemas.ts";

/**
 * POST /api/dashboard/onboarding — 使用者登入後建立自己的 merchant（冪等，5.3）。
 * 此階段尚無 requireMerchant/RLS policy（5.4），故直接用 session 驗證登入。
 */
export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user === null || user.email == null) {
    return apiFail("請先登入", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiFail("請求主體必須是合法的 JSON", 400);
  }

  const parsed = onboardingBodySchema.safeParse(body);
  if (!parsed.success) {
    return apiFail(formatZodError(parsed.error), 400);
  }

  try {
    const { merchant, created } = await onboardMerchant(
      user.id,
      user.email,
      parsed.data.display_name,
    );
    return apiOk({ merchant }, created ? 201 : 200);
  } catch (error) {
    console.error(
      "[POST /api/dashboard/onboarding] onboardMerchant 失敗：",
      error,
    );
    return apiFail("系統忙碌，請稍後再試", 500);
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `npx vitest run src/app/api/dashboard/onboarding/route.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dashboard/onboarding/
git commit -m "feat(onboarding): 新增 POST /api/dashboard/onboarding"
```

---

### Task 5: 擴充 decideRedirect 支援 hasMerchant（TDD）

**Files:**
- Modify: `src/lib/auth/redirectDecision.ts`
- Modify: `src/lib/auth/redirectDecision.test.ts`

`hasMerchant` 預設 `true`，保證既有 9 個測試呼叫（未傳第三參數）行為完全不變。

- [ ] **Step 1: 在既有測試檔尾端加入新測試（先確認新案例失敗）**

在 `src/lib/auth/redirectDecision.test.ts` 的 `describe("decideRedirect", ...)` 區塊內、既有測試之後加入：

```ts
  it("已登入、無 merchant 訪問 /dashboard 導向 /onboarding", () => {
    expect(decideRedirect("/dashboard", true, false)).toBe("/onboarding");
  });

  it("已登入、無 merchant 訪問 /onboarding 不重導", () => {
    expect(decideRedirect("/onboarding", true, false)).toBeNull();
  });

  it("已登入、有 merchant 訪問 /onboarding 導向 /dashboard", () => {
    expect(decideRedirect("/onboarding", true, true)).toBe("/dashboard");
  });

  it("已登入、有 merchant 訪問 /dashboard 不重導（顯式傳入）", () => {
    expect(decideRedirect("/dashboard", true, true)).toBeNull();
  });

  it("已登入、無 merchant 訪問 /login 導向 /onboarding", () => {
    expect(decideRedirect("/login", true, false)).toBe("/onboarding");
  });

  it("已登入、無 merchant 訪問 /signup 導向 /onboarding", () => {
    expect(decideRedirect("/signup", true, false)).toBe("/onboarding");
  });
```

- [ ] **Step 2: 執行測試確認新案例失敗（舊 9 案例仍應通過）**

Run: `npx vitest run src/lib/auth/redirectDecision.test.ts`
Expected: 9 PASS + 6 FAIL（`decideRedirect` 尚未接受第三參數，實際呼叫仍用舊邏輯）

- [ ] **Step 3: 擴充實作**

將 `src/lib/auth/redirectDecision.ts` 整檔取代為：

```ts
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];
const AUTH_PAGE_PREFIXES = ["/login", "/signup"];
const ONBOARDING_PREFIX = "/onboarding";

/**
 * middleware 的重導決策，抽成純函式以便脫離 Supabase/NextRequest 獨立測試。
 * hasMerchant 預設 true：未登入時該值不影響判斷（第一條規則已短路），
 * 呼叫端只在「已登入」情境才需要傳入真實查詢結果。
 */
export function decideRedirect(
  pathname: string,
  isAuthenticated: boolean,
  hasMerchant: boolean = true,
): string | null {
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isAuthPage = AUTH_PAGE_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );
  const isOnboardingPage = pathname.startsWith(ONBOARDING_PREFIX);

  if (!isAuthenticated && isProtected) {
    return "/login";
  }

  if (isAuthenticated && !hasMerchant && isProtected && !isOnboardingPage) {
    return "/onboarding";
  }

  if (isAuthenticated && hasMerchant && isOnboardingPage) {
    return "/dashboard";
  }

  if (isAuthenticated && isAuthPage) {
    return hasMerchant ? "/dashboard" : "/onboarding";
  }

  return null;
}
```

- [ ] **Step 4: 執行測試確認全數通過**

Run: `npx vitest run src/lib/auth/redirectDecision.test.ts`
Expected: PASS（15 tests：舊 9 + 新 6）

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/redirectDecision.ts src/lib/auth/redirectDecision.test.ts
git commit -m "feat(onboarding): decideRedirect 擴充 hasMerchant 判斷 /onboarding 導流"
```

---

### Task 6: proxy.ts 整合 merchant 存在性查詢

**Files:**
- Modify: `src/proxy.ts`

純組裝已測試過的 `getUserAndResponse`、`decideRedirect`、`merchantsRepository.findById`（後者是既有 `BaseRepository` 方法，無需新測試），不重複測試邏輯本身，行為留待 Task 8 手動瀏覽器驗證。

- [ ] **Step 1: 整檔取代為**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getUserAndResponse } from "@/lib/supabase/middlewareClient.ts";
import { decideRedirect } from "@/lib/auth/redirectDecision.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";

export async function proxy(request: NextRequest) {
  const { user, response } = await getUserAndResponse(request);

  const hasMerchant =
    user !== null
      ? (await merchantsRepository.findById(user.id)) !== null
      : false;

  const target = decideRedirect(
    request.nextUrl.pathname,
    user !== null,
    hasMerchant,
  );
  if (target !== null) {
    return NextResponse.redirect(new URL(target, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*", "/login", "/signup"],
};
```

- [ ] **Step 2: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無新增錯誤

- [ ] **Step 3: Commit**

```bash
git add src/proxy.ts
git commit -m "feat(onboarding): proxy.ts 查詢 merchant 存在性，導流 /onboarding"
```

---

### Task 7: /onboarding 頁面 UI

**Files:**
- Create: `src/app/onboarding/OnboardingForm.tsx`
- Create: `src/app/onboarding/page.tsx`

非 Server Action（呼叫真實 REST API），UI 依專案慣例不寫 vitest 單元測試，留待 Task 8 手動瀏覽器驗證。

- [ ] **Step 1: 建立表單 UI（Client Component）**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function OnboardingForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const res = await fetch("/api/dashboard/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: displayName }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setError(json.error ?? "發生未預期的錯誤，請稍後再試");
        setIsPending(false);
        return;
      }

      router.push("/dashboard");
    } catch {
      setError("網路異常，請稍後再試");
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="display_name" className="text-sm font-medium">
          商家名稱
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          required
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          className="rounded border px-3 py-2"
        />
      </div>
      {error !== null && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? "建立中…" : "開始使用"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: 建立頁面（Server Component）**

```tsx
import { OnboardingForm } from "./OnboardingForm.tsx";

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">歡迎使用 BizMate</h1>
      <p className="max-w-sm text-center text-sm text-gray-600">
        填寫商家名稱，系統會自動產生你的專屬報價連結。
      </p>
      <OnboardingForm />
    </main>
  );
}
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無新增錯誤

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding/
git commit -m "feat(onboarding): 新增 /onboarding 頁面（表單 + fetch 提交）"
```

---

### Task 8: 全量驗證

**Files:** 無新檔案，純驗證步驟。

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: 無錯誤

- [ ] **Step 2: 型別檢查 + build**

Run: `npx next build`
Expected: build 成功

- [ ] **Step 3: 全量測試**

Run: `npx vitest run`
Expected: 全數通過（既有 231 + 本次新增 26〔13 + 3 + 4 + 6〕= 257）

- [ ] **Step 4: 手動瀏覽器驗證**

Run: `npx next dev`

依序驗證（用已登入但尚無 merchant 的帳號，或 5.2 驗證時用過的測試帳號）：
1. 已登入、無 merchant，訪問 `/dashboard` → 應重導 `/onboarding`
2. 於 `/onboarding` 填商家名稱送出 → 應成功導向 `/dashboard`，且此時該帳號已有 merchant
3. 再次訪問 `/onboarding` → 應重導回 `/dashboard`（避免重複 onboarding）
4. 重整 `/dashboard` 確認不再被導去 `/onboarding`
5. 用 curl 直接呼叫兩次 `POST /api/dashboard/onboarding`（同一已登入 session，帶不同 `display_name`）→ 第二次應回 200（非 201）且 `merchant.display_name` 仍是第一次的值（驗證真冪等、不覆蓋）

- [ ] **Step 5: Commit（若驗證階段有修正）**

僅在 Step 1-4 發現問題並修正時才需要；若全數綠燈則跳過。

---

## 完成後

依 `git-workflow.md`：任務全數完成、驗證通過後，載入 sunnydata-branch-lifecycle skill 收尾（merge/PR/清理分支）；並更新 `.claude/taskmaster-data/wbs.md` 的 5.3 狀態為 ✅ 完成，5.4 標記為下一個。

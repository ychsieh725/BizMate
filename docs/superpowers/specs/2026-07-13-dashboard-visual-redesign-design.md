# 後台視覺重新設計 設計文件

- **日期**: 2026-07-13
- **對應 WBS**: 無編號（UI 品質提升，非功能性任務，使用者於 8.4 之前臨時插入）
- **分支**: 待建立（`chore/ui-redesign-dashboard`）
- **範圍**: 僅 `/dashboard` 系列頁面。公開精靈 `/q/[slug]`、登入註冊 onboarding、首頁 `/` 為後續獨立 spec，此文件不涵蓋。

## 背景

全站目前沿用 `create-next-app` 預設樣板：`globals.css` 只有 `--background`/`--foreground` 兩個變數、body 字體 fallback 到 Arial，元件各自寫零散 Tailwind class（例如 `rounded bg-black px-4 py-2 text-white`），沒有統一設計系統。使用者要求全面重新設計，經兩輪視覺提案（見對話記錄）後，定案方向為：柔霧漸層底 + 漂浮圓角卡片（使用者提供截圖參考：一個信件用戶端，杏色轉淡藍的柔和漸層背景、懸浮膠囊側邊導覽、大圓角白卡片、卡片內嵌深色重點資訊卡）。

決策（已與使用者確認）：
1. **只做淺色模式**——這套漸層底本質是淺色風格，深色模式留待之後單獨評估，不在此次範圍內產生 `dark:` 變體。
2. **先做後台，其他後補**——後台是最複雜、也是商家每天實際使用的部分，先在這裡定案設計系統，公開精靈/登入註冊/首頁之後各自開一個新 spec 套用同一套 tokens。

## A. 設計 Tokens

### A.1 色彩

新增至 `src/app/globals.css` 的 `@theme inline` 區塊（Tailwind v4 語法，新增 token 會自動產生對應 utility class，例如 `--color-surface` → `bg-surface`）：

```css
:root {
  /* 既有 */
  --background: #ffffff;
  --foreground: #171717;

  /* 新增：後台專用 tokens */
  --ink: #1a1a18;
  --ink-soft: #6b6b64;
  --ink-faint: #8a897f;
  --surface: #fbfaf7;
  --surface-line: #e2e2dd;
  --rail-bg: rgba(255, 255, 255, 0.72);
  --accent: #e2664a;
  --accent-ink: #1b1a20;
  --status-review-bg: #fbead0;
  --status-review-fg: #9a6300;
  --status-confirmed-bg: #dfe9ff;
  --status-confirmed-fg: #2c4fb0;
  --status-sent-bg: #dcf0e6;
  --status-sent-fg: #16794f;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-ink-faint: var(--ink-faint);
  --color-surface: var(--surface);
  --color-surface-line: var(--surface-line);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-status-review-bg: var(--status-review-bg);
  --color-status-review-fg: var(--status-review-fg);
  --color-status-confirmed-bg: var(--status-confirmed-bg);
  --color-status-confirmed-fg: var(--status-confirmed-fg);
  --color-status-sent-bg: var(--status-sent-bg);
  --color-status-sent-fg: var(--status-sent-fg);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

`--accent`（rust/coral `#e2664a`）是唯一的品牌強調色，只用在：深色重點卡片內的圖示底色、客戶端精靈已選類別的強調狀態、商家大頭貼底色。狀態顏色（待審核/已確認/已寄送）獨立於 `--accent`，不可混用——三態各自的 bg/fg 對，語意色與品牌色分離（沿用 dataviz skill 的原則）。

### A.2 漸層底（aura）

多層 `radial-gradient` 疊加，不用 `filter: blur()`（避免大面積 blur 拖垮 Safari 效能），漸層本身的 transparent 收尾已經夠柔：

```css
.aura-bg {
  background:
    radial-gradient(ellipse 620px 480px at 6% -6%, rgba(246, 208, 164, 0.85), transparent 60%),
    radial-gradient(ellipse 520px 420px at 34% 6%, rgba(247, 196, 196, 0.55), transparent 60%),
    radial-gradient(ellipse 640px 560px at 100% 96%, rgba(196, 209, 244, 0.85), transparent 62%),
    radial-gradient(ellipse 460px 380px at 78% 60%, rgba(222, 231, 248, 0.55), transparent 65%),
    #f7f4ee;
}
```

加在 `src/app/dashboard/layout.tsx` 的最外層容器，所有子頁面共享同一片背景（不是每頁各自畫一次）。

### A.3 圓角 / 陰影

不新增 Tailwind token，直接用既有 arbitrary value（專案目前沒有統一半徑系統，新增全域 token 會影響到非後台頁面，超出此 spec 範圍）：

- 卡片：`rounded-[24px]`
- 懸浮側欄／深色重點卡：`rounded-[26px]` / `rounded-2xl`
- 按鈕（主要動作）：`rounded-full`
- 小圖示容器：`rounded-[9px]`

陰影統一用一個共用 class（`globals.css` 新增）：

```css
.card-float {
  box-shadow: 0 20px 46px -26px rgba(35, 26, 15, 0.28), 0 2px 10px rgba(35, 26, 15, 0.05);
}
```

### A.4 字體

`layout.tsx` 已透過 `next/font/google` 載入 Geist Sans / Geist Mono，`globals.css` 的 `@theme inline` 也已把 `--font-sans`/`--font-mono` 指向它們——**零新增依賴**，純粹是至今沒有元件真的用粗細/字距做出層次。這次補上：

- 標題：`font-semibold` 或 `font-bold`，`tracking-tight`
- 金額／報價編號／時間戳：`font-mono tabular-nums`（Geist Mono 本身支援 tabular figures）
- 內文：預設 `font-normal`，`text-ink-soft` 作為次要文字色

## B. 共用元件

### B.1 `src/app/dashboard/layout.tsx`（新建）

目前 `/dashboard/**` 沒有共用 layout，五個頁面（`page.tsx`／`quotes/page.tsx`／`quotes/[id]/page.tsx`／`services/page.tsx`／`settings/page.tsx`）各自在自己的 JSX 裡重複導覽連結（見 `dashboard/page.tsx:37-45` 的四個 `<Link>`）。新增 layout 統一處理：

- 最外層套 `.aura-bg`，`min-h-screen`。
- 懸浮側欄（`rounded-[26px]`、`bg-rail-bg backdrop-blur-lg`）：logo 方塊、四個圓形圖示導覽鈕（總覽／報價／服務／設定，用 `usePathname()` 判斷 active 狀態套 `bg-ink text-surface`）、登出鈕、底部商家姓名首字大頭貼。
- 圖示：新增 `lucide-react` 依賴（MIT、零執行期依賴、per-icon tree-shaking，`import { Clock, Star, Send, Settings, LogOut } from "lucide-react"`）取代手刻 SVG——五個頁面會重複用到同一組圖示，屬於「同樣邏輯不要複製貼上」的 DRY 情況，沒理由手刻並維護一份 SVG path。這是本次唯一新增的 npm 依賴。
- **`requireMerchant()` 呼叫**：Next.js App Router 的 `layout.tsx` 與同層 `page.tsx`是各自獨立渲染、無法把 layout 查到的資料當 props 傳給 page——所以「合併成一次呼叫」不能只靠搬位置。實際做法：
  1. `requireMerchant()` 本體用 React `cache()` 包一層（`export const requireMerchant = cache(async () => {...})`），讓同一次 request 內多次呼叫只真的打一次 Supabase（這是 Next.js App Router 官方建議的 per-request memoization 模式，非本次新發明）。
  2. `layout.tsx` 呼叫一次，未登入/無商家時直接回傳錯誤畫面、**不渲染 `{children}`**——五個頁面現有各自 `if (!auth.ok) return <錯誤畫面>` 的重複 JSX（五份幾乎一樣的程式碼）可以整段刪除，因為 layout 短路後頁面根本不會執行。
  3. 各 `page.tsx` 仍會各自呼叫一次 `requireMerchant()` 取得 `merchantId`（layout 無法把它當 prop 傳下去），但套用 `cache()` 後這是同一個 request 內的第二次呼叫，直接吃快取，不是第二次真的查 DB。

### B.2 卡片元件

不建通用 `<Card>` 元件——各頁面卡片的內部結構差異夠大（列表列 vs 表單 vs 詳情），硬抽共用元件只會換來一堆 optional props。改用共用 class（`.card-float`，見 A.3）讓視覺一致，內部結構各頁自己排版，符合「消除特殊情況用資料結構、不是用過度抽象的元件」。

### B.3 狀態 pill

新增 `src/app/dashboard/StatusPill.tsx`（唯一值得抽的共用元件，因為「狀態文字 → 顏色」的對照表在 quotes 列表、詳情頁都會用到，且未來 services 的 `is_active` 也可能用同一套視覺語言）：

```tsx
const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: "bg-surface-line text-ink-soft",
  awaiting_review: "bg-status-review-bg text-status-review-fg",
  confirmed: "bg-status-confirmed-bg text-status-confirmed-fg",
  sent: "bg-status-sent-bg text-status-sent-fg",
};

export function StatusPill({ status, label }: { status: QuoteStatus; label: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_STYLE[status]}`}>
      {label}
    </span>
  );
}
```

## C. 逐頁設計

### C.1 `/dashboard`（總覽）

現況（`page.tsx:27-52`）：置中的純文字列表——標題、待審連結、複製連結按鈕、三個導覽連結、登出表單。

改版：導覽連結搬進 layout 側欄後，這頁只剩「總覽」內容本身，改成兩張並排 `card-float`：
1. 待審報價統計卡：大字級數字（`font-mono text-3xl`）+ 「待審報價」標籤 + 點擊整卡導向 `/dashboard/quotes?status=awaiting_review`。
2. 分享連結卡：`CopyLinkButton`（沿用既有元件，不改邏輯）包在卡片裡，加上商家 slug 的說明文字。

`CopyLinkButton.tsx` 本身邏輯不動，只調整外層容器的 class。

### C.2 `/dashboard/quotes`（列表）

現況（`page.tsx:37-116`）：狀態篩選 tab（`aria-current` 驅動樣式）+ 一個 `<table>`，欄位：報價編號（`font-mono`）、分類、客戶 Email、金額（含 `is_conservative` 時的「保守估算」黃底徽章）、狀態文字、建立時間、「查看」連結。空清單時顯示提示文字。

改版：`<table>` 換成每筆報價一張 `card-float` qcard（垂直排列，非表格）：
- 頂列：類別首字大頭貼（`bg-accent`，類別文字取自既有 `CASE_CATEGORY_LABELS`）+ 報價編號 + 建立時間（`formatDateTime`，邏輯不動）
- 客戶 Email 作為次要文字
- 金額列：`StatusPill`（取代目前純文字狀態）+ 金額（`font-mono tabular-nums`，靠右）+「保守估算」沿用既有黃底徽章樣式微調圓角
- 整張卡可點擊導向詳情（取代原本卡片內單獨的「查看」連結），`href` 邏輯沿用 `PAGE_ROUTES.dashboardQuote(item.id)`
- 空清單提示文字維持不動，包進 `card-float` 容器

狀態篩選 tab 改用膠囊按鈕列（`rounded-full`，`aria-current=page` 態改套 `bg-ink text-surface` 取代目前的 `bg-gray-900`），`aria-current` 屬性與 URL query 驅動邏輯（`?status=`）完全不動，純視覺調整。

### C.3 `/dashboard/quotes/[id]`（詳情）

現況（`page.tsx:46-182`）：六個 `<section>` 依序排列——報價摘要（`<dl>`）、`QuoteActions`（僅 `awaiting_review` 顯示）／`SendQuoteButton`（僅 `confirmed` 顯示）、費用明細（`<table>` 三欄：項目/金額/計價依據）、抽取欄位（`<table>` 四欄：欄位/值/信心/來源文字）、澄清歷程（`<ol>`，每輪 Q/A）、客戶原始描述（`<ol>`，時間戳+原文）。`QuoteActions.tsx`／`SendQuoteButton.tsx` 內部 state/action 邏輯完全不動，只調整外觀。

改版，同一頁拆成「主要」與「次要」兩種視覺份量，不是全部套一樣的卡片：

- **頂部**：類別大頭貼（`lg` 版，48px，`bg-accent`）+ 報價編號 + 客戶 Email，取代目前的純文字 `<h1>`。
- **報價摘要 + 金額**：合併成一張 `card-float`。金額本身用深色重點卡（`bg-accent-ink text-surface rounded-[16px]`）單獨強調——這是全頁唯一的深色卡片，對應 v2 mockup「只在金額相關資訊上用深色」的原則；分類/Email/狀態/建立時間維持 `<dl>` 但改用 `StatusPill` 取代純文字狀態。
- **操作區**（`QuoteActions`／`SendQuoteButton`）：按鈕外觀改 `rounded-full`（主要動作）／`rounded-[14px]`（次要動作如調整金額的輸入框），沿用現有 `awaiting_review`/`confirmed` 條件渲染邏輯，`onClick`／`disabled`／`useState` 不動。
- **費用明細**：維持 `<table>`（三欄比較，符合 C.4 訂的「表格適合多欄比較」原則），只包進 `card-float` 並調整 padding/字級。
- **抽取欄位／澄清歷程／客戶原始描述**：這三段是商家的「追溯依據」，非每次都要看，視覺降階處理——維持現有 `<table>`/`<ol>` 結構，包進 `card-float` 但用 `text-ink-soft`、更小字級（`text-xs`）、更窄的內距，和上面「報價摘要＋操作」的視覺重量明確拉開層次。不新增摺疊/互動邏輯（YAGNI，此次是純視覺分層，非資訊架構改動）。

### C.4 `/dashboard/services`

現況：`ServicesTable.tsx` 是表格（inline 編輯 base_price/includes/unit）+ `NewServiceForm.tsx`。

改版：表格結構保留（表格對「多欄位比較」仍是最合適的資訊架構，参考圖的卡片列表適合的是「單筆重點資訊」情境，不該為了視覺一致硬套卡片化，這裡刻意不跟前兩頁一樣改成 qcard）。只調整：外層包 `card-float`、`is_active=false` 的列降低透明度、儲存按鈕改 `rounded-[10px]`。`data-testid`（8.2 E2E 剛加的）全部保留，不可誤刪。

### C.5 `/dashboard/settings`

現況（`SettingsForm.tsx:1-89`）：client component，`useState` 管理 `displayName`/`slug`/`saving`/`error`/`success`，`handleSubmit` 手動 `fetch(PATCH)`（非 Server Action／`useActionState`）。兩個欄位：商家名稱、分享連結代號（含即時預覽 `目前連結：/q/{slug}`），錯誤/成功訊息文字，儲存按鈕。

改版：包進置中的 `card-float`（`max-w-md`），輸入框圓角統一 `rounded-[10px]`，錯誤/成功訊息維持既有 `role="alert"`／文字內容不動，儲存按鈕改 `rounded-full`。表單邏輯（`useState`、`fetch` 呼叫、`aria-describedby`）完全不動。

## D. 範圍外（明確排除）

- `/q/[slug]` 公開精靈、`/login`／`/signup`／`/onboarding`、首頁 `/`：延續 v2 mockup 的方向，但需要各自的逐頁設計（尤其公開精靈要考慮匿名使用者的載入效能，深色重點卡片語言可能要換成別的隱喻），另開 spec。
- 深色模式：不在此次範圍，`globals.css` 既有的 `@media (prefers-color-scheme: dark)` 區塊維持不動，新增的 token 只定義淺色值。
- 不新增 `<Card>`／`<Button>` 通用元件庫（見 B.2 理由）。

## E. 測試與驗證

- **不影響邏輯**：這次改動全部是 JSX 結構＋className＋新增 `layout.tsx`／`StatusPill.tsx`，不碰任何 `*Service.ts`／`*Repository.ts`／`actions.ts` 的邏輯。既有單元測試（`dashboard/actions.test.ts`、`quotes/formatters.test.ts`）預期維持全綠，不需改動。
- **`requireMerchant()` 加 `cache()` + 搬移錯誤畫面到 layout**：這是唯一有行為面風險的改動（見 B.1 三步驟）。實作時：先確認現有測試（尤其各 `*.test.ts`）沒有直接測試頁面元件本身回傳 401/403 畫面的行為（若有，需搬到 layout 的測試裡）；加上 `cache()` 後用 `console.count` 或臨時 log 手動驗證同一次請求只打一次 Supabase，驗證完移除 log。
- **E2E 回歸**：8.2 剛建立的 `tests/e2e/critical-path.spec.ts` 涵蓋 onboarding→改價→確認→寄信，其中「改價」「確認」「寄送」三步驟直接經過本次改版的頁面。實作完成後跑 `pnpm test:e2e critical-path.spec.ts` 作為視覺改版後的行為回歸證據（不只是「看起來像」，是「金路徑仍然真的能跑完」）。既有的 `data-testid` 屬性必須全數保留在新結構中，否則 E2E 會紅。
- **視覺驗收**：無自動化視覺回歸工具（未引入 Percy/Chromatic 之類，超出此次範圍），改為 `pnpm dev` 啟動後人工核對五個頁面，並用 Playwright 對每頁截圖存到 scratchpad 供人工比對（一次性，不寫進正式測試套件）。

## F. 新增依賴

- `lucide-react`（MIT license，零執行期依賴，[github.com/lucide-icons/lucide](https://github.com/lucide-icons/lucide) 活躍維護）——理由見 B.1。`pnpm add lucide-react` 後跑 `pnpm audit` 確認無已知漏洞。

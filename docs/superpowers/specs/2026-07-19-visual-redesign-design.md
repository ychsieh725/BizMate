# 全站視覺重設計 — Design Spec

**日期**：2026-07-19
**狀態**：待使用者核准

## 背景

目前 UI 存在風格不一致：後台 `/dashboard` 已採用一套暖色調設計系統（`ink`/`surface`/`accent` 橘紅、`aura-bg` 漸層、`card-float` 陰影），但 landing 首頁、登入、註冊、onboarding、以及客戶端的報價向導 `/q/[slug]` 全部仍是 Tailwind 預設的 `zinc-*` 灰階，視覺上像未完成的樣板。

本次為**全站重新設計**（不沿用現有暖色 token），涵蓋三個區域：landing/登入/註冊/onboarding、報價向導、後台。

## 風格方向

簡約專業（minimal / clean SaaS），參考 Linear、Stripe 一類的冷靜可信賴感。

## 色彩系統

### 中性色階

| Token | 用途 | 值 |
|:---|:---|:---|
| `--ink` | 主要文字 | `#0f1115` |
| `--ink-soft` | 次要文字 | `#5b6270` |
| `--ink-faint` | 輔助/停用文字 | `#9aa0ab` |
| `--surface` | 頁面背景 | `#ffffff` |
| `--surface-subtle` | 卡片/區塊底色 | `#f7f8fa` |
| `--surface-line` | 邊框/分隔線 | `#e3e5e9` |

### 強調色

黑白無彩色 + 單一強調色，強調色為深藍：

| Token | 值 | 用途 |
|:---|:---|:---|
| `--accent` | `#2451c4` | 按鈕、連結、焦點態、確認狀態徽章文字 |
| `--accent-hover` | `#1c3f9e` | 強調色 hover 態 |

### 狀態徽章（保留三色區別）

功能性資訊，例外於單色規則，但降低飽和度：

| 狀態 | 背景 | 文字 |
|:---|:---|:---|
| 待審（awaiting_review） | `#fdf3e3` | `#92661a` |
| 確認（confirmed） | `#e8edfb` | `#2451c4`（沿用 accent） |
| 已寄信（sent） | `#e6f4ec` | `#1a7a4c` |

### 移除項目

- `aura-bg`：多層漸層背景，暖色系語言，與簡約方向衝突
- `card-float`：雙層暖色陰影，改用單層輕量陰影

## 字型、間距、圓角、陰影

### 字型

沿用 Geist Sans（Next.js 預設，零額外載入成本）。

| 層級 | 用途 | 字重 / 大小 |
|:---|:---|:---|
| Display | landing 主標題 | 600 / `text-4xl`~`text-5xl` |
| Heading | 頁面/區塊標題 | 600 / `text-xl`~`text-2xl` |
| Body | 內文 | 400 / `text-sm`~`text-base` |
| Label | 表單標籤/輔助文字 | 500 / `text-xs`~`text-sm` |

移除目前 landing 頁 `tracking-widest uppercase` 的裝飾性標籤字排版。

### 間距

統一用 Tailwind 預設比例尺（4/8/12/16/24/32/48/64px），不自訂間距值。

### 圓角

中度圓潤：

| Token | 值 | 用途 |
|:---|:---|:---|
| `rounded-xl` | 12px | 按鈕、輸入框、小卡片 |
| `rounded-2xl` | 16px | 大卡片、彈窗 |

### 陰影

單層輕量陰影取代雙層暖色陰影：

```css
--shadow-card: 0 1px 2px rgba(15, 17, 21, 0.04), 0 1px 8px rgba(15, 17, 21, 0.06);
```

**邊框優先於陰影**：卡片預設用 `1px solid var(--surface-line)` 邊框做區隔，陰影只用於浮起元素（下拉選單、彈窗、頂部固定列）。

### 深色模式

本次僅完成淺色模式。深色模式留待後續任務（`globals.css` 現有的 `prefers-color-scheme: dark` 基礎保留但不在本次擴充範圍）。

## 執行方式：三階段分支

依專案 `git-workflow.md`「一個分支做一件事」慣例，拆三個獨立分支/PR，逐階段驗證、逐階段可回滾。

### Phase 1 — Landing / 登入 / 註冊 / Onboarding

| 檔案 | 現況 | 改動 |
|:---|:---|:---|
| `src/app/globals.css` | 暖色 token | **本階段落地新 token 系統**，後兩階段沿用 |
| `src/app/page.tsx` | zinc 灰階，無視覺層次 | 套新 token，強化 hero 對比 |
| `src/app/login/LoginForm.tsx` | zinc 灰階 | 表單統一 `rounded-xl` 輸入框、accent 藍按鈕 |
| `src/app/signup/SignupForm.tsx` | zinc 灰階 | 同上 |
| `src/app/onboarding/OnboardingForm.tsx` | zinc 灰階 | 同上 |

### Phase 2 — 報價向導 `/q/[slug]`

客戶端體驗，五步驟視覺一致性與進度感為重點。

| 檔案 |
|:---|
| `src/app/q/[slug]/WizardPage.tsx` |
| `src/app/q/[slug]/components/StepCategory.tsx` |
| `src/app/q/[slug]/components/StepDescribe.tsx` |
| `src/app/q/[slug]/components/StepClarify.tsx` |
| `src/app/q/[slug]/components/StepResult.tsx` |

### Phase 3 — 後台 `/dashboard`

風險最高（唯一有實際商業資料在跑的介面），排最後。

| 檔案 |
|:---|
| `src/app/dashboard/layout.tsx` |
| `src/app/dashboard/RailNavLink.tsx` |
| `src/app/dashboard/StatusPill.tsx` |
| `src/app/dashboard/page.tsx` |
| `src/app/dashboard/quotes/page.tsx`、`quotes/[id]/page.tsx`、`QuoteActions.tsx`、`SendQuoteButton.tsx` |
| `src/app/dashboard/services/page.tsx`、`ServicesTable.tsx`、`NewServiceForm.tsx` |
| `src/app/dashboard/settings/page.tsx`、`SettingsForm.tsx` |

Phase 3 完成後，使用者需實際跑過「登入 → 看報價列表 → 改價」golden path 再確認。

## 驗證方式

純樣式變更，不涉及邏輯：

- 不需新增/修改單元測試（無行為變化，只有 className/CSS）
- 每階段合併前：`pnpm lint` + `pnpm test`（確認現有測試不受影響）
- 每階段用 `pnpm dev` 實際開瀏覽器過一輪 golden path
- a11y：新配色需檢查文字對比度符合 WCAG AA（4.5:1），尤其待審徽章的淺黃底文字需重新核對

## 範圍外（Out of Scope）

- 深色模式完整實作（留待後續任務）
- 元件庫重構（不導入 shadcn/ui，維持手刻 Tailwind className）
- 任何邏輯/行為變更

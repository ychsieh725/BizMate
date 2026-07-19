# 設計文件：客戶端報價向導卡片式版面重設計

> **日期**：2026-07-19
> **範圍**：`src/app/q/[slug]/`（客戶端報價向導，4 步：選類型→描述需求→反問補答→結果）
> **觸發**：使用者回報向導元素太小且擁擠，提供參考圖（灰底頁面置中白卡片、
> 卡片內三欄大方格選項、點狀進度在內容下方、回首頁連結在卡片底部）

---

## 1. 背景

Phase 2 視覺重設計（`docs/superpowers/plans/2026-07-19-visual-redesign-phase2.md`）
已完成 token 套用，但版面結構未動：`WizardPage.tsx` 是無容器的 `max-w-2xl`
單欄版面，四個步驟各自在自己的 `<header>` 裡呼叫 `StepProgress`（進度點在標題
**之上**）。使用者提供的參考圖顯示不同結構：灰底頁面置中一張白卡片，卡片內
三欄大方格選項，進度點在內容**之下**，回首頁連結在卡片最底部。

這是版面架構調整，不是配色調整——色彩 token（`accent`、`surface-line`、
`shadow-card` 等）沿用 Phase 2 已建立的系統，不新增、不改值。

---

## 2. 決策摘要（已與使用者確認）

| 決策點 | 結論 |
| :--- | :--- |
| 白卡片套用範圍 | **全部 4 步**，非僅選類型步驟——四步共用同一卡片容器，切換步驟時卡片本身不跳動，只換內容 |
| 進度點位置 | 從各 Step 元件的 `<header>` 移出，改由 `WizardPage` 統一渲染在**步驟內容之下** |
| 頁尾連結（回首頁／重新開始一筆新報價） | 同樣統一移到 `WizardPage`，確保「內容→進度點→頁尾連結」順序四步一致（目前「重新開始」按鈕在 `StepResult.tsx` 內部，需移出） |
| Step 1 選類型 icon | 平面設計＝`Palette`、插畫＝`Brush`、網頁設計＝`LayoutTemplate`（皆為已安裝的 `lucide-react`） |
| Step 2-4 內容寬度 | 卡片本身維持 `max-w-4xl` 不變，表單內容另包一層 `max-w-md mx-auto` 避免文字欄位過寬 |

---

## 3. 架構

### 3.1 版面骨架（WizardPage.tsx）

```
外層頁面：min-h-screen bg-surface-subtle flex items-center justify-center px-4 py-10 sm:px-6 sm:py-16
  └─ 白卡片：w-full max-w-4xl rounded-3xl border border-surface-line bg-surface p-8 shadow-card sm:p-12
       ├─ 商家名（text-sm text-ink-soft，卡片內最上方，四步皆顯示）
       ├─ [當前步驟內容]（StepCategory / StepDescribe / StepClarify / StepResult，各自保留自己的 <header>+<h1>，但不再含 StepProgress）
       ├─ <StepProgress current={STEP_NUMBERS[step]} />（WizardPage 統一渲染一次）
       └─ 頁尾連結（依步驟條件渲染：category 步驟顯示「← 回首頁」；result 步驟顯示「重新開始一筆新報價」；describe/clarify 步驟無頁尾連結，維持現狀）
```

`STEP_NUMBERS` 為 `WizardPage.tsx` 內的模組層常數：

```ts
const STEP_NUMBERS: Record<WizardStep, 1 | 2 | 3 | 4> = {
  category: 1,
  describe: 2,
  clarify: 3,
  result: 4,
};
```

### 3.2 Step 1：StepCategory 三欄方格

```
<ul className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
  每格固定 min-h-[12rem]（192px，非 aspect-square——避免手機單欄時被拉過高）
  icon 40px 置中偏上、文字置中偏下（text-base font-medium）
  hover：border-accent + hover:-translate-y-0.5（沿用 dashboard 卡片慣例，見 src/app/dashboard/page.tsx）
  focus：ring-2 ring-accent-soft（既有慣例）
```

Icon 對照表（`lucide-react`）：

| `CaseCategory` | 中文標籤 | icon |
| :--- | :--- | :--- |
| `graphic_design` | 平面設計 | `Palette` |
| `illustration` | 插畫 | `Brush` |
| `web_design` | 網頁設計 | `LayoutTemplate` |

此對照表定義在 `StepCategory.tsx` 內（該元件唯一使用者，不需抽到 shared）。

### 3.3 Step 2-4：內容寬度收斂

`StepDescribe`、`StepClarify`、`StepResult` 的既有 `<header>`（含 `<h1>` 與說明文字）
與 `<form>`／內容區，整體包一層 `<div className="mx-auto flex w-full max-w-md flex-col gap-6">`，
移除各自原本呼叫 `<StepProgress current={N} />` 的那一行。表單邏輯、`data-testid`、
`onSubmit` 等行為完全不動。

### 3.4 loading.tsx 同步更新

`src/app/q/[slug]/loading.tsx` 目前的骨架尺寸對齊舊版 `max-w-2xl` 單欄版面，
新版面上線後骨架若不同步會在真實內容換入時造成明顯跳動（卡片變寬、方格變大）。
需同步更新為：頁面灰底 + 白卡片外殼（`max-w-4xl`）+ 三欄大方格骨架（對齊
`StepCategory` 新尺寸），維持原有 `role="status"` 與 `sr-only` 文字。

---

## 4. 元件責任變化

| 檔案 | 變更類型 | 說明 |
| :--- | :--- | :--- |
| `WizardPage.tsx` | 修改 | 新增卡片容器、`STEP_NUMBERS` 對照、統一渲染 `StepProgress` 與頁尾連結 |
| `components/StepCategory.tsx` | 修改 | 移除 `StepProgress` 呼叫；`<ul>` 改三欄 grid；選項加 icon；移除頁尾「← 回首頁」（改由 WizardPage 渲染） |
| `components/StepDescribe.tsx` | 修改 | 移除 `StepProgress` 呼叫；內容包 `max-w-md` |
| `components/StepClarify.tsx` | 修改 | 同上 |
| `components/StepResult.tsx` | 修改 | 移除 `StepProgress` 呼叫；內容包 `max-w-md`；移除「重新開始」按鈕（改由 WizardPage 渲染，經 `onRestart` prop 沿用既有回呼） |
| `components/StepProgress.tsx` | 不動 | 內部邏輯不變，只有呼叫端搬家 |
| `loading.tsx` | 修改 | 骨架尺寸對齊新版面 |

**不變**：`wizardApi.ts`、`wizardTypes.ts`、所有 API 呼叫與狀態流轉邏輯、
所有 `data-testid`（E2E 選擇器不受影響）、`aria-*` 語意。

---

## 5. 測試

純樣式與結構調整，不涉及業務邏輯，既有單元測試（若有針對 `isStepFilled` 等
純函式的測試）不受影響。驗證方式：

- `pnpm tsc --noEmit`、`pnpm vitest run`、`pnpm exec eslint src` 全綠
- `next build` 成功
- 手動走一次四步流程（本機 `next dev`），確認卡片切換不跳動、三欄方格在
  手機寬度（`sm` 以下）正確疊為單欄、進度點與頁尾連結顯示在正確步驟

---

## 6. 風險與邊界

- **`StepResult` 的「重新開始」按鈕移出**：目前該按鈕是 `StepResult.tsx`
  內部渲染，`onRestart` 已是 prop（呼叫端傳入），移到 `WizardPage` 只是
  把 JSX 位置搬家，不改變資料流方向，風險低。
- **`StepCategory` 的「← 回首頁」連結移出**：同上，該連結目前已在
  `WizardPage.tsx` 的 category 分支渲染（非 `StepCategory.tsx` 內部），
  只需確認移動後條件渲染邏輯（`step === "category"`）維持正確。
- **響應式**：參考圖為桌面寬螢幕，三欄方格在窄螢幕需疊為單欄
  （`grid-cols-1 sm:grid-cols-3`），避免小尺寸手機被壓縮到無法點擊。

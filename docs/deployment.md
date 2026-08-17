# BizMate 部署 Runbook（Vercel + Supabase + Resend）

> **本文件是「可照著執行」的上線手冊**，對應 WBS 8.4。
> 產物已由 AI 於分支 `chore/deploy-vercel` 備妥；帳號 / DNS / 密鑰步驟由你（使用者）親自執行。

## 本次部署的決策（2026-07-16 拍板）

| 項目 | 選擇 | 理由 |
| :--- | :--- | :--- |
| 執行模式 | AI 備料、使用者執行 | 帳號、密鑰、DNS 屬使用者資源，AI 無法代勞 |
| Production Supabase | **沿用現有專案升格** | Supabase 免費層上限 2 個專案、另一個名額被作品集網站佔用，BizMate 只能有一個專案；現有專案已套好 `0001–0007` 且 seed 過，直接當 prod 最省事 |
| Resend 寄信網域 | **共享 `resend.dev`** | 零 DNS、立即可寄；作品集 demo 夠用，自有網域留日後 |

> **單一專案取捨**：本機開發 / E2E 與 production 共用同一個 Supabase 專案（免費層限制下無法分離）。E2E 測試會自清資料，作品集規模可接受；若要更乾淨，可另建一個示範用商家與 production 商家隔開。原「新建專用 production 專案」的計畫因專案數上限改為此方案。

---

## 部署順序總覽（鐵律：先 DB、後程式碼）

程式碼一旦上線就會立刻連 production Supabase。若 schema 尚未就緒，production 會直接故障。**務必照下列順序**：

```
1. 沿用現有 Supabase 專案當 prod（抄下連線資訊）
2. 確認 migrations 0001–0007 已在位（現況已套用，僅核對，不需重跑）
3. 確認 seed 已完成（/q/dev 可走；如缺才補跑）
4. 建 Gemini / Resend 金鑰
5. Vercel 連 repo + 設環境變數 + 設 Node/Region
6. 觸發部署 → 冒煙測試
7. Vercel 超時實測（SAD R-1）
8. 記錄 migration 基線，交接 8.6
```

---

## Step 1：沿用現有 Supabase 專案當 Production

免費層只剩一個名額給 BizMate，故**不新建、不刪除**，直接把現有專案（本機
`.env.local` 指向的那個）升格為 production。

1. （選配）[Supabase Dashboard](https://supabase.com/dashboard) → Project Settings → General 把專案改名為 `BizMate`（純美觀）。
2. **記下這個專案的 Region**——Step 5 的 Vercel region 要對齊，降低 DB 往返延遲。
3. 到 **Project Settings → API** 抄下四個值（Step 5 要用；其實就是 `.env.local` 現有那組）：
   - `Project URL` → 對應 `SUPABASE_URL` 與 `NEXT_PUBLIC_SUPABASE_URL`（同值）
   - `service_role` secret → 對應 `SUPABASE_SERVICE_ROLE_KEY`（**極機密，勿外流**）
   - `anon` / `public` key → 對應 `NEXT_PUBLIC_SUPABASE_ANON_KEY`

> ⚠️ **不要刪這個專案**：它已套好 0001–0007 且 seed 過，是最接近 prod 的現成資產。刪掉重開會丟失手建帳號並得重跑全部 migration + seed，換來的結果完全相同。

---

## Step 2：確認 Migrations 已在位（現況已套用）

因沿用現有專案，`0001–0007` **已手動套用完畢，本步驟只需核對、不需重跑**。下方
清單保留供 (a) 核對用、(b) 萬一日後真的另建專案時從零套用的參考。

### Migration 基線清單

| # | 檔案 | 內容 | 為何不可跳 |
| :-- | :--- | :--- | :--- |
| 0001 | `0001_init.sql` | 多租戶 schema 全表 + RLS 啟用 + `service_role` GRANT ALL | 一切的地基 |
| 0002 | `0002_rate_limits.sql` | durable rate-limit 表 + 固定視窗原子 RPC | 公開端點防濫用 |
| 0003 | `0003_owner_policies.sql` | RLS owner policies + `GRANT SELECT` 給 `authenticated` | 少了它登入後查無資料 |
| 0004 | `0004_rate_card_soft_delete.sql` | `rate_card_base.is_active` 軟刪除欄 | 服務停售 |
| 0005 | `0005_quote_actions.sql` | confirm / adjust 兩個原子 RPC | 後台確認 / 調價 |
| 0006 | `0006_rename_advance_status.sql` | `confirm_quote` → `advance_quote_status`（+`p_set_sent_at`） | 確認與寄信共用 |
| 0007 | `0007_revoke_public_execute.sql` | REVOKE PUBLIC EXECUTE、re-GRANT `service_role` | 8.3 安全修復，勿漏 |

### 套用方式（擇一）

**方式 A — Supabase SQL Editor（最簡單，逐檔貼上）**
1. Dashboard → SQL Editor → New query。
2. 依 `0001 → 0007` 順序，逐檔把 `supabase/migrations/00XX_*.sql` 全文貼上 → Run。
3. 每檔跑完確認無紅色錯誤再進下一檔。所有 migration 皆設計為冪等，重跑安全。

**方式 B — Supabase CLI（需先 link 專案）**
```bash
# 需安裝 supabase CLI 並 supabase login
supabase link --project-ref <production-project-ref>
supabase db push   # 依 migrations 目錄順序套用
```

### 核對（沿用現有專案，直接用 .env.local）

因 production 就是本機 `.env.local` 指向的專案，直接跑既有捷徑核對即可：
```bash
pnpm db:verify        # 14/14 表可存取
pnpm verify:security  # RPC 對 anon 回 permission denied for function（0007 已套用的證明）
```

---

## Step 3：Seed 範本 + 建示範商家

`seed:rate-card` 冪等地做三件事：灌全域範本、建 `dev` 商家（`dev@bizmate.local`，slug=`dev`）、把範本複製到該商家。這給你一個**立即可 demo 的 `/q/dev` 連結**（作品集展示用）。

> ⚠️ npm script（`pnpm seed:rate-card`）寫死讀 `.env.local`。對 production 執行時，**不要**用該捷徑，改建 `.env.production.local`（已被 `.gitignore` 排除）填入 Step 1 的 production 值，再跑原始指令：

```bash
tsx --env-file=.env.production.local scripts/seed-rate-card.ts
```

> 這個「verify/seed 腳本寫死 `.env.local`」的限制，正是 8.5/8.6 要在 CI 用正規 env 注入解決的問題之一。

---

## Step 4：建 Gemini / Resend 金鑰

| 金鑰 | 取得處 | 對應環境變數 |
| :--- | :--- | :--- |
| Gemini API key | [Google AI Studio](https://aistudio.google.com/apikey) | `GEMINI_API_KEY` |
| Resend API key | [Resend → API Keys](https://resend.com/api-keys) | `RESEND_API_KEY` |
| 寄件者 | 共享網域固定值 | `EMAIL_FROM` = `BizMate <onboarding@resend.dev>` |

---

## Step 5：Vercel 專案設定

1. [Vercel](https://vercel.com/new) → Import Git Repository → 選 `ychsieh725/BizMate`。
2. Framework 會自動偵測為 **Next.js**；Build/Install 指令自動（pnpm 由 lockfile 偵測），**無需改**。
3. **Project Settings → General → Node.js Version → 選 `22.x`**（釘版本確保建置可重現；不寫進 `package.json` engines 是為了不與本機 Node 24 / pnpm engine-strict 衝突）。
4. **Project Settings → Functions → Region → 選 Step 1 對齊的區域**（如 Singapore `sin1` / Tokyo `hnd1`），降低 function ↔ Supabase 延遲。
5. **Settings → Environment Variables**，全部設為 **Production**（也可勾 Preview）：

| 變數 | 值來源 | 缺了會怎樣 |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Step 1 Project URL | **啟動即 fail-fast**，整站起不來 |
| `SUPABASE_SERVICE_ROLE_KEY` | Step 1 service_role secret | 同上 |
| `NEXT_PUBLIC_SUPABASE_URL` | 同 `SUPABASE_URL` | 同上 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Step 1 anon key | 同上 |
| `GEMINI_API_KEY` | Step 4 | `/describe`、`/answer` 報錯（報價流程斷） |
| `RESEND_API_KEY` | Step 4 | 寄信 502（報價信寄不出） |
| `EMAIL_FROM` | `BizMate <onboarding@resend.dev>` | 同上 |

> 前四項是 `src/lib/env.ts` 的核心變數，**啟動時 zod 驗證**，缺一即整個 app 拋錯。後三項為功能性，缺了只有對應功能報錯。

---

## Step 6：部署 + 冒煙測試

設好環境變數後，Vercel 會自動從 `main` 觸發部署（或手動 Redeploy）。部署完成拿到 `https://<專案>.vercel.app`，逐項手動確認：

- [ ] 首頁（`/`）正常載入、CTA 可點
- [ ] `/login` 用示範帳號登入（`dev@bizmate.local`，或你在 Supabase Studio 手建的帳號）
- [ ] `/q/dev` 匿名走完一筆報價（**觸發 Gemini** — 驗證 Parser / 計價 / 反問）
- [ ] 後台 `/dashboard/quotes` 看到該筆報價 → 確認 → 寄信（**觸發 Resend**，收信匣核對主旨/內文）
- [ ] `/dashboard/services` 改價後，新報價反映新價

> 註冊：此 dev 慣例的示範帳號由 `seed:rate-card` 建立。若要新帳號，於 Supabase Studio → Authentication 手動新增（公開 `/signup` 是否開放依專案 Auth 設定）。

---

## Step 7：Vercel 超時實測（SAD R-1）

風險 SAD R-1：長 LLM 呼叫可能撞 Vercel function 逾時被 504。緩解已內建——`/describe`、`/answer` 兩路由已設 `export const maxDuration = 60`（Hobby 上限）。

實測：
1. 走幾筆 `/q/dev` 報價，於 **Vercel → Deployment → Functions / Logs** 觀察 `describe`、`answer` 的實際執行秒數。
2. 確認無 `FUNCTION_INVOCATION_TIMEOUT` / 504。
3. 若實際耗時逼近 60s，記錄下來——代表 Hobby 方案對此 workload 偏緊，未來需評估 Pro（可到 300s）或把計價拆成非同步。

---

## Step 8：記錄 Migration 基線，交接 8.6

- Production 目前 migration 基線 = **0007**（本次手動套到此為止）。
- 8.6（CI migration 管線）將以此基線為起點：日後 merge to `main` 時，CI 先自動套用 `0008+` 新 migration，成功才放行 Vercel 部署。
- **向後相容約定**（8.6 需遵守，此處先立）：新欄位可空、不直接改名 / 刪欄，確保「舊代碼 + 新 schema」過渡窗口安全。

---

## 回滾（Rollback）

| 情境 | 動作 |
| :--- | :--- |
| 程式碼壞 | Vercel → Deployments → 前一個成功版本 → **Promote to Production**（秒級回滾） |
| Migration 壞 | Supabase 無自動回滾；套用前先於 SQL Editor 備份受影響表，或用 Point-in-Time Recovery（付費方案） |
| 密鑰外洩 | 立即於 Supabase / Google / Resend 輪換，並更新 Vercel 環境變數後 Redeploy |

---

## 附錄：這個分支改了什麼

| 檔案 | 變更 | 用途 |
| :--- | :--- | :--- |
| `src/app/api/sessions/[id]/describe/route.ts` | `+ export const maxDuration = 60` | SAD R-1：LLM 路由逾時上限 |
| `src/app/api/sessions/[id]/answer/route.ts` | `+ export const maxDuration = 60` | 同上 |
| `docs/deployment.md` | 新增本文件 | 部署 runbook |

> Node 版本、Region、環境變數**刻意不寫進 repo**——它們屬部署環境設定，於 Vercel Dashboard 設定（見 Step 5），避免與本機開發環境衝突、也避免密鑰進版控。

---
---

# agent-service（Python）部署 — 尚未上線

> 對應設計文件〈部署架構〉。**現況：agent-service 只在本機執行，正式站沒有部署
> 它。** 設計文件 v3 假設可用單一 Vercel project 同時承載 Next.js 與 Python，
> 該假設在 2026-08-17 實測後**不成立**，詳見下節。

## 實測結論：單一 project 承載兩個 runtime 目前不可行

三種設定各實際部署一次，結果如下：

| 設定 | 結果 |
| :--- | :--- |
| `experimentalServices` | Vercel 拒絕：「no longer available for new projects」 |
| `services` + `bindings` | 建置成功，但沒有任何路由生效——連首頁都 404，錯誤為 `Build output contains no "functions" or "static" directory` |
| **沒有 `vercel.json`** | ✅ `/` 200、`/q/dev` 200、`/api/internal/pricing/compute` 401 |

`services` 這條路另外踩到兩個限制：它沒有 `mount` 屬性（服務位址改由 `bindings`
以環境變數注入，不是路徑前綴路由），且雙向 `bindings` 會被判定為
`circular service binding: web -> agent -> web`。改成單向綁定後建置會過，但
Next.js 的建置產物沒有被掛到根路徑，等於整站失效。

**因此本 repo 不放 `vercel.json`**，正式站維持純 Next.js 部署。

## 這對正式站沒有影響

`AGENT_LOOP_ENABLED` 預設關閉，且 `AGENT_SERVICE_URL` 未設定時
`callAgentService` 直接回 `not_configured`，orchestrator fallback 到既有的
`resolveAfterParse`——**正式站行為與導入 agent 之前完全相同**（不變式 I-3）。
Python 服務目前的角色是本機開發與離線 eval，不在使用者請求路徑上。

## 要上線時怎麼做：拆成第二個 Vercel project

這原本就是設計文件記載的退路，現在升格為唯一可行路徑：

1. 於 Vercel 新建 project，Root Directory 指向 `agent-service`
2. 該 project 設定 `INTERNAL_SERVICE_SECRET`（與 web 同值）、`SUPABASE_URL`、
   `SUPABASE_SERVICE_ROLE_KEY`、`GEMINI_API_KEY`、`WEB_SERVICE_URL`
3. 把 web project 的 `AGENT_SERVICE_URL` 改為新 project 的網域
4. 兩個 project 的環境變數都要**同時勾選 Production 與 Preview**——只勾一個，
   另一個環境會在合併後才發現缺變數

**程式碼一行都不用改。** 這是把服務位址放在環境變數而非寫死的理由。

代價：preview deployment 的兩個服務版本不再自動對應，需自行確認前端 preview
打到的是哪一版 agent-service。

### 上線後的冒煙測試

```bash
# 1. 探活（公開，應回 200）
curl -s https://<agent 網域>/health

# 期望：{"success":true,"data":{"status":"ok","service":"agent-service",...},"error":null}

# 2. 未帶 secret（應回 401——部署在公開網域上，shared secret 是唯一防線）
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST https://<agent 網域>/agent/echo \
  -H 'content-type: application/json' -d '{"message":"hi"}'

# 期望：401

# 3. 帶 secret（應回 200 並回音）
curl -s -X POST https://<agent 網域>/agent/echo \
  -H 'content-type: application/json' \
  -H "x-internal-secret: $INTERNAL_SERVICE_SECRET" \
  -d '{"message":"來自部署驗證"}'

# 期望：{"success":true,"data":{"echo":"來自部署驗證",...},"error":null}
```

**第 2 項必須是 401。** 若回 200，代表認證沒生效，任何人都能呼叫你的 AI 層並
消耗 Gemini 額度——**立即停止部署並排查**。

> Bundle 控制：新 project 需在其 `vercel.json` 以 `functions.excludeFiles`
> 排除 `eval/`、`tests/`、`.venv/`。Python 無自動 tree-shaking，離線分析用的
> 相依若被打包會白吃 500 MB 額度。

## 失效行為（不變式 I-3）

agent-service 未部署、未設定、或整個掛掉時，系統**不會壞**：
`callAgentService` 回傳 `not_configured` / `unreachable` / `timeout`，
orchestrator 據此 fallback 到既有的 `resolveAfterParse`，產出與 agent 化之前
完全一致的結果。

> 這是刻意的設計：**agent 是加值層，不是必經路徑。**
> 部署 agent-service 失敗不應該讓報價流程停擺。

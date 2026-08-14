import { ArrowDown, Sparkles } from "lucide-react";

/**
 * Hero 的產品示意卡片：把「口語描述 → 結構化欄位 → 確定性計價」這條主鏈
 * 一次呈現。刻意用真實的資料形狀（欄位名稱、明細列、加總）而非抽象插圖——
 * 這條鏈本身就是產品價值，畫出來比任何比喻都直接。
 *
 * 以下為展示用示意資料，非即時查詢結果。
 */
const EXTRACTED_FIELDS = [
  { label: "類型", value: "角色設計" },
  { label: "數量", value: "1" },
  { label: "授權", value: "商用" },
  { label: "交期", value: "3 天" },
] as const;

const LINE_ITEMS = [
  { label: "角色設計 · 全身", amount: 8000 },
  { label: "商用授權", amount: 3200 },
  { label: "急件加價（3 天）", amount: 2000 },
] as const;

const TOTAL = LINE_ITEMS.reduce((sum, item) => sum + item.amount, 0);

const formatTWD = (amount: number) => `NT$ ${amount.toLocaleString("zh-TW")}`;

export function QuotePreview() {
  return (
    <figure className="relative m-0">
      {/* 品牌色光暈：純裝飾，給白底卡片一點空間深度 */}
      <div
        aria-hidden="true"
        className="absolute -inset-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_60%_at_50%_0%,var(--brand-glow),transparent)]"
      />

      <div className="overflow-hidden rounded-2xl border border-surface-line bg-white shadow-lift">
        <div className="flex items-center gap-2 border-b border-surface-line bg-surface-subtle px-5 py-3">
          <span className="size-2 rounded-full bg-brand" aria-hidden="true" />
          <span className="font-mono text-xs text-ink-faint">/q/chen-studio</span>
        </div>

        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium tracking-wide text-ink-faint">
              客戶輸入
            </span>
            <p className="rounded-xl bg-surface-subtle px-4 py-3 text-sm leading-relaxed text-ink">
              幫我畫一個角色，要商用，三天內要
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-brand">
            <ArrowDown className="size-3.5" aria-hidden="true" />
            <Sparkles className="size-3.5" aria-hidden="true" />
            AI 解析出結構化欄位
          </div>

          <ul className="flex flex-wrap gap-2">
            {EXTRACTED_FIELDS.map((field) => (
              <li
                key={field.label}
                className="flex items-baseline gap-1.5 rounded-lg border border-surface-line px-3 py-1.5 text-sm"
              >
                <span className="text-xs text-ink-faint">{field.label}</span>
                <span className="font-medium text-ink">{field.value}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-3 border-t border-surface-line pt-5">
            <span className="text-xs font-medium tracking-wide text-ink-faint">
              確定性計價（不經過 AI）
            </span>
            <ul className="flex flex-col gap-2">
              {LINE_ITEMS.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-ink-soft">{item.label}</span>
                  <span className="font-mono tabular-nums text-ink">
                    {formatTWD(item.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-surface-line pt-3">
              <span className="text-sm font-medium text-ink">合計</span>
              <span className="font-mono text-xl font-medium tabular-nums text-ink">
                {formatTWD(TOTAL)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

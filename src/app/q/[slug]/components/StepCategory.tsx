import type { CaseCategory } from "@/shared/types/domain.types";
import { Palette, Brush, LayoutTemplate } from "lucide-react";
import {
  CASE_CATEGORIES,
  CASE_CATEGORY_LABELS,
} from "@/shared/constants/categories.ts";

/**
 * Wizard Step 1：選擇案件類型（FR-CW-1）。
 * 單選即前進——點任一類型直接呼叫 onSelect，交由容器切到 Step 2。
 */
type StepCategoryProps = {
  onSelect: (category: CaseCategory) => void;
  disabled?: boolean;
};

/** 各案件類型的代表圖示（風格辨識用，非精確語意對應）。 */
const CATEGORY_ICONS: Record<CaseCategory, typeof Palette> = {
  graphic_design: Palette,
  illustration: Brush,
  web_design: LayoutTemplate,
};

export function StepCategory({ onSelect, disabled = false }: StepCategoryProps) {
  return (
    <section aria-labelledby="step-category-heading" className="flex flex-col gap-6">
      <header>
        <h1 id="step-category-heading" className="text-3xl font-semibold tracking-tight text-ink">
          你需要哪一類服務？
        </h1>
      </header>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
        {CASE_CATEGORIES.map((category) => {
          const Icon = CATEGORY_ICONS[category];
          return (
            <li key={category}>
              <button
                type="button"
                data-testid={`category-option-${category}`}
                disabled={disabled}
                onClick={() => onSelect(category)}
                className="flex min-h-[12rem] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-surface-line px-4 py-6 text-center transition-colors hover:-translate-y-0.5 hover:border-accent hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
              >
                <Icon className="h-10 w-10 text-accent" strokeWidth={1.6} aria-hidden="true" />
                <span className="text-base font-medium text-ink">
                  {CASE_CATEGORY_LABELS[category]}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

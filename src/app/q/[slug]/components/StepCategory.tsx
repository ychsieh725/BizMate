import type { CaseCategory } from "@/shared/types/domain.types";
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

export function StepCategory({ onSelect, disabled = false }: StepCategoryProps) {
  return (
    <section aria-labelledby="step-category-heading" className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium tracking-widest text-zinc-500 uppercase">
          步驟 1 / 4
        </p>
        <h1 id="step-category-heading" className="text-2xl font-semibold tracking-tight">
          你需要哪一類服務？
        </h1>
      </header>

      <ul className="flex flex-col gap-3">
        {CASE_CATEGORIES.map((category) => (
          <li key={category}>
            <button
              type="button"
              data-testid={`category-option-${category}`}
              disabled={disabled}
              onClick={() => onSelect(category)}
              className="flex w-full items-center justify-between rounded-2xl border border-black/[.08] px-5 py-4 text-left text-base font-medium transition-colors hover:border-foreground/40 hover:bg-black/[.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.04]"
            >
              <span>{CASE_CATEGORY_LABELS[category]}</span>
              <span aria-hidden="true" className="text-zinc-400">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

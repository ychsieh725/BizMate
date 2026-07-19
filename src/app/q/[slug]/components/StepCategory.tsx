import type { CaseCategory } from "@/shared/types/domain.types";
import {
  CASE_CATEGORIES,
  CASE_CATEGORY_LABELS,
} from "@/shared/constants/categories.ts";
import { StepProgress } from "./StepProgress.tsx";

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
      <header className="flex flex-col gap-3">
        <StepProgress current={1} />
        <h1 id="step-category-heading" className="text-2xl font-semibold tracking-tight text-ink">
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
              className="flex w-full items-center justify-between rounded-2xl border border-surface-line px-5 py-4 text-left text-base font-medium text-ink transition-colors hover:border-accent hover:bg-surface-subtle focus:outline-none focus:ring-2 focus:ring-accent-soft disabled:opacity-50"
            >
              <span>{CASE_CATEGORY_LABELS[category]}</span>
              <span aria-hidden="true" className="text-ink-faint">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TOTAL_STEPS = 4;

/** 純函式：判斷某個進度點是否應顯示為已填（目前步驟與之前的步驟）。 */
export function isStepFilled(step: number, current: number): boolean {
  return step <= current;
}

/**
 * 五步驟精靈的視覺進度指示器（WBS 視覺重設計 Phase 2）。
 * 點狀進度條取代原本的文字「步驟 N/4」；用 sr-only 文字保留螢幕閱讀器可讀性，
 * 視覺點本身標 aria-hidden 避免重複朗讀。
 */
export function StepProgress({ current }: { current: 1 | 2 | 3 | 4 }) {
  const steps = Array.from({ length: TOTAL_STEPS }, (_, index) => index + 1);

  return (
    <div className="flex items-center gap-2">
      <span className="sr-only">
        步驟 {current} / {TOTAL_STEPS}
      </span>
      <div aria-hidden="true" className="flex items-center gap-2">
        {steps.map((step) => (
          <span
            key={step}
            className={`h-2 rounded-full transition-all ${
              isStepFilled(step, current) ? "w-6 bg-accent" : "w-2 bg-surface-line"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

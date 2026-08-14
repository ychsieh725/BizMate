import { ListChecks, Link2, MailCheck } from "lucide-react";

const STEPS = [
  {
    icon: ListChecks,
    title: "設定你的價目表",
    description:
      "註冊後系統給你一份預設價目表，改成自己的單價與加價規則即可。之後每筆報價都即時依這份表計算。",
  },
  {
    icon: Link2,
    title: "把專屬連結傳給客戶",
    description:
      "你會拿到一個 /q/你的代號 連結。客戶點開直接描述需求，全程匿名、不需註冊，資訊不足時系統會自動追問。",
  },
  {
    icon: MailCheck,
    title: "審核後一鍵寄出",
    description:
      "報價進到後台待審，你可以看到每一項金額的計算依據並隨時調整，確認後系統直接寄出正式報價單給客戶。",
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="scroll-mt-16 border-b border-surface-line bg-surface-subtle"
    >
      <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <span className="text-xs font-medium tracking-wide text-brand">
            怎麼運作
          </span>
          <h2
            id="how-it-works-heading"
            className="text-3xl font-semibold tracking-tight text-ink text-balance sm:text-4xl"
          >
            設定一次，之後每筆報價都自動跑完
          </h2>
        </div>

        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex flex-col gap-4 rounded-2xl border border-surface-line bg-white p-6 shadow-card"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <step.icon className="size-5" aria-hidden="true" />
                </span>
                <span className="font-mono text-sm tabular-nums text-ink-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="text-lg font-medium text-ink">{step.title}</h3>
              <p className="text-sm leading-relaxed text-ink-soft">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

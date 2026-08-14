import { Calculator, Gauge, ShieldCheck } from "lucide-react";

const REPO_URL = "https://github.com/ychsieh725/BizMate";

/** 數據皆取自 golden set v1.0.0 的實測基準線與 repo 現況，非行銷估值。 */
const METRICS = [
  { value: "97.1%", label: "欄位抽取準確率" },
  { value: "0%", label: "幻覺率" },
  { value: "503", label: "自動化測試" },
] as const;

const PILLARS = [
  {
    icon: Calculator,
    title: "金額不經過 AI 計算",
    description:
      "AI 只負責把口語轉成結構化欄位，金額一律由程式查表算出。報價因此可解釋、可稽核，惡意輸入也改不動任何一個數字。",
  },
  {
    icon: Gauge,
    title: "用資料集量測 AI 品質",
    description:
      "36 則標註案例、11 項指標構成回歸基準線。單元測試擋不住的抽取錯誤，在這裡被量出來——準確率因此從 81.4% 提升到 97.1%。",
  },
  {
    icon: ShieldCheck,
    title: "多租戶三道防線",
    description:
      "應用層守門、資料庫 RLS、原子操作層層設限，並由對真實資料庫執行的腳本驗證跨租戶隔離確實成立。",
  },
] as const;

export function TechHighlights() {
  return (
    <section
      aria-labelledby="tech-heading"
      className="bg-accent-ink text-white"
    >
      <div className="mx-auto max-w-6xl px-6 py-20 lg:py-24">
        <div className="flex max-w-2xl flex-col gap-4">
          <span className="text-xs font-medium tracking-wide text-[#9db4f5]">
            技術設計
          </span>
          <h2
            id="tech-heading"
            className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
          >
            不只是串了一個 AI API
          </h2>
          <p className="text-lg leading-relaxed text-white/70 text-pretty">
            報價會直接變成金錢往來，AI 猜錯的成本由使用者承擔。
            所以這個系統的重心，是把「AI 到底準不準」變成可以量測、會回歸的工程指標。
          </p>
        </div>

        <dl className="mt-14 grid gap-8 border-y border-white/10 py-10 sm:grid-cols-3">
          {METRICS.map((metric) => (
            <div key={metric.label} className="flex flex-col gap-1">
              <dt className="order-2 text-sm text-white/60">{metric.label}</dt>
              <dd className="order-1 font-mono text-4xl font-medium tabular-nums text-[#9db4f5]">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>

        <ul className="mt-12 grid gap-8 md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <li key={pillar.title} className="flex flex-col gap-3">
              <pillar.icon className="size-5 text-[#9db4f5]" aria-hidden="true" />
              <h3 className="text-lg font-medium">{pillar.title}</h3>
              <p className="text-sm leading-relaxed text-white/70">
                {pillar.description}
              </p>
            </li>
          ))}
        </ul>

        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-12 inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          在 GitHub 上看實作與測試
        </a>
      </div>
    </section>
  );
}

import { OnboardingForm } from "./OnboardingForm.tsx";

export default function OnboardingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold text-ink">歡迎使用 BizMate</h1>
      <p className="max-w-sm text-center text-sm text-ink-soft">
        填寫商家名稱，系統會自動產生你的專屬報價連結。
      </p>
      <OnboardingForm />
    </main>
  );
}

import Link from "next/link";
import { SignupForm } from "./SignupForm.tsx";

export default function SignupPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold text-ink">註冊 BizMate</h1>
      <SignupForm />
      <p className="text-sm text-ink-soft">
        已經有帳號？{" "}
        <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
          登入
        </Link>
      </p>
    </main>
  );
}

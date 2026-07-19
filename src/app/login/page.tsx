import Link from "next/link";
import { LoginForm } from "./LoginForm.tsx";

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold text-ink">登入 BizMate</h1>
      <LoginForm />
      <p className="text-sm text-ink-soft">
        還沒有帳號？{" "}
        <Link href="/signup" className="font-medium text-accent hover:text-accent-hover">
          註冊
        </Link>
      </p>
    </main>
  );
}

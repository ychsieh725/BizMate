import { requireMerchant } from "@/lib/auth/requireMerchant.ts";
import { servicesRepository } from "@/domains/pricing/repositories/servicesRepository.ts";
import { ServicesTable } from "./ServicesTable.tsx";
import { NewServiceForm } from "./NewServiceForm.tsx";

export default async function ServicesPage() {
  const auth = await requireMerchant();
  // layout 已攔截未登入/無商家的情況（不會渲染到這裡）；
  // 這裡的 if 只是讓 TypeScript 把 auth 窄化成 { ok: true, merchantId } 型別。
  if (!auth.ok) {
    return null;
  }

  const [items, modifiers] = await Promise.all([
    servicesRepository.findAllByMerchant(auth.merchantId),
    servicesRepository.findModifiersByMerchant(auth.merchantId),
  ]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <h1 className="text-ink text-2xl font-semibold tracking-tight">服務項目管理</h1>
      <div className="card-float rounded-[24px] bg-[var(--surface)] p-6">
        <NewServiceForm />
      </div>
      <div className="card-float rounded-[24px] bg-[var(--surface)] p-6">
        <ServicesTable initialItems={items} />
      </div>
      <section className="card-float flex flex-col gap-2 rounded-[24px] bg-[var(--surface)] p-6 text-xs">
        <h2 className="text-ink-soft font-medium">加成規則（唯讀）</h2>
        {modifiers.length === 0 ? (
          <p className="text-sm text-gray-600">尚無加成規則</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">名稱</th>
                <th className="py-2">觸發條件</th>
                <th className="py-2">幅度</th>
              </tr>
            </thead>
            <tbody>
              {modifiers.map((modifier) => (
                <tr key={modifier.id} className="border-b">
                  <td className="py-2">{modifier.modifier_name}</td>
                  <td className="py-2">{modifier.trigger_condition}</td>
                  <td className="py-2">
                    {modifier.range_min}–{modifier.range_max}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

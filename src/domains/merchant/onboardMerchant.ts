import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";
import { copyTemplateRateCard } from "@/domains/merchant/onboardingService.ts";
import { generateUniqueSlug } from "@/domains/merchant/slugGenerator.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";

export type OnboardResult = { merchant: Tables<"merchants">; created: boolean };

/**
 * onboarding 核心：使用者第一次登入後建立自己的 merchant 列 + 複製範本價目表。
 * 真冪等：已有 merchant 直接回傳既有列，不覆蓋 display_name、不重複複製範本。
 */
export async function onboardMerchant(
  userId: string,
  email: string,
  displayName: string,
): Promise<OnboardResult> {
  const existing = await merchantsRepository.findById(userId);
  if (existing !== null) {
    return { merchant: existing, created: false };
  }

  const slug = await generateUniqueSlug(email, async (candidate) => {
    const found = await merchantsRepository.findBySlug(candidate);
    return found !== null;
  });

  const merchant = await merchantsRepository.create({
    id: userId,
    display_name: displayName,
    public_slug: slug,
    contact_email: email,
  });

  await copyTemplateRateCard(merchant.id);

  return { merchant, created: true };
}

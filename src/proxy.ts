import { NextResponse, type NextRequest } from "next/server";
import { getUserIdAndResponse } from "@/lib/supabase/middlewareClient.ts";
import {
  decideRedirect,
  needsMerchantLookup,
} from "@/lib/auth/redirectDecision.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";

export async function proxy(request: NextRequest) {
  const { userId, response } = await getUserIdAndResponse(request);
  const pathname = request.nextUrl.pathname;

  // /dashboard 路徑不查 merchants（hasMerchant 取預設 true）：
  // 無 merchant 的使用者由 layout 的 requireMerchant 403 → redirect /onboarding
  // 守門，行為等價，但最高頻的後台導覽省下每次一趟序列 DB 往返。
  const hasMerchant =
    userId !== null && needsMerchantLookup(pathname)
      ? (await merchantsRepository.findById(userId)) !== null
      : true;

  const target = decideRedirect(pathname, userId !== null, hasMerchant);
  if (target !== null) {
    return NextResponse.redirect(new URL(target, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*", "/login", "/signup"],
};

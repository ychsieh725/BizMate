import { NextResponse, type NextRequest } from "next/server";
import { getUserAndResponse } from "@/lib/supabase/middlewareClient.ts";
import { decideRedirect } from "@/lib/auth/redirectDecision.ts";
import { merchantsRepository } from "@/domains/merchant/repositories/merchantsRepository.ts";

export async function proxy(request: NextRequest) {
  const { user, response } = await getUserAndResponse(request);

  const hasMerchant =
    user !== null
      ? (await merchantsRepository.findById(user.id)) !== null
      : false;

  const target = decideRedirect(
    request.nextUrl.pathname,
    user !== null,
    hasMerchant,
  );
  if (target !== null) {
    return NextResponse.redirect(new URL(target, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*", "/login", "/signup"],
};

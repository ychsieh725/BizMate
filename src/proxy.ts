import { NextResponse, type NextRequest } from "next/server";
import { getUserAndResponse } from "@/lib/supabase/middlewareClient.ts";
import { decideRedirect } from "@/lib/auth/redirectDecision.ts";

export async function proxy(request: NextRequest) {
  const { user, response } = await getUserAndResponse(request);

  const target = decideRedirect(request.nextUrl.pathname, user !== null);
  if (target !== null) {
    return NextResponse.redirect(new URL(target, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding/:path*", "/login", "/signup"],
};

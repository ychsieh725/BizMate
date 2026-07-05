import { NextResponse } from "next/server";
import type { ApiResponse } from "@/shared/types/domain.types";

/**
 * 統一 API 回應信封（patterns.md「一致的信封格式」、SDS §5）。
 * 所有 route handler 都透過這兩個函式回應，避免各處手拼 JSON 結構。
 */

/** 成功回應（預設 200）。 */
export function apiOk<T>(
  data: T,
  status = 200,
): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ success: true, data, error: null }, { status });
}

/** 失敗回應——data 恆為 null，帶面向使用者的友善錯誤訊息。 */
export function apiFail(
  error: string,
  status: number,
): NextResponse<ApiResponse<null>> {
  return NextResponse.json({ success: false, data: null, error }, { status });
}

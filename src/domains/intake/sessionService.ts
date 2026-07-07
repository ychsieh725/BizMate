import type {
  CaseCategory,
  SessionStatus,
} from "@/shared/types/domain.types";
import { sessionsRepository } from "@/domains/intake/repositories/sessionsRepository.ts";

/** 建立 session 的結果（對應 SDS §5.1 POST /sessions 回應） */
export interface CreatedSession {
  readonly sessionId: string;
  readonly status: SessionStatus;
}

/**
 * 建立新 session（Wizard Step 1）。
 * merchantId 由 route 從分享連結 slug 解析而得，掛在 session 上供下游流程讀取。
 * status 與 current_step 交由 DB default（created / 1）填入，不在此硬編碼。
 */
export async function createSession(
  category: CaseCategory,
  merchantId: string,
): Promise<CreatedSession> {
  const session = await sessionsRepository.create({
    category,
    merchant_id: merchantId,
  });
  return { sessionId: session.id, status: session.status };
}

/**
 * 查詢 session 目前狀態（Wizard 等待畫面輪詢用）。
 * 查無回傳 null，由呼叫端（route）決定回應 404。
 */
export async function getSessionStatus(
  id: string,
): Promise<SessionStatus | null> {
  const session = await sessionsRepository.findById(id);
  return session?.status ?? null;
}

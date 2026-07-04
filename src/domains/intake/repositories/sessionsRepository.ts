import {
  BaseRepository,
  RepositoryError,
} from "@/lib/supabase/repository.ts";
import type { Tables } from "@/lib/supabase/database.types.ts";
import type { SessionStatus } from "@/shared/types/domain.types.ts";

/**
 * sessions 表的具體 repository（示範如何以泛型基底擴充領域專屬查詢）。
 * 繼承標準 CRUD，額外提供依狀態查詢——Orchestrator 狀態機（任務 3.1）會用到。
 */
export class SessionsRepository extends BaseRepository<"sessions"> {
  constructor() {
    super("sessions");
  }

  /** 找出特定狀態的所有 session（例如撈出所有 awaiting_freelancer 待確認報價） */
  async findByStatus(status: SessionStatus): Promise<Tables<"sessions">[]> {
    const { data, error } = await this.client
      .from("sessions")
      .select("*")
      .eq("status", status);
    if (error) {
      throw new RepositoryError("sessions", "findByStatus", error.message);
    }
    return data ?? [];
  }
}

/** 單例，供領域邏輯直接引用 */
export const sessionsRepository = new SessionsRepository();

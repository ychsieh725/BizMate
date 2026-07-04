import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client.ts";
import type {
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/lib/supabase/database.types.ts";

type TableName = keyof Database["public"]["Tables"];

/** Repository 層錯誤，帶明確上下文（表名、操作、原始訊息），供伺服器端記錄 */
export class RepositoryError extends Error {
  constructor(
    readonly table: string,
    readonly operation: string,
    readonly detail: string,
  ) {
    super(`[${table}.${operation}] ${detail}`);
    this.name = "RepositoryError";
  }
}

/**
 * 泛型資料存取基底（Repository Pattern，patterns.md）。
 * 封裝標準 CRUD 於一致介面後，業務邏輯只依賴此抽象，不碰 supabase-js 細節。
 * 前提：每張表都有 UUID 主鍵 `id`（見 0001_init.sql，全表皆符合）。
 *
 * 各領域以具體 repository 繼承此類別（見 domains/.../repositories）。
 */
export class BaseRepository<T extends TableName> {
  constructor(protected readonly table: T) {}

  protected get client(): SupabaseClient<Database> {
    return getSupabaseClient();
  }

  /**
   * 未參數化的 client 視圖。
   * supabase-js 的表格型別是高度條件式的，泛型表名 T 下無法正確 narrow
   * （from(T).eq("id") / select 結果都會失效）。基底內部改以預設泛型 client
   * 操作，型別安全改由對外方法簽章（Tables<T> / TablesInsert<T> 等）保證。
   */
  private get raw(): SupabaseClient {
    return this.client as unknown as SupabaseClient;
  }

  async findAll(): Promise<Tables<T>[]> {
    const { data, error } = await this.raw.from(this.table).select("*");
    if (error) {
      throw new RepositoryError(this.table, "findAll", error.message);
    }
    return (data ?? []) as Tables<T>[];
  }

  async findById(id: string): Promise<Tables<T> | null> {
    const { data, error } = await this.raw
      .from(this.table)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw new RepositoryError(this.table, "findById", error.message);
    }
    return (data as Tables<T> | null) ?? null;
  }

  async create(payload: TablesInsert<T>): Promise<Tables<T>> {
    const { data, error } = await this.raw
      .from(this.table)
      .insert(payload)
      .select()
      .single();
    if (error) {
      throw new RepositoryError(this.table, "create", error.message);
    }
    return data as Tables<T>;
  }

  async update(id: string, patch: TablesUpdate<T>): Promise<Tables<T>> {
    const { data, error } = await this.raw
      .from(this.table)
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      throw new RepositoryError(this.table, "update", error.message);
    }
    return data as Tables<T>;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.raw.from(this.table).delete().eq("id", id);
    if (error) {
      throw new RepositoryError(this.table, "delete", error.message);
    }
  }
}

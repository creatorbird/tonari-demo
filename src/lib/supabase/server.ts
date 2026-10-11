import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * サーバー専用の Supabase クライアント（service_role キー使用）。
 * RLS を越えて rooms テーブルを操作できるため、絶対にクライアントへ渡さないこと。
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です。",
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { isValidRoomId } from "@/lib/room";

/** ルームの有効期限（ホストが閉じ忘れても一定時間で無効になる） */
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** ルームを作成し、ID とホスト用トークンを返す */
export async function createRoom(): Promise<{ roomId: string; hostToken: string }> {
  const roomId = randomUUID(); // UUID v4
  const hostToken = randomBytes(32).toString("hex");

  const { error } = await getSupabaseAdminClient()
    .from("rooms")
    .insert({ id: roomId, host_token_hash: hashToken(hostToken) });
  if (error) throw new Error(`ルームの作成に失敗しました: ${error.message}`);

  return { roomId, hostToken };
}

/** ルームが存在し、終了されておらず、期限切れでもないか */
export async function isRoomActive(roomId: string): Promise<boolean> {
  if (!isValidRoomId(roomId)) return false;

  const { data, error } = await getSupabaseAdminClient()
    .from("rooms")
    .select("active, created_at")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(`ルームの確認に失敗しました: ${error.message}`);
  if (!data || !data.active) return false;

  return Date.now() - new Date(data.created_at).getTime() < ROOM_TTL_MS;
}

/** ホスト用トークンが正しい場合のみルームを無効化する。成功したら true */
export async function closeRoom(roomId: string, hostToken: string): Promise<boolean> {
  if (!isValidRoomId(roomId) || !hostToken) return false;

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("rooms")
    .select("host_token_hash")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw new Error(`ルームの確認に失敗しました: ${error.message}`);
  if (!data) return false;

  const expected = Buffer.from(data.host_token_hash, "hex");
  const actual = Buffer.from(hashToken(hostToken), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return false;
  }

  const { error: updateError } = await supabase
    .from("rooms")
    .update({ active: false, closed_at: new Date().toISOString() })
    .eq("id", roomId);
  if (updateError) throw new Error(`ルームの終了に失敗しました: ${updateError.message}`);
  return true;
}

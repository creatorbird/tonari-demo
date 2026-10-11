import { NextResponse } from "next/server";
import { closeRoom } from "@/lib/rooms.server";

// ホストの「ルームを終了する」ボタン、またはページを閉じたとき（sendBeacon）に呼ばれる
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/rooms/[roomId]/close">,
) {
  const { roomId } = await ctx.params;

  let hostToken: unknown;
  try {
    ({ hostToken } = (await request.json()) as { hostToken?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof hostToken !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const closed = await closeRoom(roomId, hostToken);
    if (!closed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[rooms:close]", e);
    return NextResponse.json({ error: "close_failed" }, { status: 500 });
  }
}

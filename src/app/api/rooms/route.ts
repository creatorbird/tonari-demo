import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit.server";
import { createRoom } from "@/lib/rooms.server";

// 同一IPからのルーム作成は 1分間に 10 回まで
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`create-room:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const { roomId, hostToken } = await createRoom();
    return NextResponse.json({ roomId, hostToken });
  } catch (e) {
    console.error("[rooms:create]", e);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }
}

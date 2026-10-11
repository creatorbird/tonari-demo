import { NextResponse } from "next/server";
import { LANGUAGES } from "@/lib/languages";
import { checkRateLimit } from "@/lib/rateLimit.server";
import { isValidRoomId } from "@/lib/room";
import { isRoomActive } from "@/lib/rooms.server";
import { TranslationError, translateText, type TranslationResult } from "@/lib/translate.server";
import type { TranslateStreamEvent } from "@/lib/translateStream";

const MAX_TEXT_LENGTH = 1000;
// 1ルームあたり 1分間に 60 回まで（常時認識の先読み翻訳は、送信1回につき最大1回ほど増える）
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;

function errorCode(e: unknown): "translate_unavailable" | "translate_failed" {
  // 全エンジンが混雑・障害中なら、クライアントは時間をおいて再送できる
  return e instanceof TranslationError && e.temporary ? "translate_unavailable" : "translate_failed";
}

function normalizeLangCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // 前後の空白・大文字小文字の揺れを吸収する（例: " KO " → "ko"、"ZH-tw" → "zh-TW"）
  const normalized = value.trim().toLowerCase();
  return LANGUAGES.find((l) => l.code.toLowerCase() === normalized)?.code ?? null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const { roomId, text } = fields;
  // true なら訳せた部分から NDJSON で少しずつ返す
  const stream = fields.stream === true;
  // 言語コードは前後の空白を除去して検証する（大文字小文字の揺れも許容）
  const sourceLang = normalizeLangCode(fields.sourceLang);
  const targetLang = normalizeLangCode(fields.targetLang);

  if (
    typeof roomId !== "string" ||
    !isValidRoomId(roomId) ||
    typeof text !== "string" ||
    !sourceLang ||
    !targetLang
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "invalid_text" }, { status: 400 });
  }

  try {
    // 終了済み・存在しないルームからのリクエストは拒否する
    if (!(await isRoomActive(roomId))) {
      return NextResponse.json({ error: "room_inactive" }, { status: 403 });
    }

    if (!checkRateLimit(`translate:${roomId}`, RATE_LIMIT, RATE_WINDOW_MS)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    if (sourceLang === targetLang) {
      const result: TranslationResult = { translated: trimmed, engine: "none", firstTextMs: 0, totalMs: 0 };
      return stream ? ndjson([{ type: "done", ...result }]) : NextResponse.json(result);
    }

    if (stream) return streamTranslation(request, trimmed, sourceLang, targetLang);

    // どのエンジンが訳しても同じ形で返す
    const result = await translateText(trimmed, sourceLang, targetLang, { signal: request.signal });
    return NextResponse.json(result);
  } catch (e) {
    console.error("[translate]", e);
    const code = errorCode(e);
    return NextResponse.json({ error: code }, { status: code === "translate_unavailable" ? 503 : 500 });
  }
}

const NDJSON_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  // 途中のプロキシに溜め込ませず、1行ずつすぐ届ける
  "X-Accel-Buffering": "no",
};

function ndjson(events: TranslateStreamEvent[]): Response {
  const body = events.map((event) => JSON.stringify(event) + "\n").join("");
  return new Response(body, { headers: NDJSON_HEADERS });
}

/** 訳せた部分から1行ずつ返す。クライアントが切断・取り消したら、生成も途中で止める */
function streamTranslation(
  request: Request,
  text: string,
  sourceLang: string,
  targetLang: string,
): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: TranslateStreamEvent) => {
        if (abort.signal.aborted) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        const result = await translateText(text, sourceLang, targetLang, {
          onPartial: (partial) => write({ type: "partial", text: partial }),
          onReset: () => write({ type: "reset" }),
          signal: abort.signal,
        });
        write({ type: "done", ...result });
      } catch (e) {
        if (!abort.signal.aborted) {
          console.error("[translate]", e);
          write({ type: "error", error: errorCode(e) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // 切断済み
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(body, { headers: NDJSON_HEADERS });
}

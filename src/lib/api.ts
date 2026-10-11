/** ブラウザから自前の API Routes を呼び出すためのヘルパー */

import type { TranslateDoneEvent, TranslateStreamEvent } from "@/lib/translateStream";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(`API error: ${code} (${status})`);
  }
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 15_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // サーバーが応答しないまま「翻訳中」が続かないよう打ち切る
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError("network_error", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(data.error ?? "unknown", res.status);
  return data;
}

export function requestCreateRoom() {
  return postJson<{ roomId: string; hostToken: string }>("/api/rooms", {});
}

export async function requestCloseRoom(roomId: string, hostToken: string) {
  await postJson(`/api/rooms/${roomId}/close`, { hostToken });
}

/** ページを閉じる瞬間でも届くよう sendBeacon でルーム終了を送る */
export function beaconCloseRoom(roomId: string, hostToken: string) {
  const blob = new Blob([JSON.stringify({ hostToken })], { type: "application/json" });
  navigator.sendBeacon(`/api/rooms/${roomId}/close`, blob);
}

export type TranslationStreamHandlers = {
  /** 生成途中の訳文（それまでの全文） */
  onPartial?: (text: string) => void;
  /** サーバーが別のエンジンで訳し直す。それまでの途中経過は捨てる */
  onReset?: () => void;
  /** 先読みの取り消しなど、呼び出し元が不要になったら中断する */
  signal?: AbortSignal;
};

/**
 * 訳せた部分から少しずつ受け取りながら翻訳する。確定した訳文で解決し、失敗したら ApiError。
 * 応答は1行1イベントの NDJSON（partial / reset / done / error）
 */
export async function requestTranslationStream(
  params: { roomId: string; text: string; sourceLang: string; targetLang: string },
  { onPartial, onReset, signal }: TranslationStreamHandlers = {},
): Promise<TranslateDoneEvent> {
  // サーバー側のフォールバック（最大25秒）より少し長く待つ
  const signals = [AbortSignal.timeout(35_000)];
  if (signal) signals.push(signal);

  let res: Response;
  try {
    res = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, stream: true }),
      signal: AbortSignal.any(signals),
    });
  } catch {
    throw new ApiError(signal?.aborted ? "aborted" : "network_error", 0);
  }
  // 入力の不備・終了済みルーム・利用上限などは、ストリームを始める前に通常の JSON で返る
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? "unknown", res.status);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as TranslateStreamEvent;
        if (event.type === "partial") onPartial?.(event.text);
        else if (event.type === "reset") onReset?.();
        else if (event.type === "error") throw new ApiError(event.error, 503);
        else if (event.type === "done") {
          // どの翻訳エンジンが使われても、空や不正な応答は失敗として扱う
          if (typeof event.translated !== "string" || !event.translated.trim()) break;
          return event;
        }
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(signal?.aborted ? "aborted" : "network_error", 0);
  } finally {
    reader.cancel().catch(() => undefined);
  }
  // 確定版が届かないまま切れた
  throw new ApiError("invalid_response", 502);
}

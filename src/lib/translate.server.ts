import "server-only";
import { t } from "@/lib/i18n";

/*
 * デモ版の翻訳処理。翻訳 API は一切呼ばない。
 *
 * 訳文の代わりに「翻訳結果はここに表示されます（デモ版）」を受け取る側の言語で返す。
 * 本番と同じ見え方にするため、数文字ずつ間をおいて onPartial で流す（ストリーミング表示）。
 * 間隔は DEMO_STREAM_DELAY_MS で変えられ、0 にすると待たずに一度で返す（速さの計測用）。
 */

/** 数文字ごとの待ち時間の既定値（ms） */
const DEFAULT_DELAY_MS = 40;
/** 1回に流す文字数（書記素単位。タイ語などの結合文字を途中で切らない） */
const CHUNK_GRAPHEMES = 2;

export class TranslationError extends Error {
  constructor(
    message: string,
    /** true なら一時的な失敗（時間をおけば成功しうる） */
    public readonly temporary: boolean,
  ) {
    super(message);
  }
}

export type TranslationResult = {
  translated: string;
  /** 訳したエンジン（デモ版は常に "demo"） */
  engine: string;
  /** 翻訳を始めてから最初の文字ができるまで（ms） */
  firstTextMs: number;
  /** 翻訳を始めてから訳し終わるまで（ms） */
  totalMs: number;
};

type TranslateHooks = {
  /** 生成途中の訳文（それまでの全文） */
  onPartial?: (partial: string) => void;
  /** 本番では別エンジンで訳し直すときに呼ぶ。デモ版では使わない */
  onReset?: () => void;
  /** 呼び出し元が不要になった（先読みの取り消し・接続断） */
  signal?: AbortSignal;
};

function streamDelayMs(): number {
  const value = Number(process.env.DEMO_STREAM_DELAY_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DELAY_MS;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function splitGraphemes(text: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
}

/** 決まった文言を、受け取る側の言語で少しずつ返す（翻訳 API は呼ばない） */
export async function translateText(
  _text: string,
  _sourceLang: string,
  targetLang: string,
  hooks: TranslateHooks = {},
): Promise<TranslationResult> {
  const translated = t(targetLang, "demoTranslation");
  const delay = streamDelayMs();
  const startedAt = Date.now();
  let firstTextAt: number | null = null;

  if (delay > 0 && hooks.onPartial) {
    const graphemes = splitGraphemes(translated);
    for (let i = CHUNK_GRAPHEMES; i < graphemes.length + CHUNK_GRAPHEMES; i += CHUNK_GRAPHEMES) {
      await sleep(delay, hooks.signal);
      firstTextAt ??= Date.now();
      hooks.onPartial(graphemes.slice(0, i).join(""));
    }
  }
  hooks.signal?.throwIfAborted();

  const finishedAt = Date.now();
  return {
    translated,
    engine: "demo",
    firstTextMs: (firstTextAt ?? finishedAt) - startedAt,
    totalMs: finishedAt - startedAt,
  };
}

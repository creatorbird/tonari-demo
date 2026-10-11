/**
 * /api/translate のストリーミング応答（NDJSON）の1行。サーバーとブラウザで共有する。
 * partial: 生成途中の訳文（それまでの全文） / reset: 途中経過を捨てて訳し直す /
 * done: 確定した訳文 / error: 全エンジンが失敗した
 */
export type TranslateStreamEvent =
  | { type: "partial"; text: string }
  | { type: "reset" }
  | {
      type: "done";
      translated: string;
      engine: string;
      /** サーバーで翻訳を始めてから最初の文字ができるまで（ms） */
      firstTextMs: number;
      /** サーバーで翻訳を始めてから訳し終わるまで（ms） */
      totalMs: number;
    }
  | { type: "error"; error: "translate_unavailable" | "translate_failed" };

export type TranslateDoneEvent = Extract<TranslateStreamEvent, { type: "done" }>;

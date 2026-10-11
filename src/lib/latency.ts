/**
 * 翻訳の速さの計測（送った人の端末で測る）。
 *
 * - firstTextMs: 送信してから、訳文の最初の文字が自分の端末に届くまで。
 *   この瞬間に相手へも配信するので「相手の画面に最初の文字が出るまで」の目安になる
 *   （Realtime の配信にかかる数十 ms は含まない）
 * - totalMs: 送信してから訳文が確定するまで
 * - speculative: 話し終わる前に始めていた先読み翻訳をそのまま使えたか
 *
 * 画面の右下に出す計測パネル（?metrics=1）と、開発者ツールのコンソールから参照できる。
 */

export type LatencySample = {
  firstTextMs: number;
  totalMs: number;
  /** サーバー側で測った、AI が最初の文字を出すまでの時間 */
  serverFirstTextMs: number;
  engine: string;
  speculative: boolean;
  at: number;
};

export type LatencySummary = {
  count: number;
  speculativeHits: number;
  firstText: { median: number; p90: number };
  total: { median: number; p90: number };
  last: LatencySample | null;
};

const MAX_SAMPLES = 100;
let samples: LatencySample[] = [];
let summary: LatencySummary = summarize([]);
const listeners = new Set<() => void>();

export function recordLatency(sample: Omit<LatencySample, "at">): void {
  const entry = { ...sample, at: Date.now() };
  samples = [...samples, entry].slice(-MAX_SAMPLES);
  summary = summarize(samples);
  console.info(
    `[latency] first=${Math.round(entry.firstTextMs)}ms total=${Math.round(entry.totalMs)}ms ` +
      `server-first=${entry.serverFirstTextMs}ms engine=${entry.engine}` +
      (entry.speculative ? " (先読み)" : ""),
  );
  listeners.forEach((listener) => listener());
}

/** useSyncExternalStore 用 */
export function subscribeLatency(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLatencySummary(): LatencySummary {
  return summary;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(list: LatencySample[]): LatencySummary {
  const first = list.map((s) => s.firstTextMs).sort((a, b) => a - b);
  const total = list.map((s) => s.totalMs).sort((a, b) => a - b);
  return {
    count: list.length,
    speculativeHits: list.filter((s) => s.speculative).length,
    firstText: { median: percentile(first, 50), p90: percentile(first, 90) },
    total: { median: percentile(total, 50), p90: percentile(total, 90) },
    last: list.at(-1) ?? null,
  };
}

if (typeof window !== "undefined") {
  // コンソールから `tonariLatency()` で一覧を確認できる
  (window as Window & { tonariLatency?: () => void }).tonariLatency = () => {
    console.table(samples);
    console.info(summary);
  };
}

import "server-only";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * 簡易レート制限（固定ウィンドウ）。
 * サーバーのメモリ上で数えるため、複数インスタンス構成では厳密ではない。
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

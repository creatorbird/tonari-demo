"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getLatencySummary, subscribeLatency } from "@/lib/latency";

const STORAGE_KEY = "tonari:metrics";

/** URL に ?metrics=1 を付けて開くと表示し、?metrics=0 で消す（端末に記憶する） */
function useMetricsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("metrics");
    try {
      if (param === "1") localStorage.setItem(STORAGE_KEY, "1");
      if (param === "0") localStorage.removeItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnabled(param === "1" || (param !== "0" && localStorage.getItem(STORAGE_KEY) === "1"));
    } catch {
      setEnabled(param === "1");
    }
  }, []);
  return enabled;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

/**
 * デモ・計測用の小さなパネル。自分が送った発言について、
 * 送信してから最初の文字が出るまで（初回）と、訳し終わるまで（完了）の中央値・90%値を出す
 */
export function LatencyPanel() {
  const enabled = useMetricsEnabled();
  const summary = useSyncExternalStore(subscribeLatency, getLatencySummary, getLatencySummary);
  if (!enabled) return null;

  return (
    <aside
      aria-label="Latency"
      className="pointer-events-none fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] right-2 z-40 rounded-2xl bg-zinc-900/85 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-100 shadow-soft backdrop-blur"
    >
      {summary.count === 0 ? (
        <p>⚡ 計測待ち…</p>
      ) : (
        <>
          <p>
            ⚡ 初回 <b className="text-emerald-300">{seconds(summary.firstText.median)}</b>
            <span className="text-zinc-400"> p90 {seconds(summary.firstText.p90)}</span>
          </p>
          <p>
            ✓ 完了 <b>{seconds(summary.total.median)}</b>
            <span className="text-zinc-400"> p90 {seconds(summary.total.p90)}</span>
          </p>
          <p className="text-zinc-400">
            n={summary.count} 先読み {summary.speculativeHits}
            {summary.last && ` · ${summary.last.engine.split(":").at(-1)}`}
          </p>
        </>
      )}
    </aside>
  );
}

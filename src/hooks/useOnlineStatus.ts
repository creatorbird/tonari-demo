"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * 端末がネットワークにつながっているか（機内モード・圏外で false）。
 * Realtime の切断検知（数十秒かかる）より早く分かるので、送信待ちに回す判断に使う。
 * true でも実際には通信できないこと（つながらない Wi-Fi など）はあるので、通信の失敗とあわせて判断する
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // サーバー側では分からないので、つながっている前提で描画する
    () => true,
  );
}

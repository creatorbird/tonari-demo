"use client";

import { useEffect } from "react";

function isEditable(el: Element | null): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/**
 * 画面全体を h-dvh に収めるレイアウトでは、ページ（window）自体はスクロールしない前提。
 * ところが iOS Safari はキーボード表示時に入力欄を見せるため window をずらし、
 * キーボードを閉じてもそのまま戻らないことがある。この状態ではタップ位置と表示がずれ、
 * スワイプが効かなくなる（ピンチで拡大縮小すると再計算されて直る）。
 * キーボードが閉じたタイミングで window の位置を原点に戻して、これを防ぐ。
 */
export function useStableViewport() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reset = () => {
      clearTimeout(timer);
      // キーボードを閉じるアニメーションが終わってから判定する
      timer = setTimeout(() => {
        if (isEditable(document.activeElement)) return;
        if (window.scrollX !== 0 || window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      }, 100);
    };

    const viewport = window.visualViewport;
    document.addEventListener("focusout", reset);
    viewport?.addEventListener("resize", reset);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusout", reset);
      viewport?.removeEventListener("resize", reset);
    };
  }, []);
}

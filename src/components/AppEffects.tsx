"use client";

import { useEffect } from "react";
import { haptic } from "@/lib/haptics";

/**
 * 画面には何も描かず、アプリ全体に効く処理だけを受け持つ。
 * - 立体ボタン（chunky）を押し込んだ瞬間に、物理ボタンのような短い振動を返す
 * - 以前のバージョンで登録した Service Worker（インストール機能、廃止済み）を端末から取り除く
 */
export function AppEffects() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      const button = (event.target as Element | null)?.closest?.("button.chunky");
      if (button instanceof HTMLButtonElement && !button.disabled) haptic("tap");
    };
    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return null;
}

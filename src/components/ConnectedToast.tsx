"use client";

import { useEffect, useState } from "react";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

type Props = {
  /** false → true に変わった瞬間に一度だけ知らせる（相手と初めてつながったとき） */
  active: boolean;
  /** 表示言語 */
  lang: string;
};

/** 「接続完了」を出しておく時間 */
const TOAST_MS = 2_400;

/** 相手とつながった瞬間の「接続完了」の一言と振動。操作の邪魔をしないよう触れても素通りする */
export function ConnectedToast({ active, lang }: Props) {
  const [toast, setToast] = useState(false);

  // つながった瞬間（false → true）だけを拾う。開き直したときや再接続では繰り返さない
  const [prevActive, setPrevActive] = useState(active);
  if (active !== prevActive) {
    setPrevActive(active);
    if (active) setToast(true);
  }

  useEffect(() => {
    if (!toast) return;
    haptic("success");
    const timer = setTimeout(() => setToast(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[max(1rem,env(safe-area-inset-top))] z-50 flex justify-center px-4"
    >
      <p className="animate-pop-in rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white shadow-soft">
        {t(lang, "connectedReady")}
      </p>
    </div>
  );
}

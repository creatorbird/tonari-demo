import type { ReactNode } from "react";

type Props = {
  open: boolean;
  children: ReactNode;
  className?: string;
  /** 開いているとき、親に高さを詰められたら中身をスクロールさせる */
  scrollable?: boolean;
};

/**
 * 高さを滑らかに開閉する。grid-template-rows を 0fr ⇄ 1fr で遷移させるので
 * 中身の高さを事前に知らなくてもアニメーションできる。
 */
export function Collapse({ open, children, className = "", scrollable = false }: Props) {
  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={`grid transition-[grid-template-rows,opacity,translate] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        open ? "grid-rows-[1fr] translate-y-0 opacity-100" : "grid-rows-[0fr] -translate-y-2 opacity-0"
      } ${className}`}
    >
      <div
        className={`min-h-0 ${open && scrollable ? "overflow-y-auto overscroll-contain" : "overflow-hidden"}`}
      >
        {children}
      </div>
    </div>
  );
}

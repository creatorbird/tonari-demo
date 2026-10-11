"use client";

import type { ReactNode } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { LANGUAGES, languageLabel } from "@/lib/languages";

type Props = {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
};

/** 設定リストの1行。左にラベル、右に現在の言語（タップで選択） */
export function LanguageSelect({ id, label, value, onChange, disabled }: Props) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-3.5">
      <label htmlFor={id} className="shrink-0 text-[13px] text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      <div className="relative flex min-w-0 items-center text-blue-600 dark:text-blue-400">
        {/* iOS のフォーカス時ズームを防ぐため 16px のまま、見た目の余白だけを詰める */}
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 cursor-pointer appearance-none truncate bg-transparent py-2 pr-5 text-right text-base font-medium focus:outline-none focus-visible:underline disabled:opacity-50 [text-align-last:right]"
        >
          {LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {languageLabel(lang.code)}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-0 opacity-70">
          <ChevronDownIcon />
        </span>
      </div>
    </div>
  );
}

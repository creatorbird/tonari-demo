import { ChevronDownIcon } from "@/components/icons";
import { biInline } from "@/lib/i18n";

type Props = {
  /** 表示言語 */
  lang: string;
  myLang: string;
  /** 相手の言語（未確定なら null） */
  peerLang: string | null;
  open: boolean;
  onToggle: () => void;
};

/** ヘッダーに出す「JA ⇄ KO」ピル。押すと設定パネルを開閉する（接続状態は StatusIndicator が示す） */
export function SettingsToggle({ lang, myLang, peerLang, open, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={biInline(lang, "settings")}
      title={biInline(lang, "settings")}
      className="chunky flex shrink-0 animate-fade-in items-center gap-2 rounded-full border-b-zinc-300 bg-white px-3.5 py-1.5 text-sm font-bold text-zinc-700 shadow-soft-sm hover:bg-zinc-50 dark:border-b-zinc-950 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
    >
      <span className="font-mono tracking-wide">
        {myLang.toUpperCase()}
        {peerLang && (
          <>
            <span className="mx-1 text-zinc-400">⇄</span>
            {peerLang.toUpperCase()}
          </>
        )}
      </span>
      <span className={`transition-transform duration-500 ease-spring ${open ? "rotate-180" : ""}`}>
        <ChevronDownIcon />
      </span>
    </button>
  );
}

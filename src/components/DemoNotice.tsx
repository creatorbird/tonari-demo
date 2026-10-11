import { t } from "@/lib/i18n";

/** 「デモ版：翻訳は行いません」をヘッダーの端に小さく出す */
export function DemoNotice({ lang }: { lang: string }) {
  return (
    <span className="min-w-0 truncate text-[10px] text-amber-700 dark:text-amber-400">
      {t(lang, "demoNotice")}
    </span>
  );
}

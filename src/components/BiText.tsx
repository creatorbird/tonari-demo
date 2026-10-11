import { bi, type MessageKey } from "@/lib/i18n";

type Props = {
  lang: string;
  k: MessageKey;
  vars?: Record<string, string>;
  /** 英語を改行して小さく表示する（false なら「 / 」区切りで1行） */
  stacked?: boolean;
};

/** 選択した言語の文言と英語を併記する */
export function BiText({ lang, k, vars, stacked = true }: Props) {
  const { primary, english } = bi(lang, k, vars);
  if (!english) return <>{primary}</>;
  if (!stacked) return <>{`${primary} / ${english}`}</>;
  return (
    <>
      <span className="block">{primary}</span>
      <span className="block text-[0.75em] font-normal opacity-70">{english}</span>
    </>
  );
}

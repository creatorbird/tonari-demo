"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BiText } from "@/components/BiText";
import { ClockIcon, SpeakerIcon, StopIcon } from "@/components/icons";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";
import type { ChatMessage, Role } from "@/hooks/useRoomChannel";
import { haptic } from "@/lib/haptics";
import { biInline, t } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";

type Props = {
  messages: ChatMessage[];
  myRole: Role;
  /** 表示言語 */
  lang: string;
  /** 失敗した自分のメッセージを再送する */
  onRetry: (id: string) => void;
  /** 相手のマイクが声を拾っている最中（末尾に波形の吹き出しを出す） */
  peerSpeaking?: boolean;
};

/** 最下部からこの距離（px）以内なら「一番下にいる」とみなす */
const BOTTOM_THRESHOLD = 48;

export function MessageList({ messages, myRole, lang, onRetry, peerSpeaking = false }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // 直前のスクロール位置で一番下にいたか。内容が伸びても scroll イベントは来ないので、
  // 新着を描画する直前の状態として扱える
  const atBottomRef = useRef(true);
  // scrollToBottom で動かしている最中か
  const autoScrollingRef = useRef(false);
  const lastIdRef = useRef<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const synthesis = useSpeechSynthesis();
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  // scrollIntoView は window まで巻き込んでスクロールし、iOS でキーボード表示中に
  // レイアウトビューポートがずれたまま固まる原因になるため、コンテナだけを動かす
  const scrollToBottom = useCallback((smooth: boolean) => {
    const el = scrollerRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = smooth && !reduceMotion ? "smooth" : "auto";
    atBottomRef.current = true;
    autoScrollingRef.current = behavior === "smooth";
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
    if (atBottom) {
      autoScrollingRef.current = false;
      setHasUnread(false);
    }
    // スムーズスクロールの途中経過では「一番下から離れた」と判定しない
    if (!autoScrollingRef.current) atBottomRef.current = atBottom;
  };

  // ユーザーが触れたら自動スクロール中の扱いをやめ、実際の位置で判定する
  const handleUserScrollIntent = () => {
    autoScrollingRef.current = false;
  };

  // 新着メッセージ: 一番下にいたときと自分が送ったときだけ追従し、
  // 過去ログを読んでいる最中なら位置を保ったまま通知ボタンを出す
  const lastMessage = messages.at(-1);
  useLayoutEffect(() => {
    const prevLastId = lastIdRef.current;
    lastIdRef.current = lastMessage?.id ?? null;
    if (!lastMessage || lastMessage.id === prevLastId) return;
    // 相手の発言が届いたら、画面を見ていなくても手に伝わるよう短く震わせる
    if (lastMessage.from !== myRole) haptic("receive");
    if (prevLastId === null) {
      // 初回描画
      scrollToBottom(false);
    } else if (atBottomRef.current || lastMessage.from === myRole) {
      scrollToBottom(true);
      setHasUnread(false);
    } else {
      setHasUnread(true);
    }
  }, [lastMessage, myRole, scrollToBottom]);

  // 「翻訳中 → 確定」で吹き出しが伸びたときや、キーボードの出し入れ・設定パネルの開閉で
  // 表示領域が縮んだときも、一番下にいたなら一番下に留める
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    observer.observe(scroller);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const handleSpeak = (message: ChatMessage) => {
    if (!message.translated) return;
    if (synthesis.speaking && speakingId === message.id) {
      synthesis.cancel();
      setSpeakingId(null);
      return;
    }
    const locale = getLanguage(message.targetLang)?.speechLocale ?? message.targetLang;
    synthesis.speak(message.translated, locale);
    setSpeakingId(message.id);
  };

  return (
    // 親の flex-col の中で残りの高さを占め、この中だけがスクロールする
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        onPointerDown={handleUserScrollIntent}
        onKeyDown={handleUserScrollIntent}
        onWheel={handleUserScrollIntent}
        className="-mx-1 h-full overflow-y-auto overscroll-contain px-1 [-webkit-overflow-scrolling:touch]"
      >
        <div ref={contentRef}>
          {messages.length === 0 && !peerSpeaking ? (
            <p className="py-8 text-center text-sm text-zinc-400">
              <BiText lang={lang} k="noMessages" />
            </p>
          ) : (
            renderMessages()
          )}
        </div>
      </div>

      {hasUnread && (
        <button
          type="button"
          onClick={() => {
            setHasUnread(false);
            scrollToBottom(true);
          }}
          className="chunky absolute bottom-3 left-1/2 flex -translate-x-1/2 animate-pop-in items-center gap-1.5 whitespace-nowrap rounded-full border-b-blue-600 bg-blue-500 px-4 py-2 text-sm font-bold text-white shadow-lg hover:bg-blue-400"
        >
          <span aria-hidden>↓</span>
          {t(lang, "newMessages")}
        </button>
      )}
    </div>
  );

  function renderMessages() {
    return (
      <ul className="flex flex-col gap-4" aria-live="polite">
        {messages.map((message) => {
          const mine = message.from === myRole;
          const showTranslation =
            message.translated !== null && message.translated !== message.original;

          if (mine) {
            // 自分の発言: 原文を即時に大きく表示し、翻訳（相手に届いた文）を下に小さく
            const failed = message.status === "failed";
            const queued = message.status === "queued";
            return (
              <li key={message.id} className="flex animate-fade-in-up flex-col items-end gap-1">
                <div
                  className={`max-w-[85%] rounded-3xl rounded-br-lg px-4 py-3 shadow-soft-sm transition-colors ${
                    failed
                      ? "bg-white text-zinc-900 ring-2 ring-red-300 dark:bg-zinc-900 dark:text-zinc-50"
                      : queued
                        ? // 送信待ち: まだ相手に届いていないので、色を抜いて控えめに見せる
                          "bg-blue-600/55 text-white"
                        : "bg-blue-600 text-white"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words text-lg">{message.original}</p>
                  {/* 翻訳中: 訳せた部分から少しずつ出す。最初の文字が届くまでは波打つ3つのドット */}
                  {message.status === "translating" &&
                    (message.partial ? (
                      <p className="mt-1 whitespace-pre-wrap break-words border-t border-white/25 pt-1 text-sm text-blue-100">
                        {message.partial}
                        <StreamingCaret />
                      </p>
                    ) : (
                      <div className="mt-2 border-t border-white/25 pb-1 pt-3">
                        <TypingDots lang={lang} tone="onAccent" />
                      </div>
                    ))}
                  {message.status === "sent" && showTranslation && (
                    <p className="mt-1 whitespace-pre-wrap break-words border-t border-white/25 pt-1 text-sm text-blue-100">
                      {message.translated}
                    </p>
                  )}
                </div>
                {queued && (
                  <p
                    title={t(lang, "queuedHint")}
                    className="flex max-w-[85%] items-center gap-1 px-1 text-xs text-zinc-500 dark:text-zinc-400"
                  >
                    <ClockIcon />
                    <span className="truncate">
                      {t(lang, "queued")} · {t(lang, "queuedHint")}
                    </span>
                  </p>
                )}
                {failed && (
                  <div className="flex max-w-[85%] flex-wrap items-center justify-end gap-2 text-sm">
                    <span className="text-red-600">
                      <BiText lang={lang} k="translateFailed" stacked={false} />
                    </span>
                    <button
                      type="button"
                      onClick={() => onRetry(message.id)}
                      className="chunky rounded-full border-b-red-500 bg-red-400 px-3.5 py-1 font-bold text-white hover:bg-red-300"
                    >
                      <BiText lang={lang} k="retry" stacked={false} />
                    </button>
                  </div>
                )}
              </li>
            );
          }

          // 相手の発言（翻訳待ち）: iMessage のようにドットだけの小さな吹き出しを出し、
          // 原文は吹き出しの下に小さく添える
          if (message.status !== "sent" && message.partial) {
            // 訳せた部分から、確定版と同じ大きさで少しずつ流れるように出す
            // （li の key と形をそろえ、確定したときに出し直しのアニメーションが起きないようにする）
            return (
              <li key={message.id} className="flex animate-fade-in-up justify-start">
                <div className="max-w-[90%] rounded-3xl rounded-bl-lg bg-white px-4 py-3 text-zinc-900 shadow-soft-sm dark:bg-zinc-800 dark:text-zinc-50">
                  <p
                    aria-busy
                    className="whitespace-pre-wrap break-words text-2xl font-semibold leading-snug"
                  >
                    {message.partial}
                    <StreamingCaret />
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-500 dark:text-zinc-400">
                    {message.original}
                  </p>
                </div>
              </li>
            );
          }
          if (message.status !== "sent" || message.translated === null) {
            return (
              <li key={message.id} className="flex animate-fade-in-up flex-col items-start gap-1">
                <div className="rounded-3xl rounded-bl-lg bg-white px-5 py-4 shadow-soft-sm dark:bg-zinc-800">
                  <TypingDots lang={lang} tone="neutral" />
                </div>
                <p className="max-w-[90%] whitespace-pre-wrap break-words px-2 text-xs text-zinc-400 dark:text-zinc-500">
                  {message.original}
                </p>
              </li>
            );
          }

          // 相手の発言（確定）: 自分の言語への翻訳を大きく、原文を小さく
          const isSpeaking = synthesis.speaking && speakingId === message.id;
          return (
            <li key={message.id} className="flex animate-fade-in-up justify-start">
              <div className="max-w-[90%] rounded-3xl rounded-bl-lg bg-white px-4 py-3 text-zinc-900 shadow-soft-sm dark:bg-zinc-800 dark:text-zinc-50">
                <div className="flex items-start gap-2">
                  <p className="flex-1 whitespace-pre-wrap break-words text-2xl font-semibold leading-snug">
                    {message.translated}
                  </p>
                  {synthesis.supported && (
                    <button
                      type="button"
                      onClick={() => handleSpeak(message)}
                      aria-label={biInline(lang, isSpeaking ? "stopReading" : "readAloud")}
                      title={biInline(lang, isSpeaking ? "stopReading" : "readAloud")}
                      className="chunky shrink-0 rounded-full border-b-zinc-300 bg-zinc-100 p-2 text-zinc-600 hover:bg-zinc-50 dark:border-b-zinc-900 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                    >
                      {isSpeaking ? <StopIcon /> : <SpeakerIcon />}
                    </button>
                  )}
                </div>
                {showTranslation && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-500 dark:text-zinc-400">
                    {message.original}
                  </p>
                )}
              </div>
            </li>
          );
        })}
        {peerSpeaking && (
          // 相手が話している最中: 送信される前から「いま話してくれている」ことを波形で伝える
          <li className="flex animate-fade-in-up justify-start">
            <div className="rounded-3xl rounded-bl-lg bg-white px-5 py-3.5 shadow-soft-sm dark:bg-zinc-800">
              <VoiceWave lang={lang} />
            </div>
          </li>
        )}
      </ul>
    );
  }
}

/** 生成途中の訳文の末尾で点滅するカーソル。「まだ続きを書いている」ことを示す */
function StreamingCaret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[0.9em] w-[3px] translate-y-[0.1em] rounded-full bg-current opacity-60 motion-safe:animate-pulse"
    />
  );
}

// 波形の縦棒ごとの動き。周期と開始をずらして、声の抑揚のような不規則さを出す
const VOICE_BARS = [
  { delay: 0, duration: 900 },
  { delay: 220, duration: 760 },
  { delay: 90, duration: 1040 },
  { delay: 330, duration: 820 },
  { delay: 150, duration: 960 },
];

/** 相手が話している最中の波形。動きを減らす設定では、明るさだけをゆっくり変える */
function VoiceWave({ lang }: { lang: string }) {
  return (
    <span role="status" aria-label={t(lang, "peerSpeaking")} className="flex h-5 items-center gap-[4px]">
      {VOICE_BARS.map(({ delay, duration }) => (
        <span
          key={delay}
          className="h-5 w-[4px] rounded-full bg-blue-400 motion-safe:animate-voice-bar motion-reduce:animate-typing-fade"
          style={{ animationDelay: `${delay}ms`, animationDuration: `${duration}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * iMessage のようなタイピングインジケーター。3つのドットが順番に波打ち、
 * 裏側で AI が翻訳を生成している最中であることを伝える（読み上げ用には文言を付ける）
 */
function TypingDots({ lang, tone }: { lang: string; tone: "neutral" | "onAccent" }) {
  const dot = tone === "onAccent" ? "bg-white" : "bg-zinc-400 dark:bg-zinc-400";
  return (
    // 高さに余裕を持たせ、持ち上がったドットが吹き出しの端に触れないようにする
    <span
      role="status"
      aria-label={biInline(lang, "translating")}
      className="flex h-4 items-center gap-[5px]"
    >
      {[0, 180, 360].map((delay) => (
        <span
          key={delay}
          // 動きを減らす設定では上下に動かさず、明るさだけをゆっくり変えて「進行中」を伝える
          className={`h-[9px] w-[9px] rounded-full motion-safe:animate-typing motion-reduce:animate-typing-fade ${dot}`}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

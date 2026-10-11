"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  isAnySpeechPlaying,
  useAnySpeechPlaying,
  useSpeechSynthesis,
} from "@/hooks/useSpeechSynthesis";
import { getLanguage } from "@/lib/languages";
import { t, type MessageKey } from "@/lib/i18n";
import { KeyboardIcon, MicIcon, SendIcon } from "@/components/icons";
import { haptic } from "@/lib/haptics";

type Props = {
  /** 入力する人の言語コード（音声認識・読み上げ・表示文言に使用） */
  lang: string;
  /** 送信処理。翻訳の完了を待たずにすぐ戻る（結果はチャット欄に反映される） */
  onSend: (text: string) => void;
  /** 相手が未接続などで送信できない */
  sendDisabled?: boolean;
  /**
   * 常時音声認識モード（話し終わるたびに自動で送信し、すぐ次の発話を待つ）。
   * 手動モードでも、入力欄の中のマイクで何度でも音声入力を追記できる（自動送信はしない）
   */
  handsFree: boolean;
  onHandsFreeChange: (handsFree: boolean) => void;
  /** マイクが実際に声を拾い始めた / 聞き取りが終わった（相手の画面に波形を出すため） */
  onSpeakingChange?: (speaking: boolean) => void;
  /** 常時認識で、話し終わる前の途中の文を先に訳し始めてもらう（先読み翻訳） */
  onPrefetch?: (text: string) => void;
  /**
   * 端末がオフライン。送った文は送信待ちに入る。音声認識もネットワークが要るので、
   * 常時認識は一時停止し、戻ったら自動で再開する（エラー扱いで手動モードに落とさない）
   */
  offline?: boolean;
};

// 単語間にスペースを入れない言語
const NO_SPACE_LANGS = new Set(["ja", "zh", "zh-TW", "th"]);

// 常時音声認識で、1回の発話が終わってから次の聞き取りを始めるまでの間隔
const RESTART_DELAY_MS = 300;

// 常時認識で、認識途中の文がこの時間変わらなければ「ひと区切りついた」とみて先読み翻訳を始める
const PREFETCH_DELAY_MS = 450;

// 入力欄は1行から始め、この高さまで伸びたら中でスクロールする
const MAX_TEXTAREA_HEIGHT = 128;

export function MessageComposer({
  lang,
  onSend,
  sendDisabled,
  handsFree,
  onHandsFreeChange,
  onSpeakingChange,
  onPrefetch,
  offline = false,
}: Props) {
  const [text, setText] = useState("");
  const [secure, setSecure] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // マイク開始時点で入力済みだったテキスト（音声認識結果はこの後ろに追記する）
  const baseTextRef = useRef("");
  const textRef = useRef(text);
  // 認識イベントのコールバックから最新の props を参照する
  const latestRef = useRef({ handsFree, sendDisabled, onSend, onPrefetch });
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 発話の区切りごとに増やし、常時音声認識の再開をうながす
  const [restartTick, setRestartTick] = useState(0);
  // ページが一度でもタップ・キー操作されたか。QR から開いた直後のように一度も操作していないと、
  // iOS Safari などはマイク（音声認識）を始めさせてくれず、エラーも出ないまま何も聞き取れない
  const [userActivated, setUserActivated] = useState(false);
  // 最初の操作のイベント内から、その場で常時音声認識を始める
  const startFromGestureRef = useRef<() => void>(() => {});
  // 今の聞き取りで、声（認識結果）を一度でも拾ったか。マイクが開いているだけでは「話している」としない
  const [heard, setHeard] = useState(false);
  // 送信のたびに増やし、送信ボタンの紙飛行機を飛ばし直す
  const [sendTick, setSendTick] = useState(0);
  const locale = getLanguage(lang)?.speechLocale ?? lang;

  const cancelPrefetch = () => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = null;
  };

  const joinTranscript = (transcript: string) => {
    const base = baseTextRef.current;
    const separator = base && transcript && !NO_SPACE_LANGS.has(lang) ? " " : "";
    return base + separator + transcript;
  };

  const recognition = useSpeechRecognition({
    locale,
    onTranscript: (transcript) => {
      // 読み上げ中に拾った音は相手の声（スピーカーの音）なので入力欄に出さない
      if (isAnySpeechPlaying()) return;
      setText(joinTranscript(transcript));
      if (!transcript.trim()) return;
      setHeard(true);
      // 常時認識: 途中の文が少しの間変わらなければ、話し終わりを待たずに訳し始める
      const latest = latestRef.current;
      cancelPrefetch();
      if (!latest.handsFree || latest.sendDisabled || !latest.onPrefetch) return;
      const pending = joinTranscript(transcript).trim();
      const prefetch = latest.onPrefetch;
      prefetchTimerRef.current = setTimeout(() => {
        prefetchTimerRef.current = null;
        prefetch(pending);
      }, PREFETCH_DELAY_MS);
    },
    onEnd: (transcript) => {
      cancelPrefetch();
      const latest = latestRef.current;
      if (!latest.handsFree) return;
      setRestartTick((n) => n + 1);
      // 常時音声認識: 話し終わったら確認なしでそのまま送る
      if (!transcript.trim() || latest.sendDisabled || isAnySpeechPlaying()) return;
      latest.onSend(joinTranscript(transcript).trim());
      setText("");
      setSendTick((n) => n + 1);
      haptic("send");
    },
    onError: () => {
      // マイク拒否などで再開を繰り返さないよう、手動モードに戻す。
      // ただし圏外になったことによる失敗なら、つながったときに自動で再開できるよう常時認識のままにする
      if (latestRef.current.handsFree && navigator.onLine) onHandsFreeChange(false);
    },
  });
  const synthesis = useSpeechSynthesis();
  // 読み上げの音声を自分の発言として拾わないよう、再生中は聞き取りを止める
  const speechPlaying = useAnySpeechPlaying();

  const {
    start: startRecognition,
    abort: abortRecognition,
    releaseMic,
    isRunning: isRecognitionRunning,
    listening,
  } = recognition;
  // 音声認識が使えない環境では、記憶された設定が常時認識でも手動として扱う（送信手段を失わないように）
  const voiceAvailable = recognition.supported && secure;
  const handsFreeMode = handsFree && voiceAvailable;
  const handsFreeActive =
    handsFreeMode && !sendDisabled && !speechPlaying && userActivated && !offline;
  // 常時認識モードだが、まだ一度も画面を操作していないので聞き取りを始められない
  const awaitingGesture = handsFreeMode && !userActivated;

  // 聞き取りが止まったら（中断・送信も含む）、まだ始めていない先読みは取りやめる
  useEffect(() => {
    if (!listening) cancelPrefetch();
  }, [listening]);
  useEffect(() => cancelPrefetch, []);

  // 聞き取りが終わったら「声を拾った」をリセットする（次の聞き取りは無音から始まる）
  const [prevListening, setPrevListening] = useState(listening);
  if (listening !== prevListening) {
    setPrevListening(listening);
    if (!listening) setHeard(false);
  }
  const speaking = listening && heard;

  // 話している間だけ相手に伝える。止まったとき・画面を離れたときは終わりを伝える
  useEffect(() => {
    if (!speaking || !onSpeakingChange) return;
    onSpeakingChange(true);
    return () => onSpeakingChange(false);
  }, [speaking, onSpeakingChange]);

  useEffect(() => {
    textRef.current = text;
    latestRef.current = { handsFree: handsFreeMode, sendDisabled, onSend, onPrefetch };
    startFromGestureRef.current = () => {
      if (!handsFreeMode || sendDisabled || speechPlaying || isRecognitionRunning()) return;
      baseTextRef.current = textRef.current.trimEnd();
      startRecognition();
    };
  });

  useEffect(() => {
    if (navigator.userActivation?.hasBeenActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUserActivated(true);
      return;
    }
    // ブラウザが「ユーザー操作」とみなすイベント（タッチでは pointerdown ではなく touchend / click）
    const events = ["touchend", "click", "keydown"] as const;
    const activate = () => {
      removeListeners();
      setUserActivated(true);
      // タイマーを挟むと操作由来と見なされないことがあるので、イベントの中で直接始める
      startFromGestureRef.current();
    };
    const removeListeners = () => {
      events.forEach((type) => window.removeEventListener(type, activate, true));
    };
    events.forEach((type) => window.addEventListener(type, activate, true));
    return removeListeners;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSecure(window.isSecureContext);
  }, []);

  // 常時音声認識: 聞き取りが止まっていたら少し待って再開する
  useEffect(() => {
    if (!handsFreeActive || listening) return;
    const timer = setTimeout(() => {
      // 最初の操作の中ですでに始めたセッションが、onstart を待っている最中なら作り直さない
      if (isRecognitionRunning()) return;
      baseTextRef.current = textRef.current.trimEnd();
      startRecognition();
    }, RESTART_DELAY_MS);
    return () => clearTimeout(timer);
  }, [handsFreeActive, listening, restartTick, startRecognition, isRecognitionRunning]);

  // 相手の退室・読み上げ開始などで一時停止するときは、途中の聞き取りを捨てる
  useEffect(() => {
    if (handsFreeMode && !handsFreeActive) abortRecognition();
  }, [handsFreeMode, handsFreeActive, abortRecognition]);

  // 読み上げが始まったら、その発話で入力欄に出ていた分も捨てる（スピーカーの音が混ざっているため）。
  // 読み上げが終われば上の再開処理で自動的に聞き取りに戻る
  useEffect(() => {
    if (handsFreeMode && speechPlaying) setText(baseTextRef.current);
  }, [handsFreeMode, speechPlaying]);

  // 手動モードの音声入力中に読み上げが始まったら、スピーカーの音を拾わないよう聞き取りを止める
  // （それまでに入った文は本人の発話なので残す）
  useEffect(() => {
    if (!handsFreeMode && speechPlaying) abortRecognition();
  }, [handsFreeMode, speechPlaying, abortRecognition]);

  // 手動モードでは、音声入力が終わるたびにエコーキャンセル用に取得したマイクを解放する
  useEffect(() => {
    if (!handsFreeMode && !listening) releaseMic();
  }, [handsFreeMode, listening, releaseMic]);

  // 入力欄を内容に合わせて伸縮させる（高さの変化はチャット欄が吸収する）
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // 空のときは1行の高さに戻す（プレースホルダーの長さで伸びないように）
    if (!text) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  const handleModeChange = (next: boolean) => {
    if (next === handsFree) return;
    // 開始処理の途中（onstart 待ち）のセッションも止める
    if (isRecognitionRunning()) recognition.abort();
    onHandsFreeChange(next);
  };

  /**
   * 手動モードの音声入力（タップで開始 / もう一度タップで停止）。
   * 認識結果は入力済みの文の後ろに追記されるだけで、話し終わっても送信も再開もしない
   * （onEnd で送信・再開するのは常時認識のときだけ）
   */
  const handleDictationToggle = () => {
    if (listening) {
      recognition.abort();
      return;
    }
    // 読み上げ中だと認識結果を捨ててしまうので、先に止める
    synthesis.cancel();
    baseTextRef.current = textRef.current.trimEnd();
    startRecognition();
  };

  const handleTextChange = (value: string) => {
    // 手動モードで音声入力中にキーボードで直し始めたら、認識結果で上書きしないよう聞き取りを止める
    if (!handsFreeMode && listening) recognition.abort();
    setText(value);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || sendDisabled) return;
    // 送信後に認識結果が入力欄へ戻ってこないよう中断する。
    // 常時認識中なら聞き取り途中の発話もここで区切って送り、聞き取りは自動で再開される
    recognition.abort();
    synthesis.cancel();
    // 楽観的UI: 翻訳を待たずに入力欄を空にし、すぐ次の発言を入力できるようにする
    onSend(trimmed);
    setText("");
    setSendTick((n) => n + 1);
    haptic("send");
  };

  /**
   * 常時認識中の送信ボタン。発話の終わり（VAD）を待たず、押した瞬間に画面に出ている文
   * （確定分 + 途中結果）をそのまま送る。認識はいったん中断してリセットし、
   * 上の再開処理で新しい聞き取りに戻る
   */
  const handleForceCommit = () => {
    if (sendDisabled) return;
    const pending = textRef.current.trim();
    if (!pending) {
      // 読み上げで聞き取りが止まっている: 読み上げを止めて、すぐ話せる状態に戻す
      if (speechPlaying) synthesis.cancel();
      return;
    }
    // 中断したセッションの結果は届かないので、送った文が入力欄に戻ったり二重送信されたりしない
    recognition.abort();
    synthesis.cancel();
    baseTextRef.current = "";
    textRef.current = "";
    onSend(pending);
    setText("");
    setSendTick((n) => n + 1);
    haptic("send");
    // すでに聞き取りが止まっていた場合も含め、確実に次の聞き取りを始める
    setRestartTick((n) => n + 1);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // スマホの改行と IME の確定を邪魔しないよう、送信は Ctrl / ⌘ + Enter だけ
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (handsFreeMode) handleForceCommit();
      else handleSend();
    }
  };

  const canSend = text.trim().length > 0 && !sendDisabled;

  let placeholderKey: MessageKey;
  if (sendDisabled) placeholderKey = "waitingPeer";
  else if (offline) placeholderKey = "offlineQueue";
  else if (handsFreeMode && speechPlaying) placeholderKey = "paused";
  else if (awaitingGesture) placeholderKey = "tapToStart";
  else if (handsFreeMode || listening) placeholderKey = "speakNow";
  else placeholderKey = "typeMessage";

  // 手動モードでは入力欄の右端に音声入力のマイクを常に置き、文字が入った後も何度でも追記できるようにする
  const showDictation = !handsFreeMode && voiceAvailable;
  // 常時認識中の録音ランプ。手動モードの録音中はマイク自体が赤く光るので出さない
  const liveListening = handsFreeMode && listening;
  // 常時認識モードでは、文字がまだ出ていなくても常に押せる（発話の強制確定ボタン）。
  // 「聞き取り中」かどうかで切り替えると、発話の合間や iOS の再起動のたびに一瞬グレーになるため、
  // モードだけで判定する
  const sendEnabled = !sendDisabled && (canSend || handsFreeMode);

  let notice: { key: MessageKey; tone: "muted" | "warn" | "error" } | null = null;
  if (recognition.error) notice = { key: recognition.error, tone: "error" };
  else if (!recognition.supported) notice = { key: "micUnsupported", tone: "muted" };
  else if (!secure) notice = { key: "httpsRequired", tone: "warn" };

  return (
    <div className="flex flex-col gap-1.5">
      {/*
        モード切替・入力欄・送信（マイク）ボタンをひとつのカプセルに収める。
        角の丸みは中の部品（高さ 44px の丸）に余白 6px を足した 28px にして、内外の曲線をそろえる
      */}
      <div className="flex items-end gap-1 rounded-[28px] bg-white p-1.5 shadow-soft transition-shadow duration-200 focus-within:ring-4 focus-within:ring-blue-400/20 dark:bg-zinc-900">
        <ModeSwitch
          lang={lang}
          handsFree={handsFreeMode}
          handsFreeAvailable={voiceAvailable}
          onChange={handleModeChange}
        />

        {/* 赤枠はエラーを連想させるので使わない。録音中であることは右端のランプだけで示す */}
        <div className="relative flex min-w-0 flex-1 items-end">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t(lang, placeholderKey)}
            aria-label={t(lang, "message")}
            rows={1}
            // 入力文字は 16px 以上にして iOS のフォーカス時ズームを防ぐ。
            // プレースホルダーは一回り小さくし、折り返さず1行に収める
            className={`block max-h-32 min-h-11 w-full resize-none bg-transparent py-[11px] pl-2 text-base leading-[22px] text-zinc-900 outline-none placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap placeholder:text-sm placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500 ${
              showDictation ? "pr-11" : liveListening ? "pr-8" : "pr-3"
            }`}
          />
          {/* 録音中ランプ: ボタンではなく、入力欄の右端で小さく明滅して「聞いている」ことだけを示す */}
          {liveListening && (
            <span
              role="status"
              aria-label={t(lang, "speakNow")}
              className="pointer-events-none absolute right-3 top-[22px] flex h-2.5 w-2.5 -translate-y-1/2 animate-fade-in"
            >
              <span className="absolute inset-0 rounded-full bg-red-400 motion-safe:animate-live-ring" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-red-400 motion-safe:animate-breathe" />
            </span>
          )}
          {/*
            手動モードの音声入力（インナーマイク）。送信ボタンとは別に入力欄の中へ常設し、
            タップで開始 / もう一度タップで停止。文字が入った後に押すと、その後ろに追記する
          */}
          {showDictation && (
            <button
              type="button"
              onClick={handleDictationToggle}
              aria-label={t(lang, listening ? "stopVoiceInput" : "voiceInput")}
              aria-pressed={listening}
              title={t(lang, listening ? "stopVoiceInput" : "voiceInput")}
              className={`absolute bottom-1 right-1 flex h-9 w-9 items-center justify-center rounded-full transition-[background-color,color,scale] duration-200 ease-spring active:scale-90 ${
                listening
                  ? "bg-red-400 text-white"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
            >
              {listening && (
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-red-400 motion-safe:animate-live-ring"
                />
              )}
              <span className={`relative ${listening ? "motion-safe:animate-breathe" : ""}`}>
                <MicIcon size={20} />
              </span>
            </button>
          )}
        </div>

        {/* 右端は常に「送信」。常時認識中は、発話の終わりが検出されないときの確定ボタンになる */}
        <button
          type="button"
          onClick={handsFreeMode ? handleForceCommit : handleSend}
          disabled={!sendEnabled}
          aria-label={t(lang, "send")}
          title={`${t(lang, "send")} (Ctrl + Enter)`}
          className={`chunky flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full ${
            sendEnabled
              ? "border-b-blue-600 bg-blue-500 text-white hover:bg-blue-400"
              : "cursor-not-allowed border-b-zinc-300 bg-zinc-200 text-zinc-400 dark:border-b-zinc-950 dark:bg-zinc-800 dark:text-zinc-600"
          }`}
        >
          {/* 送信するたびに key を変えて、紙飛行機が右上へ飛び去り、左下から戻ってくる */}
          <span
            key={sendTick}
            className={`ml-0.5 ${sendTick > 0 ? "motion-safe:animate-send-fly" : ""}`}
          >
            <SendIcon />
          </span>
        </button>
      </div>

      {notice && (
        <p
          className={`truncate px-1 text-xs ${
            notice.tone === "error"
              ? "text-red-600"
              : notice.tone === "warn"
                ? "text-amber-600"
                : "text-zinc-500"
          }`}
          title={t(lang, notice.key)}
        >
          {t(lang, notice.key)}
        </p>
      )}
    </div>
  );
}

type ModeSwitchProps = {
  lang: string;
  handsFree: boolean;
  /** このブラウザで音声認識が使えるか */
  handsFreeAvailable: boolean;
  onChange: (handsFree: boolean) => void;
};

/**
 * 常時認識（マイク）⇄ 手動（キーボード）の切替。iOS のセグメントコントロールのように、
 * 丸い溝の上で白いつまみが選択中の側へバネのように弾んで滑り、影で浮き上がって見える
 */
function ModeSwitch({ lang, handsFree, handsFreeAvailable, onChange }: ModeSwitchProps) {
  const options = [
    { value: true, key: "handsFree", icon: <MicIcon size={18} /> },
    { value: false, key: "manualMode", icon: <KeyboardIcon /> },
  ] as const;

  return (
    // 騒がしい場所では手動に切り替えて誤送信を防ぐ
    <div
      role="radiogroup"
      aria-label={t(lang, "inputMode")}
      className="relative flex h-11 shrink-0 items-center rounded-full bg-zinc-200/80 p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-inset ring-black/[0.04] dark:bg-zinc-800 dark:ring-white/[0.06]"
    >
      <span
        aria-hidden
        className={`absolute left-[3px] top-[3px] h-[38px] w-[38px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_1px_1px_rgba(0,0,0,0.06)] ring-[0.5px] ring-black/[0.06] transition-[translate] duration-500 ease-spring dark:bg-zinc-600 dark:ring-white/10 ${
          handsFree ? "translate-x-0" : "translate-x-[38px]"
        }`}
      />
      {options.map((option) => {
        const selected = handsFree === option.value;
        const label = t(lang, option.key);
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => onChange(option.value)}
            disabled={option.value && !handsFreeAvailable}
            className={`relative flex h-[38px] w-[38px] items-center justify-center rounded-full transition-[color,scale] duration-300 ease-spring active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 ${
              selected
                ? option.value
                  ? "text-red-400"
                  : "text-zinc-900 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {option.icon}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageKey } from "@/lib/i18n";

type Options = {
  /** 認識する言語のロケール（例: ja-JP） */
  locale: string;
  /** 認識中のテキスト（確定分 + 途中結果）が更新されるたびに呼ばれる */
  onTranscript: (transcript: string) => void;
  /** 1回の発話の認識が終わったときに、その発話の全文で呼ばれる（abort で中断した場合は呼ばれない） */
  onEnd?: (transcript: string) => void;
  /** 認識エラー（無音・中断以外）が起きたときに呼ばれる */
  onError?: (error: MessageKey) => void;
};

const ERROR_KEYS: Partial<Record<SpeechRecognitionErrorCode, MessageKey>> = {
  "not-allowed": "micNotAllowed",
  "service-not-allowed": "micNotAllowed",
  "audio-capture": "micNotFound",
  network: "micNetwork",
  "language-not-supported": "micLangUnsupported",
};

// スピーカーから出た読み上げ音声や周囲の雑音を拾いにくくする
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

// マイクのトラックを認識に渡す方式で失敗したら、以降はブラウザ既定のマイク入力に戻す
let audioTrackDisabled = false;
// トラック渡しで何も聞き取れないセッションがこの回数続いたら、トラックが無視されているとみなす
const MAX_SILENT_TRACK_SESSIONS = 2;
let silentTrackSessions = 0;

function disableAudioTrack() {
  audioTrackDisabled = true;
  silentTrackSessions = 0;
}

type NavigatorUAData = { mobile?: boolean };

function getRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

/**
 * 上の制約で取得したマイクのトラックを認識に渡せるか。start(MediaStreamTrack) はデスクトップの Chromium 系だけで使う。
 * スマホの Chrome は認識を OS の音声認識サービスに任せることがあり、渡したトラックが使われないまま
 * ページ側がマイクをつかんでいると、認識側に音が届かずエラーも出ないまま何も聞き取れなくなる。
 * Safari でも getUserMedia と音声認識がマイクを取り合うため使わない
 */
function canUseAudioTrack(): boolean {
  if (audioTrackDisabled) return false;
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  return uaData?.mobile === false && typeof navigator.mediaDevices?.getUserMedia === "function";
}

export function useSpeechRecognition({ locale, onTranscript, onEnd, onError }: Options) {
  // 現在有効なセッション。中断・作り直しで差し替わったセッションのイベントは無視する
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // マイクを解放した後に getUserMedia が遅れて返ってきても、つかみっぱなしにしない
  const micWantedRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  // 画面側で表示言語に合わせて文言化するため、文言キーで持つ
  const [error, setError] = useState<MessageKey | null>(null);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onEndRef.current = onEnd;
    onErrorRef.current = onError;
  }, [onTranscript, onEnd, onError]);

  useEffect(() => {
    // サーバー側では window が無いため、マウント後に判定する
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(Boolean(getRecognitionConstructor()));
  }, []);

  /** 認識用に取得したマイクを解放する（常時認識をやめたときなど） */
  const releaseMic = useCallback(() => {
    micWantedRef.current = false;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
  }, []);

  // 言語が変わった、またはアンマウントされたら認識を止める
  useEffect(() => {
    return () => {
      const current = recognitionRef.current;
      recognitionRef.current = null;
      current?.abort();
      setListening(false);
    };
  }, [locale]);

  useEffect(() => releaseMic, [releaseMic]);

  /** エコーキャンセル・ノイズ抑制を効かせたマイクのトラック（取得済みなら使い回す） */
  const acquireAudioTrack = useCallback(async (): Promise<MediaStreamTrack | undefined> => {
    const live = micStreamRef.current?.getAudioTracks().find((t) => t.readyState === "live");
    if (live) return live;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
      if (!micWantedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return undefined;
      }
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = stream;
      return stream.getAudioTracks()[0];
    } catch {
      // 取得できなければブラウザ既定のマイク入力で認識する（許可がなければ認識側のエラーで知らせる）
      return undefined;
    }
  }, []);

  /** 認識を正常に締めくくり、最終結果を onEnd で受け取る */
  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  /** 認識結果を待たずに即座に中断する（送信時など）。以降このセッションの結果は届かない */
  const abort = useCallback(() => {
    const current = recognitionRef.current;
    if (!current) return;
    recognitionRef.current = null;
    current.abort();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) return;

    const previous = recognitionRef.current;
    recognitionRef.current = null;
    previous?.abort();
    setError(null);

    const recognition = new Recognition();
    recognition.lang = locale;
    recognition.interimResults = true;
    // iOS Safari では continuous が不安定なため、1回の発話ごとに区切る
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    const isCurrent = () => recognitionRef.current === recognition;
    let usingAudioTrack = false;

    recognition.onstart = () => {
      if (!isCurrent()) return;
      setListening(true);
      setError(null);
    };
    let lastTranscript = "";
    recognition.onresult = (event) => {
      if (!isCurrent()) return;
      if (usingAudioTrack) silentTrackSessions = 0;
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      lastTranscript = transcript;
      onTranscriptRef.current(transcript);
    };
    recognition.onerror = (event) => {
      if (!isCurrent()) return;
      if (event.error === "aborted" || event.error === "no-speech") return;
      if (usingAudioTrack && event.error === "audio-capture") {
        // トラック渡しに対応していない環境: 既定のマイク入力に切り替えて、次の聞き取りから再開する
        disableAudioTrack();
        releaseMic();
        return;
      }
      const key = ERROR_KEYS[event.error] ?? "micError";
      setError(key);
      onErrorRef.current?.(key);
    };
    recognition.onend = () => {
      if (!isCurrent()) return;
      // トラックが無視されてマイクの音が届いていない疑い: 既定のマイク入力に切り替える
      // （本当に誰も話していなかっただけでも、エコーキャンセルが既定の処理に戻るだけで害はない）
      if (usingAudioTrack && !lastTranscript && ++silentTrackSessions >= MAX_SILENT_TRACK_SESSIONS) {
        disableAudioTrack();
        releaseMic();
      }
      recognitionRef.current = null;
      setListening(false);
      onEndRef.current?.(lastTranscript);
    };

    const begin = (track?: MediaStreamTrack) => {
      // マイクの取得を待っている間に中断・作り直しされていたら始めない
      if (!isCurrent()) return;
      try {
        if (track) {
          usingAudioTrack = true;
          recognition.start(track);
        } else {
          recognition.start();
        }
      } catch {
        if (track) {
          disableAudioTrack();
          releaseMic();
          usingAudioTrack = false;
          begin();
          return;
        }
        recognitionRef.current = null;
        setError("micError");
        setListening(false);
        onErrorRef.current?.("micError");
      }
    };

    recognitionRef.current = recognition;
    if (canUseAudioTrack()) {
      micWantedRef.current = true;
      void acquireAudioTrack().then(begin);
    } else {
      begin();
    }
  }, [locale, acquireAudioTrack, releaseMic]);

  /** 聞き取り中、または開始処理の途中か（onstart を待っている間も true） */
  const isRunning = useCallback(() => recognitionRef.current !== null, []);

  return { supported, listening, error, start, stop, abort, releaseMic, isRunning };
}

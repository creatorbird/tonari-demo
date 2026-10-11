"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

// 読み上げ終了後も、スピーカーの残響を拾わないよう少しだけ聞き取りの再開を待つ
const ECHO_TAIL_MS = 400;
// onend が来ないブラウザ（Chrome の長文など）でマイクが止まったままにならないよう見張る間隔
const WATCHDOG_INTERVAL_MS = 500;
// 読み上げが始まる前に「再生していない」と誤判定しないための猶予
const WATCHDOG_GRACE_MS = 1500;
// 1文字あたりの読み上げ時間の上限の目安（これを過ぎても終わらなければ終わったものとみなす）
const MAX_MS_PER_CHAR = 250;

// 画面内のどこかで読み上げ中か（常時音声認識が読み上げ音声を拾わないよう一時停止に使う）
let anySpeaking = false;
const speakingListeners = new Set<() => void>();
// 再生中の発話。cancel → speak の直後に古い発話の onend が遅れて届いても、ミュートを解除しない
let activeUtterance: SpeechSynthesisUtterance | null = null;
let tailTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;

function setAnySpeaking(value: boolean) {
  if (anySpeaking === value) return;
  anySpeaking = value;
  speakingListeners.forEach((listener) => listener());
}

function subscribeSpeaking(listener: () => void) {
  speakingListeners.add(listener);
  return () => speakingListeners.delete(listener);
}

function clearTimers() {
  if (tailTimer) clearTimeout(tailTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  tailTimer = null;
  watchdogTimer = null;
}

/** 音声を出す前にミュートを始める（onstart を待つと、その間の音を拾ってしまう） */
function beginSpeaking(utterance: SpeechSynthesisUtterance) {
  clearTimers();
  activeUtterance = utterance;
  setAnySpeaking(true);

  const startedAt = Date.now();
  const maxMs = WATCHDOG_GRACE_MS + utterance.text.length * MAX_MS_PER_CHAR;
  watchdogTimer = setInterval(() => {
    const elapsed = Date.now() - startedAt;
    const synth = window.speechSynthesis;
    const idle = elapsed > WATCHDOG_GRACE_MS && !synth.speaking && !synth.pending;
    if (idle || elapsed > maxMs) endSpeaking(utterance);
  }, WATCHDOG_INTERVAL_MS);
}

/** 読み上げの終了。utterance を渡したときは、それが再生中の発話の場合だけ解除する */
function endSpeaking(utterance: SpeechSynthesisUtterance | null, immediate = false) {
  if (utterance && utterance !== activeUtterance) return;
  clearTimers();
  activeUtterance = null;
  if (immediate) {
    setAnySpeaking(false);
    return;
  }
  tailTimer = setTimeout(() => {
    tailTimer = null;
    setAnySpeaking(false);
  }, ECHO_TAIL_MS);
}

/** どのコンポーネントからの読み上げでも、再生中なら true */
export function useAnySpeechPlaying(): boolean {
  return useSyncExternalStore(subscribeSpeaking, () => anySpeaking, () => false);
}

/** イベントのコールバック内で、描画を待たずに再生中かを調べる */
export function isAnySpeechPlaying(): boolean {
  return anySpeaking;
}

function pickVoice(locale: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const normalized = locale.toLowerCase();
  const base = normalized.split("-")[0];
  return (
    voices.find((v) => v.lang.toLowerCase().replace("_", "-") === normalized) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(base))
  );
}

/** Web Speech API (speechSynthesis) によるテキスト読み上げ */
export function useSpeechSynthesis() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(true);

    // 一部ブラウザでは音声一覧が非同期で読み込まれるため、先に取得を促しておく
    const synth = window.speechSynthesis;
    synth.getVoices();
    const handleVoicesChanged = () => synth.getVoices();
    synth.addEventListener("voiceschanged", handleVoicesChanged);
    return () => {
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      synth.cancel();
      endSpeaking(null, true);
    };
  }, []);

  const speak = useCallback((text: string, locale: string) => {
    if (!("speechSynthesis" in window) || !text.trim()) return;
    const synth = window.speechSynthesis;
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale;
    const voice = pickVoice(locale);
    if (voice) utterance.voice = voice;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => {
      setSpeaking(false);
      endSpeaking(utterance);
    };
    utterance.onerror = () => {
      setSpeaking(false);
      endSpeaking(utterance);
    };
    beginSpeaking(utterance);
    synth.speak(utterance);
  }, []);

  const cancel = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
    // 途中で止めたときは音が即座に消えるので、すぐ聞き取りに戻す
    endSpeaking(null, true);
  }, []);

  return { supported, speaking, speak, cancel };
}

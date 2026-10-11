"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, requestTranslationStream } from "@/lib/api";
import { recordLatency } from "@/lib/latency";
import { isSupportedLanguage } from "@/lib/languages";
import type { TranslateDoneEvent } from "@/lib/translateStream";
import type { ChatMessage, Role } from "@/hooks/useRoomChannel";

type Options = {
  roomId: string | null;
  role: Role;
  /** 送信者（自分）の言語 */
  myLang: string;
  /** 最後に分かっている相手の言語（相手が一時的に切断している間も保持される） */
  peerLang: string | null;
  /** この画面の会話（送信待ちの列と再送は、ここから自分の発言を取り出す） */
  messages: ChatMessage[];
  /** 端末がネットワークにつながっているか */
  online: boolean;
  /** Realtime のチャンネルにつながっているか */
  connected: boolean;
  upsertMessage: (message: ChatMessage) => void;
  broadcastMessage: (message: ChatMessage) => Promise<void>;
  broadcastMessageCancel: (id: string) => Promise<void>;
  /** 自分の画面の、翻訳中のメッセージに生成途中の訳文を反映する */
  setMessagePartial: (id: string, partial: string | null) => void;
  /** 生成途中の訳文を相手に配信する */
  broadcastPartial: (id: string, text: string | null) => Promise<void>;
  /** 相手の言語が取得できない／不正なときに使う言語（ホストの「相手の言語」設定） */
  fallbackTargetLang?: string;
};

/** 生成途中の訳文を相手へ配信する最短間隔（Realtime の送信回数を抑える。確定版は必ず別に届く） */
const PARTIAL_INTERVAL_MS = 120;
/**
 * つながっているはずなのに通信に失敗したとき、送信待ちに戻して自動で送り直す回数。
 * これを超えたら「失敗・再送ボタン」にする（端末がオフラインなら回数に数えず待ち続ける）
 */
const MAX_AUTO_RETRIES = 3;
/** 自動で送り直すまでの待ち時間（回数ごとに伸ばす） */
const RETRY_BACKOFF_MS = 1_500;
/** 訳し終えたのに確定版を相手へ配信できなかったとき、配信だけをやり直す回数と間隔 */
const MAX_BROADCAST_RETRIES = 3;
const BROADCAST_RETRY_MS = 2_000;

/** 楽観的表示・相手への配信・確定版で共通に使う一時ID */
function newTempId(role: Role): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const random = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `temp-${role}-${random}`;
}

/**
 * 先読みした訳文を使い回してよいかの判定キー。認識の途中経過と確定版は、
 * 文末の句読点や空白だけが違うことが多いので、そこは無視して比べる
 */
function translationKey(text: string, sourceLang: string, targetLang: string): string {
  const normalized = text.trim().replace(/[\s。．.!?！？、,]+$/u, "");
  return `${sourceLang}\u0000${targetLang}\u0000${normalized}`;
}

type JobListener = { onPartial: (text: string) => void; onReset: () => void };

/** 進行中の翻訳1件。メッセージより先に（先読みで）始まることがあるので、途中経過を覚えておく */
type TranslationJob = {
  key: string;
  controller: AbortController;
  /** これまでに届いた途中経過（それまでの全文） */
  latest: string | null;
  failed: boolean;
  listeners: Set<JobListener>;
  result: Promise<TranslateDoneEvent>;
};

function startJob(roomId: string, text: string, sourceLang: string, targetLang: string): TranslationJob {
  const controller = new AbortController();
  // 途中経過のコールバックは応答が届いてから呼ばれるので、その時点では job は作成済み
  const job: TranslationJob = {
    key: translationKey(text, sourceLang, targetLang),
    controller,
    latest: null,
    failed: false,
    listeners: new Set(),
    result: requestTranslationStream(
      { roomId, text, sourceLang, targetLang },
      {
        signal: controller.signal,
        onPartial: (partial) => {
          job.latest = partial;
          job.listeners.forEach((l) => l.onPartial(partial));
        },
        onReset: () => {
          job.latest = null;
          job.listeners.forEach((l) => l.onReset());
        },
      },
    ),
  };
  // 使われずに捨てた先読みの失敗を、未処理のエラーにしない
  job.result.catch(() => {
    job.failed = true;
  });
  return job;
}

/**
 * 送信フロー（楽観的UI）:
 * 1. 一時IDで「翻訳中」のメッセージを自分の画面へ即時表示し、相手にも「翻訳中」を配信
 * 2. サーバー経由で翻訳（Gemini → Groq の自動フォールバック）。訳せた部分から少しずつ
 *    自分の画面に出し、相手にも配信する
 * 3. 成功: 同じIDで確定版を配信・反映（マージで置き換わるので二重表示にならない）
 *    失敗: 自分の画面は「失敗・再送ボタン」に、相手の「翻訳中」表示は取り下げ
 * どの段階で失敗しても例外を外へ投げないので、会話はそのまま続けられる。
 *
 * 通信できないとき（オフライン・Realtime の切断中・通信エラー）は「送信待ち（queued）」として
 * 画面と端末に残し、つながったら送った順に自動で送る。
 *
 * 常時認識では、話し終わる前の途中の文で先に翻訳を始めておき（prefetch）、
 * 送る文が同じならその結果をそのまま使う。
 */
export function useTranslatedSend({
  roomId,
  role,
  myLang,
  peerLang,
  messages,
  online,
  connected,
  upsertMessage,
  broadcastMessage,
  broadcastMessageCancel,
  setMessagePartial,
  broadcastPartial,
  fallbackTargetLang,
}: Options) {
  // サーバーが「終了済みルーム」と判定した
  const [roomInactive, setRoomInactive] = useState(false);
  // 送信待ちの列を処理している最中か（1件ずつ順番に送る）
  const flushingRef = useRef(false);
  // メッセージごとの自動の送り直し回数
  const attemptsRef = useRef(new Map<string, number>());
  // 送り直しの待ち時間が明けたら、送信待ちの列の処理をもう一度促す
  const [flushTick, setFlushTick] = useState(0);
  // 話し終わる前に始めた先読み翻訳（常に最新の1件だけ）
  const speculationRef = useRef<TranslationJob | null>(null);

  const resolveTargetLang = useCallback((): string | null => {
    // Presence で届いた相手の言語は外部入力なので検証してから使う
    if (peerLang && isSupportedLanguage(peerLang)) return peerLang;
    if (fallbackTargetLang && isSupportedLanguage(fallbackTargetLang)) return fallbackTargetLang;
    return null;
  }, [peerLang, fallbackTargetLang]);

  // ルームを離れたら、使われなかった先読みを止める
  useEffect(
    () => () => {
      speculationRef.current?.controller.abort();
      speculationRef.current = null;
    },
    [roomId],
  );

  /** 確定版を相手へ配信する。失敗したら少し間をおいて数回だけやり直す */
  const broadcastWithRetry = useCallback(
    async (sent: ChatMessage) => {
      for (let i = 0; i <= MAX_BROADCAST_RETRIES; i++) {
        try {
          await broadcastMessage(sent);
          return;
        } catch {
          if (i < MAX_BROADCAST_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, BROADCAST_RETRY_MS));
          }
        }
      }
    },
    [broadcastMessage],
  );

  const deliver = useCallback(
    async (pending: ChatMessage, adoptedJob: TranslationJob | null) => {
      const startedAt = performance.now();
      let firstShownAt: number | null = null;
      upsertMessage(pending);
      // 相手の画面にも「翻訳中」を出す（届かなくても本処理は続行）
      broadcastMessage(pending).catch(() => undefined);

      // 途中経過は自分の画面にはすぐ出し、相手へは間引いて送る（最後の1回は必ず送る）
      let lastBroadcastAt = 0;
      let partialTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingPartial: string | null = null;
      const listener: JobListener = {
        onPartial: (text) => {
          firstShownAt ??= performance.now();
          setMessagePartial(pending.id, text);
          pendingPartial = text;
          if (partialTimer) return;
          const wait = Math.max(0, PARTIAL_INTERVAL_MS - (performance.now() - lastBroadcastAt));
          partialTimer = setTimeout(() => {
            partialTimer = null;
            lastBroadcastAt = performance.now();
            void broadcastPartial(pending.id, pendingPartial);
          }, wait);
        },
        onReset: () => {
          if (partialTimer) clearTimeout(partialTimer);
          partialTimer = null;
          setMessagePartial(pending.id, null);
          void broadcastPartial(pending.id, null);
        },
      };

      let job: TranslationJob | null = adoptedJob;
      try {
        if (!roomId) throw new Error("ルームがありません。");
        job ??= startJob(roomId, pending.original, pending.sourceLang, pending.targetLang);
        job.listeners.add(listener);
        // 先読みですでに訳せている分は、送った瞬間に出す
        if (job.latest) listener.onPartial(job.latest);

        const done = await job.result;
        if (partialTimer) clearTimeout(partialTimer);
        const doneAt = performance.now();
        recordLatency({
          firstTextMs: (firstShownAt ?? doneAt) - startedAt,
          totalMs: doneAt - startedAt,
          serverFirstTextMs: done.firstTextMs,
          engine: done.engine,
          speculative: adoptedJob !== null,
        });

        // 訳せた時点で自分の画面は確定にする。相手への配信が届かなくても、
        // 少し待って配信し直し、それも届かなければ再接続したときの同期で必ず届く
        const sent: ChatMessage = { ...pending, translated: done.translated, status: "sent" };
        upsertMessage(sent);
        attemptsRef.current.delete(pending.id);
        void broadcastWithRetry(sent);
      } catch (e) {
        if (partialTimer) clearTimeout(partialTimer);
        if (e instanceof ApiError && e.code === "room_inactive") setRoomInactive(true);
        console.warn("[send] failed:", e);
        void broadcastMessageCancel(pending.id);
        // 通信そのものが届かなかった: 送信待ちに戻し、つながったら自動で送り直す
        const attempts = attemptsRef.current.get(pending.id) ?? 0;
        const networkError = e instanceof ApiError && e.code === "network_error";
        if (networkError && (!navigator.onLine || attempts < MAX_AUTO_RETRIES)) {
          if (navigator.onLine) attemptsRef.current.set(pending.id, attempts + 1);
          upsertMessage({ ...pending, status: "queued", translated: null });
        } else {
          attemptsRef.current.delete(pending.id);
          upsertMessage({ ...pending, status: "failed" });
        }
      } finally {
        job?.listeners.delete(listener);
      }
    },
    [
      roomId,
      upsertMessage,
      broadcastMessage,
      broadcastMessageCancel,
      setMessagePartial,
      broadcastPartial,
      broadcastWithRetry,
    ],
  );

  const canSendNow = online && connected;

  // 送信待ちの列: つながったら、送った順に1件ずつ自動で送る
  const nextQueued = messages.find((m) => m.from === role && m.status === "queued");
  useEffect(() => {
    if (!canSendNow || !nextQueued || flushingRef.current) return;
    const targetLang = resolveTargetLang() ?? nextQueued.targetLang;
    const attempts = attemptsRef.current.get(nextQueued.id) ?? 0;
    // 通信エラーで戻ってきたものは、すぐには送らず少し待つ
    const timer = setTimeout(() => {
      flushingRef.current = true;
      void deliver({ ...nextQueued, targetLang, translated: null, status: "translating" }, null).finally(
        () => {
          flushingRef.current = false;
          setFlushTick((n) => n + 1);
        },
      );
    }, attempts * RETRY_BACKOFF_MS);
    return () => clearTimeout(timer);
  }, [canSendNow, nextQueued, flushTick, resolveTargetLang, deliver]);

  /** テキストを送る。結果を待たずにすぐ戻る（入力欄はすぐ空にしてよい） */
  const send = useCallback(
    (text: string) => {
      const targetLang = resolveTargetLang();
      if (!roomId || !targetLang) return;

      const message: ChatMessage = {
        id: newTempId(role),
        from: role,
        original: text,
        translated: null,
        sourceLang: myLang,
        targetLang,
        sentAt: Date.now(),
        status: "translating",
      };

      // 通信できない: 送信待ちに入れて、つながったら自動で送る（相手にはまだ何も出さない）
      // 先に送信待ちがある間も、追い越さないよう列の後ろに並べる
      const hasQueue = messages.some((m) => m.from === role && m.status === "queued");
      if (!canSendNow || hasQueue) {
        speculationRef.current?.controller.abort();
        speculationRef.current = null;
        upsertMessage({ ...message, status: "queued" });
        return;
      }

      // 同じ文の先読みが走っていればそれを引き継ぎ、違えば捨てる
      const speculation = speculationRef.current;
      speculationRef.current = null;
      let adopted: TranslationJob | null = null;
      if (
        speculation &&
        !speculation.failed &&
        speculation.key === translationKey(text, myLang, targetLang)
      ) {
        adopted = speculation;
      } else {
        speculation?.controller.abort();
      }

      void deliver(message, adopted);
    },
    [roomId, role, myLang, messages, canSendNow, upsertMessage, resolveTargetLang, deliver],
  );

  /**
   * 先読み翻訳: 常時認識で、話し終わる前の途中の文を先に訳し始めておく。
   * 送る文が変わったら前の先読みは取り消す（サーバー側の生成も止まる）
   */
  const prefetch = useCallback(
    (text: string) => {
      const targetLang = resolveTargetLang();
      if (!roomId || !targetLang || !canSendNow || text.trim().length < 2) return;
      const key = translationKey(text, myLang, targetLang);
      const current = speculationRef.current;
      if (current && current.key === key && !current.failed) return;
      current?.controller.abort();
      speculationRef.current = startJob(roomId, text.trim(), myLang, targetLang);
    },
    [roomId, myLang, canSendNow, resolveTargetLang],
  );

  /** 失敗したメッセージを同じIDのまま再送する（相手の言語は最新のものを使う） */
  const retry = useCallback(
    (id: string) => {
      const original = messages.find((m) => m.id === id && m.from === role && m.status === "failed");
      if (!original) return;
      const retried: ChatMessage = {
        ...original,
        targetLang: resolveTargetLang() ?? original.targetLang,
        translated: null,
        partial: null,
        status: "translating",
      };
      attemptsRef.current.delete(id);
      // つながっていなければ送信待ちに回す
      if (!canSendNow) upsertMessage({ ...retried, status: "queued" });
      else void deliver(retried, null);
    },
    [messages, role, canSendNow, upsertMessage, resolveTargetLang, deliver],
  );

  return { send, retry, prefetch, roomInactive };
}

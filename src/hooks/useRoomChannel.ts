"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { channelName } from "@/lib/room";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export type Role = "host" | "guest";

export type ParticipantState = {
  role: Role;
  lang: string;
};

/**
 * queued: 送信待ち（オフラインなどで送れず、つながったら自動で送る。送信者の画面にのみ存在）
 * translating: 翻訳待ち（送信者の画面では楽観的表示、受信者の画面では「翻訳中」表示）
 * sent: 翻訳済み
 * failed: 翻訳・送信に失敗（送信者の画面にのみ存在）
 */
export type MessageStatus = "queued" | "translating" | "sent" | "failed";

export type ChatMessage = {
  /** 送信時にクライアントで発行する一時ID。楽観的表示・相手への配信・確定版で共通 */
  id: string;
  from: Role;
  /** 送信者が入力した原文 */
  original: string;
  /** 受信者の言語に翻訳された文（翻訳待ちの間は null） */
  translated: string | null;
  sourceLang: string;
  targetLang: string;
  sentAt: number;
  status: MessageStatus;
  /**
   * 翻訳中に少しずつ届く、生成途中の訳文（それまでの全文）。各端末の画面上だけで持ち、
   * 確定版（sent）に置き換わったら消える。message イベントには載せず message_partial で別に送る
   */
  partial?: string | null;
};

const STATUS_RANK: Record<MessageStatus, number> = { queued: 0, translating: 0, failed: 1, sent: 2 };

/**
 * 同じ ID のメッセージは追加せず上書きする（二重表示を防ぐマージ処理）。
 * 確定済み(sent)を翻訳中(translating)で巻き戻すことはしない（配信順の入れ替わり対策）。
 * 再送（failed / queued → translating）と、通信が切れたときの送信待ちへの戻し（→ queued）だけは許可する。
 */
export function mergeMessage(list: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const index = list.findIndex((m) => m.id === incoming.id);
  if (index === -1) return [...list, incoming];

  const current = list[index];
  const isRetry =
    (current.status === "failed" || current.status === "queued") && incoming.status === "translating";
  const isRequeue = incoming.status === "queued" && current.status !== "sent";
  if (!isRetry && !isRequeue && STATUS_RANK[incoming.status] < STATUS_RANK[current.status]) {
    return list;
  }

  const next = list.slice();
  // 途中経過は翻訳中の間だけ引き継ぐ（確定・失敗・再送のやり直しでは消す）
  const keepPartial = incoming.status === "translating" && !isRetry;
  next[index] = { ...current, ...incoming, partial: keepPartial ? current.partial : null };
  return next;
}

/** 翻訳中のメッセージに生成途中の訳文を反映する。確定済み・未着のメッセージには何もしない */
export function applyPartial(list: ChatMessage[], id: string, partial: string | null): ChatMessage[] {
  const index = list.findIndex((m) => m.id === id);
  if (index === -1 || list[index].status !== "translating" || list[index].partial === partial) {
    return list;
  }
  const next = list.slice();
  next[index] = { ...list[index], partial };
  return next;
}

/** Realtime で届いたデータは外部入力なので形を検証する */
function parseIncomingMessage(payload: unknown, expectedFrom: Role): ChatMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const m = payload as Partial<ChatMessage>;
  if (
    typeof m.id !== "string" ||
    m.from !== expectedFrom ||
    typeof m.original !== "string" ||
    typeof m.sourceLang !== "string" ||
    typeof m.targetLang !== "string" ||
    typeof m.sentAt !== "number"
  ) {
    return null;
  }
  if (m.status === "sent" && typeof m.translated === "string") {
    return { ...(m as ChatMessage), translated: m.translated, partial: null };
  }
  if (m.status === "translating") {
    return { ...(m as ChatMessage), translated: null, partial: null };
  }
  return null;
}

export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

/**
 * 相手の姿が Presence から消えても、この時間は「一時的な切断（圏外・アプリの切り替え）」とみなして待つ。
 * 明示的な終了（終了ボタン・ページを閉じる）は room_closed で即座に伝わる
 */
const PEER_GONE_GRACE_MS = 30_000;
/** 再接続したときに送り直す、自分の発言の件数 */
const SYNC_HISTORY_LIMIT = 30;
/** 再読み込みしても会話が消えないよう、端末（このタブ）に残す件数 */
const STORED_HISTORY_LIMIT = 100;

const historyKey = (roomId: string, role: Role) => `tonari:history:${roomId}:${role}`;

/**
 * このタブに残した会話を読み込む。翻訳の途中で閉じた自分の発言は送信待ちに戻して送り直し、
 * 相手の翻訳中の発言は、再接続の同期で確定版が届くので捨てる
 */
function loadHistory(roomId: string, role: Role): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(historyKey(roomId, role));
    const list = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    if (!Array.isArray(list)) return [];
    return list.flatMap((m): ChatMessage[] => {
      if (!m || typeof m.id !== "string" || typeof m.original !== "string") return [];
      if (m.status === "translating") {
        return m.from === role ? [{ ...m, status: "queued", translated: null, partial: null }] : [];
      }
      return [{ ...m, partial: null }];
    });
  } catch {
    return [];
  }
}

function saveHistory(roomId: string, role: Role, messages: ChatMessage[]) {
  try {
    const list = messages.slice(-STORED_HISTORY_LIMIT).map((m) => ({ ...m, partial: null }));
    sessionStorage.setItem(historyKey(roomId, role), JSON.stringify(list));
  } catch {
    // プライベートブラウズや容量不足では残さない（会話そのものは続けられる）
  }
}

/** 話している間、この間隔で「まだ話している」を送り直す（取りこぼしや途中の切断に備える） */
const SPEAKING_KEEPALIVE_MS = 2_000;
/** 最後の「話している」からこの時間が過ぎたら、終わりの合図が届かなくても話し終えたとみなす */
const PEER_SPEAKING_TIMEOUT_MS = 4_500;

type Options = {
  roomId: string | null;
  role: Role;
  lang: string;
};

/**
 * Supabase Realtime のチャンネルに参加し、
 * Presence で「誰が・どの言語で」接続しているかを共有する。
 */
export function useRoomChannel({ roomId, role, lang }: Options) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const langRef = useRef(lang);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [peer, setPeer] = useState<ParticipantState | null>(null);
  const [peerEverJoined, setPeerEverJoined] = useState(false);
  const [roomClosed, setRoomClosed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);
  // 残した会話を読み込み終えたルーム。読み込む前の空の一覧で上書き保存しないようにする
  const loadedRoomRef = useRef<string | null>(null);
  // 最後に分かっている相手の言語（相手が一時的に切断している間も、送信待ちの翻訳に使う）
  const [peerLang, setPeerLang] = useState<string | null>(null);
  // 相手が猶予時間を過ぎても戻ってこない
  const [peerGoneLong, setPeerGoneLong] = useState(false);
  const online = useOnlineStatus();
  // 相手のマイクが声を拾っている最中か（内容は送らず、状態だけを共有する）
  const [peerSpeaking, setPeerSpeaking] = useState(false);
  const peerSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakingRef = useRef(false);
  const speakingKeepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  useEffect(() => {
    messagesRef.current = messages;
    if (roomId && loadedRoomRef.current === roomId) saveHistory(roomId, role, messages);
  }, [messages, roomId, role]);

  useEffect(() => {
    if (!roomId) return;

    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
    } catch (e) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
      return;
    }

    setStatus("connecting");
    setError(null);
    setPeer(null);
    setPeerEverJoined(false);
    setRoomClosed(false);
    setMessages(loadHistory(roomId, role));
    loadedRoomRef.current = roomId;
    setPeerLang(null);
    setPeerGoneLong(false);
    setPeerSpeaking(false);
    // 前のルームで話している途中だった送り直しを引き継がない
    speakingRef.current = false;
    if (speakingKeepaliveRef.current) clearInterval(speakingKeepaliveRef.current);
    speakingKeepaliveRef.current = null;

    const peerRole: Role = role === "host" ? "guest" : "host";
    const channel = supabase.channel(channelName(roomId), {
      config: { presence: { key: role }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<ParticipantState>();
        const entry = state[peerRole]?.[0];
        if (entry) {
          setPeer({ role: entry.role, lang: entry.lang });
          setPeerLang(entry.lang);
          setPeerEverJoined(true);
          setPeerGoneLong(false);
        } else {
          setPeer(null);
          setPeerSpeaking(false);
        }
      })
      .on("broadcast", { event: "room_closed" }, () => {
        setRoomClosed(true);
      })
      .on("broadcast", { event: "message" }, ({ payload }) => {
        // 相手からのメッセージだけを受け付け、同じ ID は上書きでマージする
        const message = parseIncomingMessage(payload, peerRole);
        if (!message) return;
        // 発言が届いたら「話している」表示はその吹き出しに引き継ぐ
        clearPeerSpeaking();
        setMessages((prev) => mergeMessage(prev, message));
      })
      .on("broadcast", { event: "message_partial" }, ({ payload }) => {
        // 相手の発言の訳文が少しずつ届く（null は「訳し直すので途中経過を消す」）
        const { id, text } = (payload ?? {}) as { id?: unknown; text?: unknown };
        if (typeof id !== "string" || (typeof text !== "string" && text !== null)) return;
        setMessages((prev) => {
          const target = prev.find((m) => m.id === id);
          if (!target || target.from !== peerRole) return prev;
          return applyPartial(prev, id, text);
        });
      })
      .on("broadcast", { event: "speaking" }, ({ payload }) => {
        const speaking = (payload as { speaking?: unknown })?.speaking;
        if (speaking !== true) {
          clearPeerSpeaking();
          return;
        }
        setPeerSpeaking(true);
        if (peerSpeakingTimerRef.current) clearTimeout(peerSpeakingTimerRef.current);
        peerSpeakingTimerRef.current = setTimeout(clearPeerSpeaking, PEER_SPEAKING_TIMEOUT_MS);
      })
      .on("broadcast", { event: "sync_request" }, () => {
        // 相手がつながり直した: 切れている間に届かなかった自分の発言を送り直す
        sendHistory();
      })
      .on("broadcast", { event: "sync" }, ({ payload }) => {
        const list = (payload as { messages?: unknown })?.messages;
        if (!Array.isArray(list)) return;
        const incoming = list
          .map((m) => parseIncomingMessage(m, peerRole))
          .filter((m): m is ChatMessage => m !== null);
        if (incoming.length === 0) return;
        // 届いた順ではなく、送られた時刻の順に並べ直す
        setMessages((prev) =>
          [...incoming.reduce(mergeMessage, prev)].sort((a, b) => a.sentAt - b.sentAt),
        );
      })
      .on("broadcast", { event: "message_cancel" }, ({ payload }) => {
        // 相手側で翻訳に失敗したメッセージの「翻訳中」表示を取り下げる
        const id = (payload as { id?: unknown })?.id;
        if (typeof id !== "string") return;
        setMessages((prev) =>
          prev.filter((m) => !(m.id === id && m.from === peerRole && m.status !== "sent")),
        );
      })
      .subscribe(async (subStatus, err) => {
        // 初回の接続だけでなく、切断から自動で再接続したときにも呼ばれる
        if (subStatus === "SUBSCRIBED") {
          setStatus("connected");
          setError(null);
          await channel.track({ role, lang: langRef.current });
          // 切れている間のやり取りを両方向で取り戻す（同じ ID は上書きされるので何度送っても安全）
          sendHistory();
          void channel.send({ type: "broadcast", event: "sync_request", payload: {} }).catch(() => undefined);
        } else if (
          subStatus === "CHANNEL_ERROR" ||
          subStatus === "TIMED_OUT"
        ) {
          setStatus("error");
          setError(err?.message ?? "Realtime への接続に失敗しました。");
        }
      });

    /** 自分の直近の発言（翻訳中・確定済み）をまとめて相手に送る */
    function sendHistory() {
      const own = messagesRef.current
        .filter((m) => m.from === role && (m.status === "sent" || m.status === "translating"))
        .slice(-SYNC_HISTORY_LIMIT)
        .map((m) => ({ ...m, partial: null }));
      if (own.length === 0) return;
      void channel
        .send({ type: "broadcast", event: "sync", payload: { messages: own } })
        .catch(() => undefined);
    }

    // 圏外から戻った・アプリに戻ってきたら、再接続の待ち時間（最大十数秒）を待たずにつなぎ直す
    const reconnectNow = () => {
      if (!navigator.onLine || supabase.realtime.isConnected()) return;
      supabase.realtime.connect();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", handleVisibility);

    function clearPeerSpeaking() {
      if (peerSpeakingTimerRef.current) clearTimeout(peerSpeakingTimerRef.current);
      peerSpeakingTimerRef.current = null;
      setPeerSpeaking(false);
    }

    return () => {
      channelRef.current = null;
      window.removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (peerSpeakingTimerRef.current) clearTimeout(peerSpeakingTimerRef.current);
      peerSpeakingTimerRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [roomId, role]);

  // 相手が Presence から消えたら猶予時間だけ待ち、それでも戻らなければ「去った」とみなす。
  // 自分がオフライン・切断中の間は Presence が当てにならないので数えない
  const peerAbsent = peerEverJoined && !peer;
  const canTrustPresence = online && status === "connected";
  useEffect(() => {
    if (!peerAbsent || !canTrustPresence) return;
    const timer = setTimeout(() => setPeerGoneLong(true), PEER_GONE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [peerAbsent, canTrustPresence]);
  const peerGone = peerAbsent && peerGoneLong;

  // 言語を変更したら Presence を更新して相手に伝える
  useEffect(() => {
    const channel = channelRef.current;
    if (channel && status === "connected") {
      channel.track({ role, lang });
    }
  }, [lang, role, status]);

  /** ホストがルームを終了したことを相手に通知する */
  const broadcastRoomClosed = useCallback(async () => {
    const channel = channelRef.current;
    if (!channel) return;
    await channel.send({
      type: "broadcast",
      event: "room_closed",
      payload: {},
    });
  }, []);

  /**
   * 自分のマイクが声を拾っているかを相手に伝える（相手の画面に波形を出すため）。
   * 変化したときに送り、話している間は一定間隔で送り直す。届かなくても相手側で自然に消える
   */
  const setSpeaking = useCallback((speaking: boolean) => {
    if (speakingRef.current === speaking) return;
    speakingRef.current = speaking;
    const send = () =>
      void channelRef.current
        ?.send({ type: "broadcast", event: "speaking", payload: { speaking: speakingRef.current } })
        .catch(() => undefined);
    if (speakingKeepaliveRef.current) clearInterval(speakingKeepaliveRef.current);
    speakingKeepaliveRef.current = speaking ? setInterval(send, SPEAKING_KEEPALIVE_MS) : null;
    send();
  }, []);

  useEffect(
    () => () => {
      if (speakingKeepaliveRef.current) clearInterval(speakingKeepaliveRef.current);
    },
    [],
  );

  /** 自分の画面の履歴にメッセージを反映する（同じ ID は上書き） */
  const upsertMessage = useCallback((message: ChatMessage) => {
    setMessages((prev) => mergeMessage(prev, message));
  }, []);

  /** 相手へメッセージ（翻訳中／確定版）を配信する。失敗したら例外 */
  const broadcastMessage = useCallback(async (message: ChatMessage) => {
    const channel = channelRef.current;
    if (!channel) throw new Error("チャンネルに接続していません。");
    const result = await channel.send({ type: "broadcast", event: "message", payload: message });
    if (result !== "ok") throw new Error(`メッセージの送信に失敗しました: ${result}`);
  }, []);

  /** 自分の画面で、翻訳中のメッセージに生成途中の訳文を反映する */
  const setMessagePartial = useCallback((id: string, partial: string | null) => {
    setMessages((prev) => applyPartial(prev, id, partial));
  }, []);

  /** 生成途中の訳文を相手に配信する（ベストエフォート。確定版が必ず後から届く） */
  const broadcastPartial = useCallback(async (id: string, text: string | null) => {
    await channelRef.current
      ?.send({ type: "broadcast", event: "message_partial", payload: { id, text } })
      .catch(() => undefined);
  }, []);

  /** 相手の画面の「翻訳中」表示を取り下げる（ベストエフォート） */
  const broadcastMessageCancel = useCallback(async (id: string) => {
    await channelRef.current
      ?.send({ type: "broadcast", event: "message_cancel", payload: { id } })
      .catch(() => undefined);
  }, []);

  return {
    status,
    error,
    peer,
    peerEverJoined,
    peerLang,
    peerGone,
    online,
    roomClosed,
    broadcastRoomClosed,
    messages,
    upsertMessage,
    broadcastMessage,
    broadcastMessageCancel,
    setMessagePartial,
    broadcastPartial,
    peerSpeaking,
    setSpeaking,
  };
}

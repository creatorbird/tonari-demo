"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { BiText } from "@/components/BiText";
import { ConnectedToast } from "@/components/ConnectedToast";
import { DemoNotice } from "@/components/DemoNotice";
import { LanguageSelect } from "@/components/LanguageSelect";
import { Collapse } from "@/components/Collapse";
import { LatencyPanel } from "@/components/LatencyPanel";
import { MessageComposer } from "@/components/MessageComposer";
import { MessageList } from "@/components/MessageList";
import { SettingsToggle } from "@/components/SettingsToggle";
import { CheckIcon, LinkIcon } from "@/components/icons";
import { StatusIndicator } from "@/components/StatusIndicator";
import { useHandsFreeMode } from "@/hooks/useHandsFreeMode";
import { useRoomChannel } from "@/hooks/useRoomChannel";
import { useStableViewport } from "@/hooks/useStableViewport";
import { useTranslatedSend } from "@/hooks/useTranslatedSend";
import { DEFAULT_GUEST_LANG, DEFAULT_HOST_LANG } from "@/lib/languages";
import { biInline, langVar, t } from "@/lib/i18n";
import { beaconCloseRoom, requestCloseRoom, requestCreateRoom } from "@/lib/api";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export function HostScreen() {
  // ホストの画面文言は「自分の言語」と英語の併記で表示する
  const [hostLang, setHostLang] = useState(DEFAULT_HOST_LANG);
  const [guestLang, setGuestLang] = useState(DEFAULT_GUEST_LANG);
  const [roomId, setRoomId] = useState<string | null>(null);
  // ルーム終了 API の認証に使う（ホストのブラウザのメモリ上にだけ保持）
  const [hostToken, setHostToken] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  // null のときは「ゲスト未接続なら表示、接続後は隠す」
  const [qrOverride, setQrOverride] = useState<boolean | null>(null);
  // null のときは「ゲスト未接続なら設定パネルを開き、接続後は畳んでチャットを最大化」
  const [panelOverride, setPanelOverride] = useState<boolean | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  const {
    status,
    error,
    peer,
    peerEverJoined,
    peerLang,
    online,
    broadcastRoomClosed,
    messages,
    upsertMessage,
    broadcastMessage,
    broadcastMessageCancel,
    setMessagePartial,
    broadcastPartial,
    peerSpeaking,
    setSpeaking,
  } = useRoomChannel({
    roomId,
    role: "host",
    lang: hostLang,
  });

  const { send, retry, prefetch, roomInactive } = useTranslatedSend({
    roomId,
    role: "host",
    myLang: hostLang,
    peerLang,
    messages,
    online,
    connected: status === "connected",
    upsertMessage,
    broadcastMessage,
    broadcastMessageCancel,
    setMessagePartial,
    broadcastPartial,
    fallbackTargetLang: guestLang,
  });

  const { handsFree, setHandsFree } = useHandsFreeMode();
  useStableViewport();

  const peerConnected = Boolean(peer);

  // ゲストが入室／退室した瞬間に手動の開閉を解除し、自動レイアウトに戻す
  const [prevPeerConnected, setPrevPeerConnected] = useState(peerConnected);
  if (peerConnected !== prevPeerConnected) {
    setPrevPeerConnected(peerConnected);
    setQrOverride(null);
    setPanelOverride(null);
  }

  const showQr = qrOverride ?? !peerConnected;
  const panelsOpen = !roomId || (panelOverride ?? !peerConnected);
  // 設定類を畳み、チャットを画面いっぱいに広げた状態
  const compact = !panelsOpen;

  const guestUrl = roomId
    ? `${origin}/room/${roomId}?lang=${encodeURIComponent(guestLang)}`
    : "";

  // ホストがページを閉じたら、サーバー側でルームを無効化し、ゲストにも通知する
  useEffect(() => {
    if (!roomId || !hostToken) return;
    const handlePageHide = () => {
      beaconCloseRoom(roomId, hostToken);
      void broadcastRoomClosed();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [roomId, hostToken, broadcastRoomClosed]);

  const handleCreateRoom = async () => {
    // 作成中もボタンは青いまま見せるので、二重送信はここで防ぐ
    if (creating) return;
    setCreating(true);
    setCreateFailed(false);
    try {
      // ルームIDはサーバー側で UUID v4 として生成・登録する
      const room = await requestCreateRoom();
      setOrigin(window.location.origin);
      setHostToken(room.hostToken);
      setRoomId(room.roomId);
      setQrOverride(null);
      setPanelOverride(null);
      setCopied(false);
    } catch {
      setCreateFailed(true);
    } finally {
      setCreating(false);
    }
  };

  const handleEndRoom = async () => {
    if (!window.confirm(biInline(hostLang, "endRoomConfirm"))) {
      return;
    }
    if (roomId && hostToken) {
      try {
        await requestCloseRoom(roomId, hostToken);
      } catch {
        // 失敗してもページを閉じたときと同様に beacon で再送する
        beaconCloseRoom(roomId, hostToken);
      }
    }
    await broadcastRoomClosed();
    setRoomId(null);
    setHostToken(null);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(guestUrl);
    } catch {
      // URL を画面に出さなくなったので、Clipboard API が使えない環境（HTTP など）では
      // 旧来の方法でコピーを試み、それも無理なら共有シートやダイアログで URL を渡す
      if (!copyWithExecCommand(guestUrl)) {
        if (navigator.share) void navigator.share({ url: guestUrl }).catch(() => undefined);
        else window.prompt(biInline(hostLang, "copyLink"), guestUrl);
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const configured = isSupabaseConfigured();

  return (
    <main
      className={`mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden px-4 transition-[padding] duration-500 ${
        compact ? "py-3" : "py-8"
      }`}
    >
      <header className="flex flex-none items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              {t(hostLang, "roomTitle")}
            </h1>
            <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
              Host
            </span>
            <DemoNotice lang={hostLang} />
          </div>
          {roomId && (
            <StatusIndicator
              lang={hostLang}
              role="host"
              status={status}
              peerConnected={peerConnected}
              roomInactive={roomInactive}
              online={online}
            />
          )}
        </div>
        {roomId && (
          <SettingsToggle
            lang={hostLang}
            myLang={hostLang}
            peerLang={peer?.lang ?? guestLang}
            open={panelsOpen}
            onToggle={() => setPanelOverride(!panelsOpen)}
          />
        )}
      </header>

      {!configured && (
        <p className="mt-6 rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          Supabase の環境変数が未設定です。<code>.env.local</code> を作成してください。
        </p>
      )}

      {roomId && error && <p className="mt-2 flex-none text-sm text-red-600">{error}</p>}

      {/* チャットが表示されている間はチャットに高さを譲り、溢れた分はパネル内でスクロールする */}
      <Collapse open={panelsOpen} scrollable className="min-h-0">
        <div className="flex flex-col gap-2 pt-2">
          {/* ネイティブの設定画面のような、区切り線でつないだ1行ずつのリスト */}
          <section className="divide-y divide-zinc-100 overflow-hidden rounded-3xl bg-white shadow-soft dark:divide-zinc-800 dark:bg-zinc-900 dark:ring-1 dark:ring-white/5">
            <LanguageSelect
              id="host-lang"
              label={<BiText lang={hostLang} k="myLanguage" />}
              value={hostLang}
              onChange={setHostLang}
            />
            <LanguageSelect
              id="guest-lang"
              label={<BiText lang={hostLang} k="partnerLanguage" />}
              value={guestLang}
              onChange={setGuestLang}
            />
          </section>

          {!roomId ? (
            <>
              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={!configured}
                aria-busy={creating}
                // 作成中もグレーにせず、青いまま沈み込んだ状態でドットを弾ませる
                className={`chunky rounded-full border-b-blue-600 bg-blue-500 px-5 py-3 text-base font-bold text-white disabled:cursor-not-allowed disabled:border-b-zinc-400 disabled:bg-zinc-300 ${
                  creating ? "translate-y-1 cursor-progress border-b-transparent" : "hover:bg-blue-400"
                }`}
              >
                {creating ? (
                  <>
                    <span className="sr-only">
                      <BiText lang={hostLang} k="createRoom" />
                    </span>
                    <LoadingDots />
                  </>
                ) : (
                  <BiText lang={hostLang} k="createRoom" />
                )}
              </button>
              {createFailed && (
                <p className="text-sm text-red-600">
                  <BiText lang={hostLang} k="roomCreateFailed" />
                </p>
              )}
            </>
          ) : (
            <section className="flex flex-col items-center gap-2 rounded-3xl bg-white p-3 shadow-soft dark:bg-zinc-900 dark:ring-1 dark:ring-white/5">
              <Collapse open={showQr} className="w-full">
                <div className="flex flex-col items-center gap-2">
                  <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                    {t(hostLang, "scanQr")}
                  </p>
                  <div className="rounded-2xl bg-white p-2">
                    <QRCodeSVG value={guestUrl} size={168} marginSize={0} />
                  </div>
                  {/* URL はむき出しにせず、ワンタップでコピーできるボタンだけを置く */}
                  <button
                    type="button"
                    onClick={handleCopy}
                    aria-live="polite"
                    className={`chunky inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold ${
                      copied
                        ? "border-b-emerald-300 bg-emerald-100 text-emerald-700 dark:border-b-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-400"
                        : "border-b-blue-300 bg-blue-100 text-blue-700 hover:bg-blue-50 dark:border-b-blue-900 dark:bg-blue-950/60 dark:text-blue-300 dark:hover:bg-blue-950"
                    }`}
                  >
                    {copied ? <CheckIcon /> : <LinkIcon />}
                    {t(hostLang, copied ? "copied" : "copyLink")}
                  </button>
                </div>
              </Collapse>

              {/* 相手の言語は上のセレクトで分かるので、ゲストが自分で変えたときだけ知らせる */}
              {peer && peer.lang !== guestLang && (
                <p className="text-center text-xs text-amber-600">
                  <BiText lang={hostLang} k="guestChangedTo" vars={langVar(peer.lang)} stacked={false} />
                </p>
              )}

              <div className="flex w-full gap-2">
                <button
                  type="button"
                  onClick={() => setQrOverride(!showQr)}
                  title={biInline(hostLang, showQr ? "hideQr" : "showQr")}
                  className="chunky h-10 min-w-0 flex-1 truncate rounded-full border-b-zinc-300 bg-zinc-100 px-3 text-[13px] font-bold text-zinc-700 hover:bg-zinc-50 dark:border-b-zinc-950 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  {t(hostLang, showQr ? "hideQr" : "showQr")}
                </button>
                <button
                  type="button"
                  onClick={handleEndRoom}
                  title={biInline(hostLang, "endRoom")}
                  className="chunky h-10 min-w-0 flex-1 truncate rounded-full border-b-red-300 bg-red-100 px-3 text-[13px] font-bold text-red-700 hover:bg-red-50 dark:border-b-red-950 dark:bg-red-950/60 dark:text-red-400 dark:hover:bg-red-950"
                >
                  {t(hostLang, "endRoom")}
                </button>
              </div>
            </section>
          )}
        </div>
      </Collapse>

      {roomId && (
        <section
          className={`flex min-h-56 flex-1 flex-col gap-3 rounded-3xl bg-zinc-50 p-3 shadow-soft transition-[margin] duration-500 dark:bg-zinc-950 dark:ring-1 dark:ring-white/5 ${
            compact ? "mt-3" : "mt-6"
          }`}
        >
          {/* 画面の高さに収め、履歴だけをスクロールさせる */}
          <MessageList
            messages={messages}
            myRole="host"
            lang={hostLang}
            onRetry={retry}
            peerSpeaking={peerSpeaking}
          />
          <div className="flex-none">
            {roomInactive ? (
              <p className="text-center font-bold text-red-600">
                <BiText lang={hostLang} k="roomEnded" />
              </p>
            ) : (
              <MessageComposer
                lang={hostLang}
                onSend={send}
                sendDisabled={!peerLang}
                handsFree={handsFree}
                onHandsFreeChange={setHandsFree}
              onSpeakingChange={setSpeaking}
              onPrefetch={prefetch}
              offline={!online}
              />
            )}
          </div>
        </section>
      )}
      <LatencyPanel />
      <ConnectedToast active={peerEverJoined} lang={hostLang} />
    </main>
  );
}

/** ルーム作成中に、ボタンの中で3つのドットが順番に弾む */
function LoadingDots() {
  return (
    <span aria-hidden className="flex h-6 items-center justify-center gap-1.5">
      {[0, 180, 360].map((delay) => (
        <span
          key={delay}
          className="h-2 w-2 rounded-full bg-white motion-safe:animate-typing motion-reduce:animate-typing-fade"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/** Clipboard API が使えないときのコピー。成功したら true */
function copyWithExecCommand(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

"use client";

import { useState } from "react";
import { BiText } from "@/components/BiText";
import { ConnectedToast } from "@/components/ConnectedToast";
import { DemoNotice } from "@/components/DemoNotice";
import { LanguageSelect } from "@/components/LanguageSelect";
import { Collapse } from "@/components/Collapse";
import { LatencyPanel } from "@/components/LatencyPanel";
import { MessageComposer } from "@/components/MessageComposer";
import { MessageList } from "@/components/MessageList";
import { SettingsToggle } from "@/components/SettingsToggle";
import { StatusIndicator } from "@/components/StatusIndicator";
import { RoomEnded } from "@/components/RoomEnded";
import { useHandsFreeMode } from "@/hooks/useHandsFreeMode";
import { useRoomChannel } from "@/hooks/useRoomChannel";
import { useStableViewport } from "@/hooks/useStableViewport";
import { useTranslatedSend } from "@/hooks/useTranslatedSend";
import { languageLabel } from "@/lib/languages";
import { t } from "@/lib/i18n";

type Props = {
  roomId: string;
  /** ホストが指定した言語（URL の ?lang=） */
  initialLang: string;
};

export function GuestScreen({ roomId, initialLang }: Props) {
  // 画面の文言はこの言語と英語の併記で表示する
  const [lang, setLang] = useState(initialLang);

  const {
    status,
    error,
    peer,
    peerEverJoined,
    peerLang,
    peerGone,
    online,
    roomClosed,
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
    role: "guest",
    lang,
  });

  const { send, retry, prefetch, roomInactive } = useTranslatedSend({
    roomId,
    role: "guest",
    myLang: lang,
    peerLang,
    messages,
    online,
    connected: status === "connected",
    upsertMessage,
    broadcastMessage,
    broadcastMessageCancel,
    setMessagePartial,
    broadcastPartial,
  });

  const { handsFree, setHandsFree } = useHandsFreeMode();
  useStableViewport();

  const peerConnected = Boolean(peer);

  // null のときは「ホスト未接続なら設定パネルを開き、接続後は畳んでチャットを最大化」
  const [panelOverride, setPanelOverride] = useState<boolean | null>(null);
  const [prevPeerConnected, setPrevPeerConnected] = useState(peerConnected);
  if (peerConnected !== prevPeerConnected) {
    setPrevPeerConnected(peerConnected);
    setPanelOverride(null);
  }
  const panelsOpen = panelOverride ?? !peerConnected;
  // 設定パネルを畳み、チャットを画面いっぱいに広げた状態
  const compact = !panelsOpen;

  // ホストが終了ボタンを押した／ページを閉じた／しばらく戻ってこない／サーバーが無効と判定した
  // （圏外やアプリの切り替えで一時的に姿が消えただけなら、戻ってくるのを待つ）
  const ended = roomClosed || peerGone || roomInactive;

  if (ended) {
    return <RoomEnded lang={lang} />;
  }

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
              {t(lang, "roomTitle")}
            </h1>
            <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Guest
            </span>
            <DemoNotice lang={lang} />
          </div>
          <StatusIndicator
            lang={lang}
            role="guest"
            status={status}
            peerConnected={peerConnected}
            roomInactive={roomInactive}
            online={online}
          />
        </div>
        {peer && (
          <SettingsToggle
            lang={lang}
            myLang={lang}
            peerLang={peer.lang}
            open={panelsOpen}
            onToggle={() => setPanelOverride(!panelsOpen)}
          />
        )}
      </header>

      {error && <p className="mt-2 flex-none text-sm text-red-600">{error}</p>}

      {/* チャットが表示されている間はチャットに高さを譲り、溢れた分はパネル内でスクロールする */}
      <Collapse open={panelsOpen} scrollable className="min-h-0">
        <div className="pt-2">
          {/* ネイティブの設定画面のような、区切り線でつないだ1行ずつのリスト */}
          <section className="divide-y divide-zinc-100 overflow-hidden rounded-3xl bg-white shadow-soft dark:divide-zinc-800 dark:bg-zinc-900 dark:ring-1 dark:ring-white/5">
            <LanguageSelect
              id="my-lang"
              label={<BiText lang={lang} k="yourLanguage" />}
              value={lang}
              onChange={setLang}
            />
            {peer && (
              <div className="flex min-h-11 items-center justify-between gap-3 px-3.5">
                <span className="shrink-0 text-[13px] text-zinc-600 dark:text-zinc-400">
                  <BiText lang={lang} k="hostLanguage" />
                </span>
                <span className="truncate text-sm text-zinc-500">{languageLabel(peer.lang)}</span>
              </div>
            )}
          </section>
        </div>
      </Collapse>

      <section
        className={`flex min-h-56 flex-1 flex-col gap-3 rounded-3xl bg-zinc-50 p-3 shadow-soft transition-[margin] duration-500 dark:bg-zinc-950 dark:ring-1 dark:ring-white/5 ${
          compact ? "mt-3" : "mt-6"
        }`}
      >
        {/* 画面の高さに収め、履歴だけをスクロールさせる */}
        <MessageList
          messages={messages}
          myRole="guest"
          lang={lang}
          onRetry={retry}
          peerSpeaking={peerSpeaking}
        />
        <div className="flex-none">
          <MessageComposer
            lang={lang}
            onSend={send}
            sendDisabled={!peerLang}
            handsFree={handsFree}
            onHandsFreeChange={setHandsFree}
            onSpeakingChange={setSpeaking}
            onPrefetch={prefetch}
            offline={!online}
          />
        </div>
      </section>
      <LatencyPanel />
      <ConnectedToast active={peerEverJoined} lang={lang} />
    </main>
  );
}

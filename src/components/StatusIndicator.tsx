import type { ConnectionStatus, Role } from "@/hooks/useRoomChannel";
import { t, type MessageKey } from "@/lib/i18n";

type Tone = "live" | "wait" | "danger";

type StatusInput = {
  role: Role;
  status: ConnectionStatus;
  peerConnected: boolean;
  roomInactive: boolean;
  /** 端末がネットワークにつながっているか */
  online: boolean;
};

/** 接続状態を「色 + 短いラベル」にまとめる */
function resolveStatus({ role, status, peerConnected, roomInactive, online }: StatusInput): {
  tone: Tone;
  key: MessageKey;
} {
  if (roomInactive) return { tone: "danger", key: "roomEnded" };
  if (!online) return { tone: "danger", key: "offline" };
  if (status === "error") return { tone: "danger", key: "connectionError" };
  if (status !== "connected") return { tone: "wait", key: "connecting" };
  if (!peerConnected) {
    return { tone: "wait", key: role === "host" ? "waitingGuest" : "waitingHost" };
  }
  return { tone: "live", key: "statusLive" };
}

const DOT: Record<Tone, string> = {
  live: "bg-emerald-500",
  wait: "bg-amber-400",
  danger: "bg-red-500",
};

const TEXT: Record<Tone, string> = {
  live: "text-emerald-700 dark:text-emerald-400",
  wait: "text-zinc-500 dark:text-zinc-400",
  danger: "text-red-600 dark:text-red-400",
};

type Props = StatusInput & {
  /** 表示言語 */
  lang: string;
};

/** ヘッダーの隅に置く、ドットと一言だけの接続インジケーター */
export function StatusIndicator({ lang, ...input }: Props) {
  const { tone, key } = resolveStatus(input);
  return (
    <p
      role="status"
      aria-live="polite"
      className={`flex min-w-0 items-center gap-1.5 text-xs font-medium ${TEXT[tone]}`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {/* 接続済みは穏やかに波打ち、待機中は点滅して「進行中」を示す */}
        {tone === "live" && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 motion-safe:animate-ping" />
        )}
        <span
          className={`relative h-2 w-2 rounded-full ${DOT[tone]} ${
            tone === "wait" ? "motion-safe:animate-pulse" : ""
          }`}
        />
      </span>
      {/* key を変えて、状態が切り替わるたびにふわっと入れ替える */}
      <span key={key} className="animate-fade-in truncate">
        {t(lang, key)}
      </span>
    </p>
  );
}

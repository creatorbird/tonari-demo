import { notFound } from "next/navigation";
import { GuestScreen } from "@/components/GuestScreen";
import { RoomEnded } from "@/components/RoomEnded";
import { DEFAULT_GUEST_LANG, isSupportedLanguage } from "@/lib/languages";
import { isValidRoomId } from "@/lib/room";
import { isRoomActive } from "@/lib/rooms.server";

export default async function RoomPage({
  params,
  searchParams,
}: PageProps<"/room/[roomId]">) {
  const { roomId } = await params;
  const { lang } = await searchParams;

  if (!isValidRoomId(roomId)) {
    notFound();
  }

  const initialLang = isSupportedLanguage(lang) ? lang : DEFAULT_GUEST_LANG;

  // 終了済み・期限切れ・存在しないルームには参加させない
  if (!(await isRoomActive(roomId))) {
    return <RoomEnded lang={initialLang} />;
  }

  // key に言語を含め、別の言語指定URLで開き直したときに初期値を反映させる
  return (
    <GuestScreen
      key={`${roomId}-${initialLang}`}
      roomId={roomId}
      initialLang={initialLang}
    />
  );
}

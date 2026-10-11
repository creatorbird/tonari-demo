import { HostScreen } from "@/components/HostScreen";

// デモ版は合言葉なしで誰でもルームを作れる（作成回数は /api/rooms で IP ごとに制限）
export default function Home() {
  return <HostScreen />;
}

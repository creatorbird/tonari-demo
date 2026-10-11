import { renderAppIcon } from "@/lib/appIcon";

// iOS の「ホーム画面に追加」で使われるアイコン（角丸は iOS 側で付く）
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(size.width);
}

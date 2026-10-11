import { ImageResponse } from "next/og";

/**
 * ホーム画面に置くアプリアイコン。空色の面に、向かい合う2つの吹き出し（隣どうしの会話）を重ねる。
 * Android の円形・角丸マスク（maskable）で切り取られても吹き出しが欠けないよう、
 * 絵柄は中央 6 割の安全領域に収め、背景は端まで塗る
 */
export function renderAppIcon(size: number): ImageResponse {
  const unit = size / 100;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: "linear-gradient(145deg, #6cb4f5 0%, #3f8ae6 100%)",
        }}
      >
        {/* 左上: 白い吹き出し（話しかける側） */}
        <div
          style={{
            position: "absolute",
            left: 22 * unit,
            top: 26 * unit,
            width: 38 * unit,
            height: 28 * unit,
            borderRadius: 14 * unit,
            borderBottomLeftRadius: 4 * unit,
            background: "#ffffff",
          }}
        />
        {/* 右下: 半透明の吹き出し（応える側） */}
        <div
          style={{
            position: "absolute",
            left: 40 * unit,
            top: 46 * unit,
            width: 38 * unit,
            height: 28 * unit,
            borderRadius: 14 * unit,
            borderBottomRightRadius: 4 * unit,
            background: "rgba(255, 255, 255, 0.55)",
          }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}

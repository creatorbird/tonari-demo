import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 親フォルダ (Desktop) にある別の package-lock.json をルートと誤認しないよう固定する
  turbopack: {
    root: __dirname,
  },
  // 同じ Wi-Fi のスマホから開発サーバーへアクセスできるようにする（PC の LAN IP をカンマ区切りで指定）
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  async headers() {
    return [
      {
        // 廃止した Service Worker の後始末用。常に最新を取りに行かせ、登録済みの端末から確実に消す
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;

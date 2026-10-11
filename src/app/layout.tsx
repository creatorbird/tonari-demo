import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppEffects } from "@/components/AppEffects";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tonari",
  description: "QRコードひとつで、13言語の対面会話をその場で翻訳",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Android Chrome でキーボード表示時にレイアウトビューポートごと縮め、
  // h-dvh の画面が入力欄ごとキーボードの上に収まるようにする
  interactiveWidget: "resizes-content",
  // ステータスバー・タスク切替画面の色を背景色（--background）にそろえる
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <AppEffects />
      </body>
    </html>
  );
}

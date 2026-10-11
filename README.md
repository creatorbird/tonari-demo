# Tonari（トナリ）デモ版

**QRコードひとつで、隣にいる人と母語のまま話せる。** リアルタイム対面翻訳 Web アプリ Tonari の、技育展向けデモ版です。

プロダクトの詳しい紹介（課題・機能・設計思想）は [PRODUCT_OVERVIEW.md](PRODUCT_OVERVIEW.md) をご覧ください。

## 概要

ホストがルームを作って QR コードを見せ、相手がスマートフォンで読み取るだけで 2 台の端末がつながります。それぞれが自分の端末で、自分の言語で話したり入力したりすると、相手の画面に相手の言語で表示されます。

このデモ版では、**ルーム作成・QR ペアリング・リアルタイム通信・音声入力・読み上げ・ストリーミング表示・オフライン時の送信待ち**など、翻訳以外の体験はすべて本番と同じように動きます。

## 本番との違い

| | 本番 | デモ版 |
|---|---|---|
| 翻訳 | Gemini / Groq の AI で翻訳（自動フォールバック） | **翻訳 API を一切呼びません。** 訳文の代わりに「翻訳結果はここに表示されます（デモ版）」を、受け取る側の言語（13 言語）で表示します |
| ストリーミング | AI が訳せた部分から流す | 決まった文言を数文字ずつ間をおいて流す（間隔は `DEMO_STREAM_DELAY_MS` で調整。0 で即時） |
| ルーム作成 | 合言葉を入れた端末だけが作れる | **合言葉なし**で誰でも作れる（同じ IP からは 1 分間に 10 回まで） |
| API キー | Gemini / Groq のキーが必要 | **不要**（関連コードとライブラリは削除済み） |
| 画面表示 | — | ヘッダーに「デモ版：翻訳は行いません」と小さく表示 |

※ 自分と相手が同じ言語を選んだ場合は、本番と同じく原文をそのまま表示します。

## 起動方法

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Supabase の準備

1. [Supabase](https://supabase.com) でプロジェクトを作成します（無料プランで動作します）。
2. SQL Editor で [`supabase/migrations/0001_rooms.sql`](supabase/migrations/0001_rooms.sql) を実行し、`rooms` テーブルを作成します。

### 3. 環境変数

`.env.local.example` をコピーして `.env.local` を作成し、Supabase の 3 つの値を設定します（Supabase ダッシュボードの Project Settings → API で確認できます）。

| 変数 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクトの URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Realtime 接続用の公開キー（ブラウザで使用） |
| `SUPABASE_SERVICE_ROLE_KEY` | ルームの作成・検証・終了（**サーバー専用。公開しないでください**） |

任意で `DEMO_STREAM_DELAY_MS`（数文字ごとの待ち時間 ms、既定 40）を設定できます。`0` にすると文言を待たずに一度で返すので、通信まわりの速さだけを計測できます（URL に `?metrics=1` を付けると、送信から表示までの時間が画面の隅に出ます）。

任意で `ALLOWED_DEV_ORIGINS` を設定すると、同じ Wi-Fi のスマートフォンから開発サーバーを開けます。PC の LAN IP（Windows なら `ipconfig` の「IPv4 アドレス」）をカンマ区切りで書き、スマートフォンでは `http://<その IP>:3000` を開きます。開発サーバー（`npm run dev`）専用の設定なので、Vercel には不要です。

```
ALLOWED_DEV_ORIGINS=192.168.0.10
```

### 4. 起動

```bash
npm run dev
```

http://localhost:3000 を開くとホスト画面になります。「ルームを作成」を押して表示された QR コード（または「リンクをコピー」の URL）を別のタブや端末で開くと、会話を始められます。

音声入力をスマートフォンで試す場合は HTTPS が必要なため、Vercel などにデプロイした環境で確認してください。

## 公開手順（GitHub / Vercel）

### GitHub

```bash
git add .
git commit -m "Tonari デモ版"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/tonari-demo.git
git push -u origin main
```

GitHub で空のリポジトリ（README なし）を先に作成してから実行してください。`.env.local` は `.gitignore` で除外されています。

### Vercel

1. [Vercel](https://vercel.com) で「Add New → Project」から上記リポジトリを Import します（Framework は Next.js が自動で選ばれます）。
2. 「Environment Variables」に Supabase の 3 つの変数を設定します（必要なら `DEMO_STREAM_DELAY_MS` も）。
3. 「Deploy」を押します。発行された URL をスマートフォン 2 台で開いて動作を確認してください。

## 技術スタック

Next.js（App Router）/ React / TypeScript / Tailwind CSS / Supabase（Realtime・Postgres）/ Web Speech API

## ディレクトリ構成

```
src/
├── app/
│   ├── page.tsx                  # ホスト画面
│   ├── room/[roomId]/page.tsx    # ゲスト画面（ルームの有効性をサーバーで検証）
│   └── api/
│       ├── rooms/                # ルーム作成（IP ごとの回数制限あり）・終了
│       └── translate/            # デモ用の翻訳（決まった文言をストリーミングで返す）
├── components/                   # 画面・チャット・入力欄・インジケーターなどの UI
├── hooks/                        # Realtime 接続、送信と翻訳、音声認識・読み上げ、ビューポート補正
└── lib/                          # 言語定義、多言語文言、デモ用翻訳、ルーム管理、計測
supabase/migrations/              # データベース定義
```

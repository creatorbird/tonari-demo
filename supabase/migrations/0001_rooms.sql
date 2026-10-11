-- ルーム管理テーブル
-- Supabase ダッシュボードの SQL Editor で実行してください。

create table if not exists public.rooms (
  id uuid primary key,
  -- ホストだけがルームを終了できるよう、ホスト用トークンのハッシュを保存する
  host_token_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

-- RLS を有効化し、ポリシーは作らない。
-- → ブラウザ（anon キー）からは読み書き不可。サーバー（service_role キー）からのみ操作する。
alter table public.rooms enable row level security;

# 将棋 対局室

ブラウザーで遊べる、標準的な将棋の対局アプリです。二人対局、コンピューター対局、Supabaseを使ったオンライン対局に対応しています。

## 起動方法

`index.html` をブラウザーで開いてください。オンライン対局を使うときはインターネット接続と、以下のSupabase設定が必要です。SupabaseクライアントはCDNから読み込みます。

## 対局方法

- 盤上の駒を選び、表示された移動先を選ぶと指せます。
- 持ち駒は選んでから打つ場所を選びます。
- 成れる局面では「成る」「成らない」を選べます。行き所のない駒は自動で成ります。
- 「一手戻す」は二人対局では一手、コンピューター対局では人とコンピューターの一手ずつを戻します。
- オンラインでは「対戦IDを作成」した人が先手、「IDで参加」した人が後手です。対戦IDは相手に安全な方法で共有してください。

本将棋の駒の動き、成り、持ち駒、二歩、行き所のない駒、王手・詰み、打ち歩詰め、千日手を扱います。コンピューターは合法手から簡易評価で手を選ぶため、対局相手としての強さは限定的です。

## オンライン対局の準備（Supabase）

Supabaseの無料プロジェクトを用意し、次の手順で対局データ用テーブルを作ります。

1. [Supabase](https://supabase.com/) にサインインし、`New project` からプロジェクトを作成します。プロジェクトが利用可能になるまで待ちます。
2. 左メニューの `SQL Editor` を開き、`New query` を押します。
3. 下のSQL全体を貼り付けて `Run` を押します。成功すると `shogi_rooms` テーブルとオンライン同期の設定が作られます。
4. 左メニューの `Project Settings` → `API`（または `API Keys`）を開き、Project URLと `Publishable key` をコピーします。古い画面では `anon` / `public` keyが同じ用途です。
5. アプリで「オンライン」を選び、URLとkeyを入力します。対局を作る側は「対戦IDを作成」、相手側は同じURLとkeyを入力して対戦IDを貼り付け、「IDで参加」を押します。
6. 作成者は「対戦IDをコピー」でIDを相手に送ります。作成者が先手、参加者が後手です。

```sql
create table if not exists public.shogi_rooms (
  id uuid primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.shogi_rooms enable row level security;
grant select, insert, update on public.shogi_rooms to anon;

drop policy if exists "shogi_rooms_read" on public.shogi_rooms;
drop policy if exists "shogi_rooms_create" on public.shogi_rooms;
drop policy if exists "shogi_rooms_update" on public.shogi_rooms;

create policy "shogi_rooms_read"
  on public.shogi_rooms for select to anon using (true);
create policy "shogi_rooms_create"
  on public.shogi_rooms for insert to anon with check (true);
create policy "shogi_rooms_update"
  on public.shogi_rooms for update to anon using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shogi_rooms'
  ) then
    execute 'alter publication supabase_realtime add table public.shogi_rooms';
  end if;
end
$$;
```

### 安全上の注意

- アプリには `Publishable` / `anon` keyだけを入力してください。`secret` / `service_role` keyは管理者権限を持つため、絶対にブラウザーへ入力・公開しないでください。
- この設定では、対戦IDを知っている人が盤面を読み書きできます。対戦IDはランダムですが、これは認証や不正防止の代わりにはなりません。公開・賞金付きなど信頼性が必要な対局には使わないでください。
- 接続情報と最後に参加した対局は利用者のブラウザー内に保存されます。ページを再読み込みした場合は「前回の対局に戻る」を押すと、保存済みの盤面から再開できます。対局室を削除する機能はありません。不要な対局データはSupabaseの `Table Editor` で `shogi_rooms` の行を削除してください。

## テスト

Node.js がインストールされている環境では、ルールエンジンのテストを次のコマンドで実行できます。

```sh
node --test tests/shogi.test.js
```

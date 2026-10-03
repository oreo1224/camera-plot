# Camera Plot

Cloudflare Workers の Static Assets と D1 を使って、配置図をブラウザからクラウド保存できます。D1・Workers ともに小規模利用なら無料枠内で運用できます。

## ローカル開発

Node.js 22 以降が必要です。ローカル D1 にマイグレーションを適用してから起動します。
トップレベル設定は `camera-plot-dev` と無効なゼロUUIDを使う開発専用設定で、本番リソースには接続しません。

```sh
npx wrangler d1 migrations apply DB --local
npx wrangler dev
```

Static Assets は `.assetsignore` で `index.html` と `default-layout.json` のみに限定しています。

## 本番デプロイ

本番設定は `wrangler.jsonc` の `production` 環境に分離しています。本番操作には必ず `--env production` を指定します。
PRブランチからはデプロイせず、変更を `main` にマージした後、更新済みの `main` から実行してください。

```sh
git switch main
git pull --ff-only
npx wrangler login
npx wrangler d1 migrations apply DB --env production --remote
npx wrangler deploy --env production
```

## 新しいCloudflare環境を作る場合

新しいアカウントや障害復旧先へ再構築する場合は、D1を作成します。

```sh
npx wrangler login
npx wrangler d1 create camera-plot-db
```

表示された `account_id` と `database_id` を使い、`wrangler.jsonc` の `env.production` をコピーして、例えば `recovery` という別名の環境を追加します。
追加した環境名を指定してマイグレーションとデプロイを実行してください。

```sh
npx wrangler d1 migrations apply DB --env recovery --remote
npx wrangler deploy --env recovery
```

## バンド／プロファイルの共有

- 配置図本体は D1 の `plots` テーブルに保存されます。
- 同じデプロイURLを開いたメンバーは、全員が同じ配置図を参照・保存・削除できます。
- 保存時に「バンド名」と「プロファイル名」を指定します。1つのバンドに複数のプロファイルを保存でき、一覧はバンド単位で表示されます。
- 同じバンド内ではプロファイル名は重複できません。既存データを読み込むと、明示的な上書き保存が利用できます。
- 一覧は100件ずつ読み込み、保存件数が多い場合は「さらに読み込む」から続きを取得できます。
- このアプリ自体にはユーザー認証を設けていません。身内以外からの閲覧・変更を防ぐ場合は、Workerの前段に Cloudflare Access を設定し、許可するメールアドレスを限定してください。
- 重要な配置図は従来の JSON 書き出しでもバックアップしてください。1配置図の API 上限は 1 MiB、一覧は最大500件です。

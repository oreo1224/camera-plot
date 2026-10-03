# Camera Plot

Cloudflare Workers の Static Assets と D1 を使って、配置図をブラウザからクラウド保存できます。D1・Workers ともに小規模利用なら無料枠内で運用できます。

## 本番デプロイ

Node.js 22 以降と、設定済みの Cloudflare アカウントへのアクセス権が必要です。
本番 D1 のアカウント・データベース ID は `wrangler.jsonc` に設定済みです。

```sh
npx wrangler login
npx wrangler d1 migrations apply camera-plot-db --remote
npx wrangler deploy
```

Static Assets は `.assetsignore` で `index.html` と `default-layout.json` のみに限定しています。

ローカル開発では、ローカル D1 にマイグレーションを適用してから起動します。

```sh
npx wrangler d1 migrations apply camera-plot-db --local
npx wrangler dev
```

## バンド／プロファイルの共有

- 配置図本体は D1 の `plots` テーブルに保存されます。
- 同じデプロイURLを開いたメンバーは、全員が同じ配置図を参照・保存・削除できます。
- 保存時に「バンド名」と「プロファイル名」を指定します。1つのバンドに複数のプロファイルを保存でき、一覧はバンド単位で表示されます。
- 同じバンド内ではプロファイル名は重複できません。既存データを読み込むと、明示的な上書き保存が利用できます。
- 一覧は100件ずつ読み込み、保存件数が多い場合は「さらに読み込む」から続きを取得できます。
- このアプリ自体にはユーザー認証を設けていません。身内以外からの閲覧・変更を防ぐ場合は、Workerの前段に Cloudflare Access を設定し、許可するメールアドレスを限定してください。
- 重要な配置図は従来の JSON 書き出しでもバックアップしてください。1配置図の API 上限は 1 MiB、一覧は最大500件です。

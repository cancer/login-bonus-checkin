# login-bonus-checkin

複数サイトのデイリーログインボーナスを **Cloudflare Scheduled Workers** で毎日自動受け取りする汎用ツール。
サイトごとの処理を「プロバイダ（プラグイン）」として足していく構成。同梱プロバイダは `src/providers/` 参照。

## 設計方針

- **ブラウザログインを毎日踏まない。** 抽出済みの長寿命セッション（Cookie/トークン）で受け取り API を直接叩く。bot 対策（CAPTCHA 等）はログイン画面側の仕掛けなので発火しにくい。
- **サイト1個 = プロバイダ1個。** 共通部分（Cron・実行ループ・通知・クレデンシャル層）は1回だけ。サイトを増やすときは `src/providers/` にファイルを足して登録するだけ。
- **クレデンシャルも宣言ベース。** プロバイダは env も保存先も知らない。「何が要るか・どう取るか」を `credential` で宣言し、フレームワークが KV から読んでパース済みアカウントを注入する。`/admin` フォームと取得手順もこの宣言から自動生成。

```
src/
├─ index.js         共通エントリ: ルーティング(/admin | 手動トリガ) + Cron
├─ runner.js        共通: クレデンシャルのあるプロバイダを実行・結果集計
├─ credentials.js   共通: クレデンシャル層（KV優先 / env フォールバック）
├─ admin.js         /admin: KV へ保存する管理UI
├─ access.js        共通: Cloudflare Access の JWT 検証
├─ notify.js        共通: Slack 通知（宛先追加もここ）
└─ providers/       サイトごとのプロバイダ（registry.js に登録）
```

> 一部プロバイダは署名に MD5 を使うため `node:crypto` が必要。`wrangler.toml` で
> `compatibility_flags = ["nodejs_compat"]` を有効化済み。

## プロバイダ interface

`src/providers/registry.js` の `ALL` に追加するオブジェクト:

```js
export const myProvider = {
  id: "mysite",                       // PROVIDERS / KV キー / 表示で使う一意キー
  name: "MySite",                     // 表示名
  credential: {                       // 必要なクレデンシャルの宣言（/admin を生成）
    label: "MySite token",
    placeholder: "...",
    hint: "取得手順（/admin に表示される）",
    multiAccount: true,
    extract: { site: "https://...", script: "...", /* or */ manual: "..." },
  },
  parseAccount: (raw) => raw.trim(),  // 生文字列1行 → run が使う形（省略可）
  async run(ctx, accounts) {          // accounts = パース済みアカウント配列
    // ctx.env は非秘密設定用。クレデンシャルは accounts で注入される。
    return [{ label: "daily", ok: true, code: "0", message: "受け取り成功" }];
  },
};
```

`run` は `{ label, ok, code, message }` の配列を返すだけ。集計・通知・クレデンシャル注入は共通部分がやる。
サイト固有の取得手順・設定は各プロバイダ内に閉じ込める（README には書かない）。

## デプロイ

### 1. KV 名前空間を作る（クレデンシャル保存先）

```bash
npm install
npx wrangler kv namespace create CREDS
```

出力された `id` を `wrangler.toml` の `[[kv_namespaces]]` の `id=` に貼る。

### 2. `/admin` を Cloudflare Access で保護する

`/admin` はクレデンシャルを読み書きするので、必ず Cloudflare Access で保護する。

1. Cloudflare Zero Trust → Access → Applications で、Worker の `/admin` を保護
2. ポリシーで自分のアカウントだけ許可
3. Worker 側はさらに **Access の JWT を署名検証**（`access.js`）。`ACCESS_AUD` / `ACCESS_CERTS_URL`
   が未設定だと全 HTTP を 503 で塞ぐ（fail-closed）
4. Access 対象外の経路（Preview URL 等）は無効化しておく

### 3. デプロイ + 秘密

```bash
npm run deploy
npx wrangler secret put ACCESS_AUD         # Access アプリの Audience タグ
npx wrangler secret put ACCESS_CERTS_URL   # Access の JWK(certs) URL
npx wrangler secret put SLACK_WEBHOOK      # 通知先（任意）
```
（secrets はランタイム反映なので再デプロイ不要）

### 4. クレデンシャルを登録

`/admin` を開き（Access のログインを通過）、各欄の取得手順に従って値を貼って保存。
**以後の更新は CLI も再デプロイも不要** — 失効したらこのページを開いて貼り直すだけ（スマホでも可）。

## ローカル動作確認

```bash
npm install
cp .dev.vars.example .dev.vars   # CRED_<ID> に値を記入（env フォールバック）
npm run dev
```

localhost は Access 素通し。`/admin` で local KV に書ける。`/` は即実行、
`/__scheduled?cron=...` で Cron を擬似発火できる。

## 設定一覧

| 種別 | 名前 | 用途 |
|---|---|---|
| KV | `cred:<id>` | 各プロバイダのクレデンシャル（`/admin` から保存） |
| vars | `PROVIDERS` | 実行するプロバイダ id（空白区切り）。空ならクレデンシャルのある全プロバイダ |
| vars | `NOTIFY_ON_SUCCESS` | `1` で成功時も通知（既定はエラー時のみ） |
| vars | `ADMIN_URL` | 失敗通知に貼る `/admin` の URL |
| secret | `ACCESS_AUD` | Cloudflare Access の Audience タグ（JWT 検証） |
| secret | `ACCESS_CERTS_URL` | Access の JWK(certs) URL（JWT 検証） |
| secret | `SLACK_WEBHOOK` | 通知先 Slack Incoming Webhook（任意） |
| env(dev) | `CRED_<ID>` | ローカル `npm run dev` 用のフォールバック |

プロバイダ固有の設定変数は各プロバイダ実装を参照。

## 運用の肝：セッション失効

唯一の手動ポイントはセッションが切れたとき（検出方法はプロバイダ依存）。
`SLACK_WEBHOOK` を設定しておくと失効・エラー時に `/admin` の URL 付きで通知が飛ぶので、
開いて貼り直すだけ（CLI 不要）。

## 注意

- 自己アカウントのデイリー受け取りを自動化するもの。各サイトの利用規約は自己責任で確認すること。
- CAPTCHA(リスク判定)に当たった場合は一度手動で受け取ると解ける。多発するなら頻度を下げる。

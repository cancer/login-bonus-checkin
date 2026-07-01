# login-bonus-checkin

複数サイトのデイリーログインボーナスを **Cloudflare Scheduled Workers** で毎日自動受け取りする汎用ツール。
サイトごとの処理を「プロバイダ（プラグイン）」として足していく構成。現状の対応: HoYoLAB（Zenless Zone Zero ほか）/ Arknights: Endfield（SKPort）。

## 設計方針

- **ブラウザログインを毎日踏まない。** 抽出済みの長寿命セッション（Cookie/トークン）で受け取り API を直接叩く。bot 対策（CAPTCHA 等）はログイン画面側の仕掛けなので発火しにくい。
- **サイト1個 = プロバイダ1個。** 共通部分（Cron・実行ループ・通知・クレデンシャル層）は1回だけ。サイトを増やすときは `src/providers/` にファイルを足して登録するだけ。
- **クレデンシャルも宣言ベース。** プロバイダは env も保存先も知らない。「何が要るか」を `credential` で宣言し、フレームワークが KV から読んでパース済みアカウントを注入する。`/admin` フォームもこの宣言から自動生成。

```
src/
├─ index.js              共通エントリ: ルーティング(/admin | 手動トリガ) + Cron
├─ runner.js             共通: クレデンシャルのあるプロバイダを実行・結果集計
├─ credentials.js        共通: クレデンシャル層（KV優先 / env フォールバック）
├─ admin.js              /admin: KV へ保存する管理UI（Cloudflare Access で保護）
├─ notify.js             共通: Slack 通知（宛先追加もここ）
└─ providers/
   ├─ registry.js        プロバイダ登録所
   ├─ hoyolab.js         HoYoLAB（zzz / gi / hsr / hi3 / tot）
   └─ endfield.js        Arknights: Endfield（SKPort / Gryphline）
```

> Endfield は署名に MD5 を使うため `node:crypto` が必要。`wrangler.toml` で
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
    hint: "○○ から △△ をコピー。改行で複数アカウント。",
    multiAccount: true,
  },
  parseAccount: (raw) => raw.trim(),  // 生文字列1行 → run が使う形（省略可）
  async run(ctx, accounts) {          // accounts = パース済みアカウント配列
    // ctx.env は非秘密設定用。クレデンシャルは accounts で注入される。
    return [{ label: "daily", ok: true, code: "0", message: "受け取り成功" }];
  },
};
```

`run` は `{ label, ok, code, message }` の配列を返すだけ。集計・通知・クレデンシャル注入は共通部分がやる。

## クレデンシャルの取得（各サイトで1回）

保存は後述の `/admin` から。まず各サイトで値をコピーする。

**HoYoLAB**
1. <https://www.hoyolab.com/> にログイン
2. DevTools → Application → Cookies → `https://www.hoyolab.com`
3. `ltuid_v2` と `ltoken_v2` をコピーし `ltuid_v2=値; ltoken_v2=値` の1行にする
   （`ltoken_v2` は HttpOnly なので Cookie パネルから手動コピー）

**Endfield**
1. <https://game.skport.com/endfield/sign-in> にログイン
2. F12 → Console:
   ```js
   copy(JSON.parse(localStorage.getItem("SK_TOKEN_CACHE_KEY")).content)
   ```
   （保存するのは短命な cred ではなく、OAuth に通して cred を再生成できる長寿命の **account token**）

> どちらも複数アカウントは**改行区切り**で1つの入力欄にまとめて貼れる。

## デプロイ

### 1. KV 名前空間を作る（クレデンシャル保存先）

```bash
npm install
npx wrangler kv namespace create CREDS
```

出力された `id` を `wrangler.toml` の `[[kv_namespaces]]` の `id=` に貼る。

### 2. デプロイ

```bash
npx wrangler secret put SLACK_WEBHOOK     # 通知先（任意）
npx wrangler secret put TRIGGER_TOKEN     # 手動トリガ保護（任意）
npm run deploy
```

### 3. `/admin` を Cloudflare Access で保護する（必須）

`/admin` はクレデンシャルを読み書きするので、**無防備だと誰でもセッションを奪える**。

1. Cloudflare Zero Trust → Access → Applications → Add（Self-hosted）
2. アプリのドメイン/パスを **`<your-worker-domain>/admin`** に設定
3. ポリシーで自分のメール（Google 等）だけ許可
4. **workers.dev ルートを無効化**（Worker 設定）。Access は独自ドメイン側にしか掛からないため、
   `*.workers.dev` が生きていると `/admin` を Access 無しで叩けてしまう。必ず切る。

> コード側も保険として、`Cf-Access-Jwt-Assertion` ヘッダ（Access が付与）が無ければ
> `/admin` を 403 で塞ぐ（fail-closed）。ただし workers.dev 直アクセスでは偽装可能なので、
> 上の「独自ドメイン + workers.dev 無効化」が本命の防御。

### 4. クレデンシャルを登録

`https://<your-worker-domain>/admin` を開き（Access のログインを通過）、各欄に前段でコピーした値を貼って保存。
**以後の更新は CLI も再デプロイも不要** — 失効したらこのページを開いて貼り直すだけ（スマホでも可）。

## ローカル動作確認

```bash
npm install
cp .dev.vars.example .dev.vars   # CRED_HOYOLAB / CRED_ENDFIELD に値を記入（env フォールバック）
npm run dev
```

```bash
# localhost は Access 素通し。/admin から local KV に書いてもよい
open  "http://localhost:8787/admin"
curl  "http://localhost:8787/"                              # 即実行
curl  "http://localhost:8787/__scheduled?cron=10+16+*+*+*"  # Cron 擬似発火
```

## 設定一覧

| 種別 | 名前 | 用途 |
|---|---|---|
| KV | `cred:<id>` | 各プロバイダのクレデンシャル（`/admin` から保存） |
| vars | `PROVIDERS` | 実行するプロバイダ id（空白区切り）。空ならクレデンシャルのある全プロバイダ |
| vars | `HOYOLAB_GAMES` | HoYoLAB で受け取るゲーム（空白区切り）既定 `zzz` |
| vars | `NOTIFY_ON_SUCCESS` | `1` で成功時も通知 |
| secret | `SLACK_WEBHOOK` | 通知先 Slack Incoming Webhook（任意） |
| secret | `TRIGGER_TOKEN` | 手動 fetch トリガの保護（任意） |
| env(dev) | `CRED_<ID>` | ローカル `npm run dev` 用のクレデンシャル・フォールバック |

## 運用の肝：セッション失効

唯一の手動ポイントはセッションが切れたとき（HoYoLAB なら retcode `-100`、Endfield なら OAuth 段でエラー）。
`SLACK_WEBHOOK` を設定しておくと失効時に通知が飛ぶので、**`/admin` を開いて貼り直すだけ**（CLI 不要）。

## 注意

- 自己アカウントのデイリー受け取りを自動化するもの。各サイトの利用規約は自己責任で確認すること。
- CAPTCHA(リスク判定)に当たった場合は一度手動で受け取ると解ける。多発するなら頻度を下げる。

## HoYoLAB API 仕様（参考・ZZZ）

| 項目 | 値 |
|---|---|
| エンドポイント | `POST https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os/sign` |
| act_id | `e202406031448091` |
| 必須ヘッダ | `x-rpc-signgame: zzz`、`cookie`、ブラウザ相当の UA/Referer/Origin |
| retcode | `0`=成功 / `-5003`=受取済み / `-100`=Cookie失効 |

## Endfield API 仕様（参考・SKPort）

| 項目 | 値 |
|---|---|
| 出席エンドポイント | `GET/POST https://zonai.skport.com/web/v1/game/endfield/attendance` |
| 認証フロー | account token → `as.gryphline.com/.../grant` → `.../generate_cred_by_code` で cred+salt |
| 署名 | `sign = MD5( HMAC-SHA256( path + timestamp + headerJSON, salt ) )` |
| 必須ヘッダ | `cred`、`sign`、`platform:3`、`timestamp`、`vname`、`sk-game-role` |
| 判定 | `data.hasToday=true`=受取済み / 受け取りは POST して `data.awardIds` |

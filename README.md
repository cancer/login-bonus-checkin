# login-bonus-checkin

複数サイトのデイリーログインボーナスを **Cloudflare Scheduled Workers** で毎日自動受け取りする汎用ツール。
サイトごとの処理を「プロバイダ（プラグイン）」として足していく構成。現状の対応: HoYoLAB（Zenless Zone Zero ほか）/ Arknights: Endfield（SKPort）。

## 設計方針

- **ブラウザログインを毎日踏まない。** 抽出済みの長寿命セッション（Cookie/トークン）で受け取り API を直接叩く。bot 対策（CAPTCHA 等）はログイン画面側の仕掛けなので発火しにくい。
- **サイト1個 = プロバイダ1個。** 共通部分（Cron・実行ループ・通知・秘密管理）は1回だけ。サイトを増やすときは `src/providers/` にファイルを足して登録するだけ。

```
src/
├─ index.js              共通エントリ: Cron / 手動トリガ → runAll → notify
├─ runner.js             共通: 対象プロバイダを解決して順に実行・結果集計
├─ notify.js             共通: Discord 通知（宛先追加もここ）
└─ providers/
   ├─ registry.js        プロバイダ登録所 + 実行対象の解決
   ├─ hoyolab.js         HoYoLAB（zzz / gi / hsr / hi3 / tot）
   └─ endfield.js        Arknights: Endfield（SKPort / Gryphline）
```

> Endfield は署名に MD5 を使うため `node:crypto` が必要。`wrangler.toml` で
> `compatibility_flags = ["nodejs_compat"]` を有効化済み。

## プロバイダ interface

`src/providers/registry.js` の `ALL` に追加するオブジェクト:

```js
export const myProvider = {
  id: "mysite",                       // PROVIDERS / 表示で使う一意キー
  name: "MySite",                     // 表示名
  isConfigured(env) {                 // 必要な秘密が揃っているか
    return Boolean(env.MYSITE_TOKEN);
  },
  async run(env) {                    // 受け取り処理
    // ... fetch などで受け取り ...
    return [{ label: "daily", ok: true, code: "0", message: "受け取り成功" }];
  },
};
```

`run` は `{ label, ok, code, message }` の配列を返すだけ。あとは共通部分が集計・通知してくれる。

## セットアップ（HoYoLAB の例）

### 1. Cookie を抽出

1. ブラウザで <https://www.hoyolab.com/> にログイン
2. DevTools → Application → Cookies → `https://www.hoyolab.com`
3. `ltuid_v2` と `ltoken_v2` をコピーし、`ltuid_v2=値; ltoken_v2=値` の1行にする
   （`ltoken_v2` は HttpOnly なので DevTools から手動コピー）

## セットアップ（Endfield の例）

### 1. account token を抽出

1. ブラウザで <https://game.skport.com/endfield/sign-in> にログイン
2. F12 → Console で localStorage の token を取り出す:

   ```js
   copy(JSON.parse(localStorage.getItem("SK_TOKEN_CACHE_KEY")).content)
   ```

   （実装はこの **account token** を OAuth に通して cred+salt を毎回再生成するので、
   保存するのは短命な cred ではなく長寿命の token）
3. 得られた文字列を `ENDFIELD_TOKEN` に入れる

> token のキー名はサイト更新で変わることがある。Application → Local Storage を見て
> token らしき値（`SK_TOKEN_CACHE_KEY` など）を確認すること。

## ローカル動作確認 / デプロイ

### 2. ローカル動作確認

```bash
npm install
cp .dev.vars.example .dev.vars   # .dev.vars に各プロバイダの秘密を記入
npm run dev
```

```bash
curl "http://localhost:8787/"                              # 即実行
curl "http://localhost:8787/__scheduled?cron=10+16+*+*+*"  # Cron 擬似発火
```

### 3. デプロイ

```bash
npx wrangler secret put HOYOLAB_COOKIE    # HoYoLAB を使うなら
npx wrangler secret put ENDFIELD_TOKEN    # Endfield を使うなら
npx wrangler secret put DISCORD_WEBHOOK   # 任意
npx wrangler secret put TRIGGER_TOKEN     # 任意
npm run deploy
```

`npm run tail` でログ確認。以後は `wrangler.toml` の `crons` に従い自動実行。

## 設定一覧

| 種別 | 名前 | 用途 |
|---|---|---|
| vars | `PROVIDERS` | 実行するプロバイダ id（空白区切り）。空なら設定済みを全実行 |
| vars | `HOYOLAB_GAMES` | HoYoLAB で受け取るゲーム（空白区切り）既定 `zzz` |
| vars | `NOTIFY_ON_SUCCESS` | `1` で成功時も通知 |
| secret | `HOYOLAB_COOKIE` | `ltuid_v2=...; ltoken_v2=...`（改行で複数アカウント） |
| secret | `ENDFIELD_TOKEN` | Gryphline account token（改行で複数アカウント） |
| secret | `DISCORD_WEBHOOK` | 通知先（任意） |
| secret | `TRIGGER_TOKEN` | 手動 fetch トリガの保護（任意） |

## 運用の肝：セッション失効

唯一の手動ポイントはセッションが切れたとき（HoYoLAB なら retcode `-100`、Endfield なら OAuth 段でエラー）。
`DISCORD_WEBHOOK` を設定しておくと失効時に通知が飛ぶので、取り直して `wrangler secret put` で上書きするだけ。

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

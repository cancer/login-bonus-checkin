/**
 * Provider: Arknights: Endfield デイリーサインイン（SKPort / Gryphline）
 *
 * 方式: 永続トークン ACCOUNT_TOKEN から OAuth で cred+salt を生成し、署名付きで受け取り API を叩く。
 *   HoYoLAB と違い「ブラウザの cred」ではなく長寿命の account token を保存する（cred は短命なので毎回再生成）。
 *   ACCOUNT_TOKEN は現在 HttpOnly Cookie 化されており、web-api.skport.com/cookie_store/account_token
 *   （JSON の content）から取り出す。取得手順は下の credential.extract を参照。
 *
 * 署名: sign = MD5( HMAC-SHA256( path + timestamp + headerJSON, salt ) )  ← node:crypto が必要
 *   → wrangler.toml に compatibility_flags = ["nodejs_compat"] が必要。
 *
 * 使う秘密 (env):
 *   ENDFIELD_TOKEN : Gryphline account token。改行で複数アカウント可。
 */

import crypto from "node:crypto";

const BINDING_URL = "https://zonai.skport.com/api/v1/game/player/binding";
const ATTENDANCE_URL = "https://zonai.skport.com/web/v1/game/endfield/attendance";
const GENERATE_CRED_URL = "https://zonai.skport.com/web/v1/user/auth/generate_cred_by_code";
const OAUTH_GRANT_URL = "https://as.gryphline.com/user/oauth2/v2/grant";
const BASIC_INFO_URL = "https://as.gryphline.com/user/info/v1/basic";

const ENDFIELD_GAME_ID = "3";
const APP_CODE = "6eb76d4e13aa36e6";
const VNAME = "1.0.0";
const PLATFORM = "3";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ACCOUNT_TOKEN → cred + salt（OAuth 3 ステップ） */
async function performOAuthFlow(accountToken) {
  // 1. token 検証
  const infoRes = await fetch(`${BASIC_INFO_URL}?token=${encodeURIComponent(accountToken)}`, {
    headers: { Accept: "application/json" },
  });
  const info = await infoRes.json();
  if (info.status !== 0) throw new Error(`OAuth1(basic) 失敗: ${info.msg || JSON.stringify(info)}`);

  // 2. OAuth code 取得
  const grantRes = await fetch(OAUTH_GRANT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token: accountToken, appCode: APP_CODE, type: 0 }),
  });
  const grant = await grantRes.json();
  if (grant.status !== 0 || !grant.data?.code) {
    throw new Error(`OAuth2(grant) 失敗: ${grant.msg || JSON.stringify(grant)}`);
  }

  // 3. code → cred(+token=salt)
  const credRes = await fetch(GENERATE_CRED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      platform: PLATFORM,
      Referer: "https://www.skport.com/",
      Origin: "https://www.skport.com",
    },
    body: JSON.stringify({ code: grant.data.code, kind: 1 }),
  });
  const cred = await credRes.json();
  if (cred.code !== 0 || !cred.data?.cred) {
    throw new Error(`OAuth3(cred) 失敗: ${cred.message || JSON.stringify(cred)}`);
  }
  return { cred: cred.data.cred, salt: cred.data.token, userId: cred.data.userId };
}

function buildHeaders(cred, gameRole, timestamp) {
  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://game.skport.com",
    referer: "https://game.skport.com/",
    cred,
    platform: PLATFORM,
    "sk-language": "en",
    timestamp,
    vname: VNAME,
    "User-Agent": "Skport/0.7.0 (com.gryphline.skport; build:700089; Android 33; ) Okhttp/5.1.0",
  };
  if (gameRole) headers["sk-game-role"] = gameRole;
  return headers;
}

/** sign = MD5( HMAC-SHA256( path + timestamp + headerJSON, salt ) ) */
function computeSign(path, timestamp, salt) {
  const headerJson = JSON.stringify({ platform: PLATFORM, timestamp, dId: "", vName: VNAME });
  const hmac = crypto.createHmac("sha256", salt).update(`${path}${timestamp}${headerJson}`).digest("hex");
  return crypto.createHash("md5").update(hmac).digest("hex");
}

function now() {
  return Math.floor(Date.now() / 1000).toString();
}

/** binding からこのアカウントの Endfield ロール一覧を取る */
async function getPlayerRoles(cred, salt) {
  const path = "/api/v1/game/player/binding";
  const timestamp = now();
  const headers = buildHeaders(cred, null, timestamp);
  headers.sign = computeSign(path, timestamp, salt);

  const res = await fetch(BINDING_URL, { headers });
  const json = await res.json();
  if (json.code !== 0) throw new Error(json.message || `binding エラー: ${json.code}`);

  const app = json.data?.list?.find((a) => a.appCode === "endfield");
  if (!app?.bindingList?.length) throw new Error("Endfield のアカウント連携が見つかりません");

  const roles = [];
  for (const b of app.bindingList) {
    for (const role of b.roles || []) {
      roles.push({
        gameRole: `${ENDFIELD_GAME_ID}_${role.roleId}_${role.serverId}`,
        nickname: role.nickname,
        level: role.level,
        server: role.serverName,
      });
    }
  }
  if (!roles.length) throw new Error("binding 内にロールがありません");
  return roles;
}

async function checkInRole(cred, salt, role) {
  const path = "/web/v1/game/endfield/attendance";
  const timestamp = now();
  const headers = buildHeaders(cred, role.gameRole, timestamp);
  headers.sign = computeSign(path, timestamp, salt);

  // 出席状況確認
  const statusRes = await fetch(ATTENDANCE_URL, { headers });
  const status = await statusRes.json();
  if (status.code !== 0) throw new Error(status.message || `出席確認エラー: ${status.code}`);
  if (status.data?.hasToday) return { alreadyClaimed: true, rewards: [] };

  // 未受取 → 受け取り
  const claimRes = await fetch(ATTENDANCE_URL, { method: "POST", headers, body: null });
  const claim = await claimRes.json();
  if (claim.code !== 0) throw new Error(claim.message || `受け取りエラー: ${claim.code}`);

  const rewards = [];
  const map = claim.data?.resourceInfoMap ?? {};
  for (const award of claim.data?.awardIds ?? []) {
    const info = map[award.id];
    if (info) rewards.push(`${info.name} x${info.count}`);
  }
  return { alreadyClaimed: false, rewards };
}

export const endfield = {
  id: "endfield",
  name: "Arknights: Endfield",

  credential: {
    label: "Endfield account token",
    placeholder: "ACCOUNT_TOKEN の値（web-api の content / URLエンコードのまま可）",
    hint:
      "ACCOUNT_TOKEN は HttpOnly Cookie 化され、game.skport.com の Cookie 一覧には平文で出なくなりました。" +
      "サインイン済みの状態で下のスニペット/ブックマークレットを実行すると取得できます。" +
      "手動なら https://web-api.skport.com/cookie_store/account_token を開き JSON の content の値をコピー。" +
      "改行で複数アカウント。",
    multiAccount: true,
    extract: {
      site: "https://game.skport.com/endfield/sign-in",
      // ACCOUNT_TOKEN は HttpOnly でページから直接読めないが、同一サイトの
      // web-api.skport.com/cookie_store/account_token が JSON で反射してくれる（要ログイン Cookie）。
      script:
        `(async () => {
  const r = await fetch("https://web-api.skport.com/cookie_store/account_token", { credentials: "include", headers: { Accept: "application/json" } });
  const d = await r.json();
  const t = d?.data?.content ?? d?.content ?? d?.data?.code ?? d?.code;
  if (!t) { console.error("ACCOUNT_TOKEN が取得できませんでした:", d); return; }
  try { await navigator.clipboard.writeText(t); console.log("%cACCOUNT_TOKEN をコピーしました。/admin の欄に貼り付けてください。", "color:green;font-weight:bold"); }
  catch { console.log("クリップボードにコピーできませんでした。下の値を手動でコピー:\\n" + t); }
})();`,
      bookmarklet:
        `javascript:(function(){fetch("https://web-api.skport.com/cookie_store/account_token",{credentials:"include",headers:{Accept:"application/json"}}).then(function(r){return r.json();}).then(function(d){var t=(d&&d.data&&(d.data.content||d.data.code))||(d&&(d.content||d.code));if(!t){alert("ACCOUNT_TOKEN が取得できませんでした:\\n"+JSON.stringify(d));return;}navigator.clipboard.writeText(t).then(function(){alert("ACCOUNT_TOKEN をコピーしました。/admin の欄に貼り付けてください。");},function(){window.prompt("下の ACCOUNT_TOKEN をコピーしてください:",t);});}).catch(function(e){alert("取得失敗: "+e);});})();`,
    },
  },
  // 生文字列 → 1 アカウント分の token に正規化。URL エンコードされていれば剥がすが、
  // web-api の content は既にデコード済みのこともあるため、失敗時は生値を使う。
  parseAccount: (raw) => {
    const s = raw.trim();
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  },

  /**
   * @param {{env:object}} ctx
   * @param {string[]} tokens  フレームワークが注入する account token 群
   */
  async run(ctx, tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const accPrefix = tokens.length > 1 ? `acc${i + 1}/` : "";
      let cred, salt, roles;
      try {
        ({ cred, salt } = await performOAuthFlow(tokens[i]));
        roles = await getPlayerRoles(cred, salt);
      } catch (err) {
        out.push({ label: `${accPrefix}auth`, ok: false, code: "auth", message: String(err.message || err) });
        continue;
      }

      for (const role of roles) {
        const label = `${accPrefix}${role.nickname}[${role.server}]`;
        try {
          const r = await checkInRole(cred, salt, role);
          out.push({
            label,
            ok: true,
            code: r.alreadyClaimed ? "claimed" : "0",
            message: r.alreadyClaimed
              ? "本日は受け取り済み"
              : `受け取り成功${r.rewards.length ? ": " + r.rewards.join(", ") : ""}`,
          });
        } catch (err) {
          out.push({ label, ok: false, code: "claim", message: String(err.message || err) });
        }
        await sleep(500);
      }
    }
    return out;
  },
};

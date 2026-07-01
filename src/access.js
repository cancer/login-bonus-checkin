/**
 * Cloudflare Access の JWT 検証（RS256 署名 + aud + exp）。
 *
 * Access は URL 全体の前段に立つが、Access を通らず Worker に直接届いた
 * リクエストはヘッダ有無だけでは見破れない（偽装可能）。そこで Access が付与する
 * Cf-Access-Jwt-Assertion を、Access の公開鍵(JWKS)で署名検証して初めて本物と断定する。
 *
 * 必要な env（値はチャット/リポジトリに出さず wrangler secret put で登録）:
 *   ACCESS_AUD          : Access アプリの Audience タグ
 *   ACCESS_TEAM_DOMAIN  : <team>.cloudflareaccess.com
 *
 * どちらか未設定なら本番は 503（fail-closed）。localhost 開発は素通し。
 */

// JWKS はモジュールスコープにキャッシュ（isolate 生存中）。
let jwksCache = null; // { url, keys }

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

async function getKeys(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (jwksCache && jwksCache.url === url) return jwksCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS 取得失敗: ${res.status}`);
  const json = await res.json();
  jwksCache = { url, keys: json.keys || [] };
  return jwksCache.keys;
}

async function verifyToken(token, aud, teamDomain) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT 形式不正");
  const [h, p, s] = parts;

  const header = JSON.parse(b64urlToString(h));
  const payload = JSON.parse(b64urlToString(p));
  if (header.alg !== "RS256") throw new Error(`未対応 alg: ${header.alg}`);

  const keys = await getKeys(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("署名鍵(kid)が見つからない");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) throw new Error("署名不正");

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("期限切れ");
  if (payload.nbf && payload.nbf > now) throw new Error("まだ有効でない");
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error("aud 不一致");

  return payload;
}

function textResp(status, msg) {
  return new Response(`${status} ${msg}`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * 通過なら null、拒否なら Response を返す。
 */
export async function requireAccess(req, env) {
  const url = new URL(req.url);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null; // dev bypass

  const aud = env.ACCESS_AUD;
  const team = env.ACCESS_TEAM_DOMAIN;
  if (!aud || !team) {
    return textResp(503, "Cloudflare Access 未設定: ACCESS_AUD / ACCESS_TEAM_DOMAIN を登録してください");
  }

  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return textResp(403, "Access トークンがありません（Access を通過していません）");

  try {
    await verifyToken(token, aud, team);
  } catch (e) {
    return textResp(403, `Access 検証失敗: ${e.message}`);
  }
  return null;
}

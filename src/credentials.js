/**
 * クレデンシャル層。保存先の具象（KV / Secrets）をここに閉じ込め、プロバイダには
 * 「パース済みアカウント配列」だけを渡す。プロバイダは env も保存先も一切知らない。
 *
 * 保存規約:
 *   KV (binding: CREDS)  key = `cred:<providerId>`   … /admin から書く本命
 *   env fallback         `CRED_<PROVIDERID>`         … ローカル開発 / 移行用
 *
 * 値は「ブラウザからコピーした生文字列そのまま」。複数アカウントは改行区切り。
 */

const hasKV = (env) => env.CREDS && typeof env.CREDS.get === "function";

/** プロバイダ id の生クレデンシャル文字列を取得（KV 優先、無ければ env）。 */
export async function loadCredential(env, id) {
  if (hasKV(env)) {
    const v = await env.CREDS.get(`cred:${id}`);
    if (v != null && v.trim() !== "") return v;
  }
  return env[`CRED_${id.toUpperCase()}`] || "";
}

/** /admin から保存。KV バインディングが無ければエラー。 */
export async function saveCredential(env, id, value) {
  if (!hasKV(env) || typeof env.CREDS.put !== "function") {
    throw new Error("KV binding CREDS が未設定です（wrangler.toml の kv_namespaces）");
  }
  await env.CREDS.put(`cred:${id}`, value ?? "");
}

/** 生文字列 → アカウント配列。multiAccount は改行分割、各行を provider.parseAccount で正規化。 */
export function splitAccounts(raw, provider) {
  const parse = provider.parseAccount || ((s) => s.trim());
  const lines = provider.credential?.multiAccount ? raw.split("\n") : [raw];
  return lines.map(parse).filter(Boolean);
}

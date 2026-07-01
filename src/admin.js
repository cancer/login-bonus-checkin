/**
 * /admin — クレデンシャルを KV に保存する管理 UI。
 * フォームは各プロバイダの credential 宣言から自動生成される（プロバイダを足すと項目も増える）。
 *
 * 認証: Cloudflare Access で /admin* を保護する前提。Access が本人確認済みのとき
 * リクエストに Cf-Access-Jwt-Assertion ヘッダが付く。これが無ければ 403（fail-closed）。
 *   ※ workers.dev 経由の直アクセスはこのヘッダを偽装可能なので、本番では
 *     ・カスタムドメインの /admin* を Access で保護
 *     ・workers.dev ルートを無効化
 *   の両方を必ず行うこと（README 参照）。
 */

import { ALL } from "./providers/registry.js";
import { loadCredential, saveCredential } from "./credentials.js";

function isLocalDev(url) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

function accessGate(req, url) {
  if (isLocalDev(url)) return null; // ローカル開発は素通し
  if (!req.headers.get("Cf-Access-Jwt-Assertion")) {
    return new Response(
      "403 Forbidden: Cloudflare Access で保護されていません。README の Access 設定を確認してください。",
      { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }
  return null;
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function page(body) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ログインボーナス — クレデンシャル管理</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.5}
  h1{font-size:1.3rem} h2{font-size:1.05rem;margin:1.6rem 0 .3rem}
  .hint{color:#666;font-size:.85rem;margin:.2rem 0 .4rem}
  textarea{width:100%;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:.9rem;padding:.5rem;min-height:4.5rem}
  button{margin-top:1.2rem;padding:.6rem 1.4rem;font-size:1rem;cursor:pointer}
  .ok{background:#e6ffed;border:1px solid #3fb950;padding:.5rem .8rem;border-radius:6px}
  .set{color:#3fb950} .unset{color:#999}
</style></head><body>${body}</body></html>`;
}

async function renderForm(env, saved) {
  const rows = [];
  for (const p of ALL) {
    const c = p.credential || {};
    const current = await loadCredential(env, p.id);
    const state = current && current.trim()
      ? `<span class="set">設定済み（${current.split("\n").filter((s) => s.trim()).length} アカウント）</span>`
      : `<span class="unset">未設定</span>`;
    rows.push(`
      <h2>${esc(p.name)} <small>[${esc(p.id)}]</small> — ${state}</h2>
      <div class="hint">${esc(c.hint || "")}</div>
      <textarea name="${esc(p.id)}" placeholder="${esc(c.placeholder || "")}">${esc(current)}</textarea>`);
  }
  return page(`
    <h1>クレデンシャル管理</h1>
    ${saved ? '<p class="ok">保存しました。次回の Cron から反映されます。</p>' : ""}
    <form method="POST" action="/admin/save">
      ${rows.join("")}
      <div><button type="submit">保存</button></div>
    </form>
    <p class="hint">値はブラウザからコピーした生文字列をそのまま。複数アカウントは改行で区切ります。空のまま保存するとそのプロバイダは無効化されます。</p>`);
}

export async function handleAdmin(req, env) {
  const url = new URL(req.url);
  const blocked = accessGate(req, url);
  if (blocked) return blocked;

  if (url.pathname === "/admin/save" && req.method === "POST") {
    const form = await req.formData();
    for (const p of ALL) {
      if (form.has(p.id)) {
        await saveCredential(env, p.id, (form.get(p.id) || "").trim());
      }
    }
    return new Response(null, { status: 303, headers: { Location: "/admin?saved=1" } });
  }

  const html = await renderForm(env, url.searchParams.get("saved") === "1");
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

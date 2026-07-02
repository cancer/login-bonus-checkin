/**
 * ログインボーナス自動受け取り（汎用）— Cloudflare Scheduled Workers エントリ。
 *
 * サイトごとの処理は src/providers/*.js に分離。共通フローはここ:
 *   Cron / 手動トリガ → runAll(全プロバイダ実行) → notify(結果通知)
 *
 * ルーティング (fetch):
 *   全 HTTP … Cloudflare Access の JWT を検証（未通過は 403 / 未設定は 503）
 *   /admin* … クレデンシャル管理 UI
 *   それ以外 … 手動トリガ（動作確認・即実行用）
 * ※ Cron の毎日実行は scheduled ハンドラで、HTTP を通らないため Access の影響を受けない。
 *
 * クレデンシャル: KV (binding CREDS) に /admin から保存。ローカルは env の CRED_<ID> でも可。
 * secret: SLACK_WEBHOOK（通知先／任意）, ACCESS_AUD / ACCESS_CERTS_URL（Access 検証）
 */

import { runAll } from "./runner.js";
import { notify } from "./notify.js";
import { handleAdmin } from "./admin.js";
import { requireAccess } from "./access.js";

export default {
  // Cron Trigger（HTTP を通らないので Access 非対象）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const report = await runAll(env);
        await notify(env, report);
        console.log(JSON.stringify(report));
      })()
    );
  },

  async fetch(req, env) {
    // 全 HTTP を Cloudflare Access の JWT 検証で保護
    const blocked = await requireAccess(req, env);
    if (blocked) return blocked;

    const url = new URL(req.url);

    // クレデンシャル管理 UI
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return handleAdmin(req, env);
    }

    // 手動トリガ（即実行・動作確認用）
    try {
      const report = await runAll(env);
      await notify(env, report);
      return Response.json({ ok: report.every((p) => p.ok), report });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 500 });
    }
  },
};

/**
 * ログインボーナス自動受け取り（汎用）— Cloudflare Scheduled Workers エントリ。
 *
 * サイトごとの処理は src/providers/*.js に分離。共通フローはここ:
 *   Cron / 手動トリガ → runAll(全プロバイダ実行) → notify(結果通知)
 *
 * ルーティング (fetch):
 *   /admin*  … クレデンシャル管理 UI（Cloudflare Access で保護）
 *   それ以外 … 手動トリガ（TRIGGER_TOKEN で保護、動作確認用）
 *
 * クレデンシャル: KV (binding CREDS) に /admin から保存。ローカルは env の CRED_<ID> でも可。
 * その他 secret: DISCORD_WEBHOOK（通知先／任意）, TRIGGER_TOKEN（手動トリガ保護／任意）
 * vars: PROVIDERS（実行 id・空白区切り／未指定は全登録）, NOTIFY_ON_SUCCESS（"1"で成功時も通知）
 */

import { runAll } from "./runner.js";
import { notify } from "./notify.js";
import { handleAdmin } from "./admin.js";

export default {
  // Cron Trigger
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
    const url = new URL(req.url);

    // クレデンシャル管理 UI（認証は Cloudflare Access）
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return handleAdmin(req, env);
    }

    // 手動トリガ（curl / ブラウザで即実行・動作確認用）
    if (env.TRIGGER_TOKEN && url.searchParams.get("token") !== env.TRIGGER_TOKEN) {
      return new Response("forbidden", { status: 403 });
    }
    try {
      const report = await runAll(env);
      await notify(env, report);
      return Response.json({ ok: report.every((p) => p.ok), report });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 500 });
    }
  },
};

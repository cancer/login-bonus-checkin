/**
 * ログインボーナス自動受け取り（汎用）— Cloudflare Scheduled Workers エントリ。
 *
 * サイトごとの処理は src/providers/*.js に分離。共通フローはここ:
 *   Cron / 手動トリガ → runAll(全プロバイダ実行) → notify(結果通知)
 *
 * 秘密 (wrangler secret put):
 *   <PROVIDER>_*    : 各プロバイダが要求する秘密（例: HOYOLAB_COOKIE）
 *   DISCORD_WEBHOOK : 通知先（任意）
 *   TRIGGER_TOKEN   : 手動 fetch トリガの保護（任意）
 * vars (wrangler.toml):
 *   PROVIDERS       : 実行するプロバイダ id（空白区切り）。未指定なら設定済みを全実行。
 *   NOTIFY_ON_SUCCESS : "1" で成功時も通知
 */

import { runAll } from "./runner.js";
import { notify } from "./notify.js";

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

  // 手動トリガ（curl / ブラウザで即実行・動作確認用）
  async fetch(req, env) {
    const url = new URL(req.url);
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

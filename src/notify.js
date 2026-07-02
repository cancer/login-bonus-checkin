// 成功時も通知するか。切り替えるだけならここを直接書き換えて deploy する。
const NOTIFY_ON_SUCCESS = true;

/**
 * 通知（任意）。エラーがあるとき、または NOTIFY_ON_SUCCESS のとき送信。
 * 今は Slack のみ。他の宛先を足すならここに分岐を追加する。
 */
export async function notify(env, report) {
  const hasError = report.some((p) => !p.ok);
  if (!hasError && !NOTIFY_ON_SUCCESS) return;

  const lines = [];
  for (const p of report) {
    lines.push(`*${p.name}*`); // Slack mrkdwn の太字は *…*
    if (p.error) {
      lines.push(`⚠️ ${p.error}`);
      continue;
    }
    for (const r of p.results) {
      lines.push(`${r.ok ? "✅" : "⚠️"} ${r.label}: ${r.message}`);
    }
  }
  // 失効・エラー時は修復導線として /admin の URL を貼る
  if (hasError && env.ADMIN_URL) {
    lines.push(`🔧 修復: ${env.ADMIN_URL}`);
  }
  const text = `【ログインボーナス】\n${lines.join("\n")}`;

  await sendSlack(env, text);
}

async function sendSlack(env, text) {
  const webhook = env.SLACK_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }), // Slack Incoming Webhook のペイロード
    });
  } catch (_) {
    // 通知失敗は致命ではない
  }
}

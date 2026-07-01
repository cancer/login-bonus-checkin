/**
 * 通知（任意）。エラーがあるとき、または NOTIFY_ON_SUCCESS=1 のとき送信。
 * 今は Slack のみ。他の宛先を足すならここに分岐を追加する。
 */
export async function notify(env, report) {
  const hasError = report.some((p) => !p.ok);
  const notifyOnSuccess = env.NOTIFY_ON_SUCCESS === "1";
  if (!hasError && !notifyOnSuccess) return;

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

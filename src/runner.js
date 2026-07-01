import { selectProviders } from "./providers/registry.js";
import { loadCredential, splitAccounts } from "./credentials.js";

/**
 * 候補プロバイダのうちクレデンシャルが揃っているものを実行し、結果をまとめる。
 * プロバイダには env ではなくパース済み accounts を注入する。
 * @returns {Promise<Array<{id:string, name:string, ok:boolean, results:Array, error?:string}>>}
 */
export async function runAll(env) {
  const candidates = selectProviders(env);

  // クレデンシャルの有無で実行対象を絞る
  const active = [];
  for (const p of candidates) {
    const raw = await loadCredential(env, p.id);
    if (raw && raw.trim()) active.push({ p, accounts: splitAccounts(raw, p) });
  }

  if (active.length === 0) {
    throw new Error("実行対象のプロバイダがありません（クレデンシャル未設定 / PROVIDERS 指定ミス）");
  }

  const ctx = { env };
  const report = [];
  for (const { p, accounts } of active) {
    try {
      const results = await p.run(ctx, accounts);
      report.push({ id: p.id, name: p.name, ok: results.every((r) => r.ok), results });
    } catch (err) {
      report.push({ id: p.id, name: p.name, ok: false, results: [], error: String(err) });
    }
  }
  return report;
}

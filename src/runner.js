import { resolveProviders } from "./providers/registry.js";

/**
 * 全対象プロバイダを順に実行し、結果をまとめる。
 * @returns {Promise<Array<{id:string, name:string, ok:boolean, results:Array, error?:string}>>}
 */
export async function runAll(env) {
  const providers = resolveProviders(env);
  if (providers.length === 0) {
    throw new Error("実行対象のプロバイダがありません（秘密未設定 / PROVIDERS 指定ミス）");
  }

  const report = [];
  for (const p of providers) {
    try {
      const results = await p.run(env);
      report.push({ id: p.id, name: p.name, ok: results.every((r) => r.ok), results });
    } catch (err) {
      report.push({ id: p.id, name: p.name, ok: false, results: [], error: String(err) });
    }
  }
  return report;
}

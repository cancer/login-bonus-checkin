/**
 * プロバイダ登録所。サイトを増やすときはここに import して ALL に足すだけ。
 *
 * プロバイダ interface:
 *   id: string                       一意なキー（env / PROVIDERS で指定する名前）
 *   name: string                     表示名
 *   isConfigured(env): boolean       必要な秘密が揃っているか
 *   run(env): Promise<Result[]>      Result = { label, ok, code, message }
 */

import { hoyolab } from "./hoyolab.js";
import { endfield } from "./endfield.js";

export const ALL = [
  hoyolab,
  endfield,
];

/**
 * 実行対象を解決する。
 * env.PROVIDERS が指定されていればその id だけ、無ければ「設定済みの」全プロバイダ。
 */
export function resolveProviders(env) {
  if (env.PROVIDERS) {
    const want = new Set(env.PROVIDERS.split(/\s+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
    return ALL.filter((p) => want.has(p.id));
  }
  return ALL.filter((p) => p.isConfigured(env));
}

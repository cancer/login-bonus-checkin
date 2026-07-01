/**
 * プロバイダ登録所。サイトを増やすときはここに import して ALL に足すだけ。
 *
 * プロバイダ interface:
 *   id: string                       一意なキー（PROVIDERS / KV キー / 表示で使う）
 *   name: string                     表示名
 *   credential: {                    必要なクレデンシャルの宣言（/admin フォーム等を生成）
 *     label, placeholder, hint, multiAccount
 *   }
 *   parseAccount?(raw): any          生文字列1行 → run が使う形（省略時は trim）
 *   run(ctx, accounts): Promise<Result[]>   Result = { label, ok, code, message }
 */

import { hoyolab } from "./hoyolab.js";
import { endfield } from "./endfield.js";

export const ALL = [
  hoyolab,
  endfield,
];

/**
 * 実行候補プロバイダ。env.PROVIDERS があればその id だけ、無ければ全登録。
 * 「クレデンシャルが揃っているか」の判定はクレデンシャル層でのみ行う（ここは知らない）。
 */
export function selectProviders(env) {
  if (env.PROVIDERS) {
    const want = new Set(env.PROVIDERS.split(/\s+/).map((s) => s.trim().toLowerCase()).filter(Boolean));
    return ALL.filter((p) => want.has(p.id));
  }
  return ALL;
}

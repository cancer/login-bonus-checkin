/**
 * プロバイダ登録所。サイトを増やすときはここに import して ALL に足すだけ。
 *
 * プロバイダ interface:
 *   id: string                       一意なキー（KV キー / 表示で使う）
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
 * 実行候補プロバイダ（全登録）。
 * 「クレデンシャルが揃っているか」の判定はクレデンシャル層でのみ行う（ここは知らない）。
 * 特定のプロバイダだけ止めたい場合は /admin でそのクレデンシャルを消す。
 */
export function selectProviders() {
  return ALL;
}

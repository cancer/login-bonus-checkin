/**
 * Provider: HoYoLAB デイリーチェックイン（ZZZ / Genshin / HSR / HI3 / ToT）
 *
 * 方式: ブラウザログイン不要。長寿命 Cookie (ltoken_v2 / ltuid_v2) で受け取り API を直接叩く。
 *
 * 使う秘密 (env):
 *   HOYOLAB_COOKIE : "ltuid_v2=...; ltoken_v2=..."  改行で複数アカウント可
 *   HOYOLAB_GAMES  : 受け取るゲーム（空白区切り）既定 "zzz"  ※vars でも可
 */

const ENDPOINTS = {
  zzz: "https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os/sign?act_id=e202406031448091",
  gi:  "https://sg-hk4e-api.hoyolab.com/event/sol/sign?act_id=e202102251931481",
  hsr: "https://sg-public-api.hoyolab.com/event/luna/os/sign?act_id=e202303301540311",
  hi3: "https://sg-public-api.hoyolab.com/event/mani/sign?act_id=e202110291205111",
  tot: "https://sg-public-api.hoyolab.com/event/luna/os/sign?act_id=e202202281857121",
};

const SUCCESS_CODES = {
  "0": "受け取り成功",
  "-5003": "本日は受け取り済み",
};

const ERROR_CODES = {
  "-100": "未ログイン: Cookie が無効です。ltoken_v2 / ltuid_v2 を取り直してください",
  "-10002": "未プレイ: このアカウントでこのゲームをプレイしていません",
};

async function signOne(cookie, game) {
  const url = new URL(ENDPOINTS[game]);
  const actId = url.searchParams.get("act_id");
  url.searchParams.set("lang", "ja-jp");

  const headers = new Headers({
    "accept": "application/json, text/plain, */*",
    "accept-language": "ja-JP,ja;q=0.9",
    "origin": "https://act.hoyolab.com",
    "referer": "https://act.hoyolab.com/",
    "content-type": "application/json;charset=UTF-8",
    "cookie": cookie,
    "x-rpc-signgame": game,
    "sec-ch-ua": '"Chromium";v="126", "Not/A)Brand";v="8"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  const body = JSON.stringify({ lang: "ja-jp", act_id: actId });

  let json;
  try {
    const res = await fetch(url, { method: "POST", headers, body });
    json = await res.json();
  } catch (err) {
    return { ok: false, code: "network", message: `通信エラー: ${err}` };
  }

  const code = String(json.retcode);
  if (code in SUCCESS_CODES) return { ok: true, code, message: SUCCESS_CODES[code] };

  if (code === "-9999" || code === "1034" || json?.data?.risk_code) {
    return {
      ok: false,
      code,
      message: `リスク判定(CAPTCHA要求)。手動で1回受け取ってから再開してください: ${json.message ?? ""}`,
    };
  }

  return {
    ok: false,
    code,
    message: ERROR_CODES[code] ?? `未知のエラー retcode=${code}: ${json.message ?? JSON.stringify(json)}`,
  };
}

export const hoyolab = {
  id: "hoyolab",
  name: "HoYoLAB",

  /** この env で動かせるか（秘密が揃っているか） */
  isConfigured(env) {
    return Boolean(env.HOYOLAB_COOKIE);
  },

  /**
   * @returns {Promise<Array<{label:string, ok:boolean, code:string, message:string}>>}
   */
  async run(env) {
    const cookies = env.HOYOLAB_COOKIE.split("\n").map((s) => s.trim()).filter(Boolean);
    const games = (env.HOYOLAB_GAMES || env.GAMES || "zzz")
      .split(/\s+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

    const out = [];
    for (let i = 0; i < cookies.length; i++) {
      for (const game of games) {
        const label = cookies.length > 1 ? `acc${i + 1}/${game}` : game;
        if (!(game in ENDPOINTS)) {
          out.push({ label, ok: false, code: "invalid", message: `未対応のゲーム: ${game}` });
          continue;
        }
        const r = await signOne(cookies[i], game);
        out.push({ label, ...r });
      }
    }
    return out;
  },
};

import * as cheerio from "cheerio";
import { Resend } from "resend";
import { translate } from "@vitalets/google-translate-api";

// 重试助手
async function retry(fn, { maxRetries = 3, delayMs = 2000, label = "" } = {}) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries) throw err;
      console.error(`  ${label}第 ${i + 1} 次失败: ${err.message}`);
      console.error(`  ${delayMs}ms 后重试...`);
      await new Promise(r => setTimeout(r, delayMs));
      delayMs *= 2;
    }
  }
}

// 语言颜色映射
const langColors = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
  Java: "#b07219", Go: "#00ADD8", Rust: "#dea584", "C++": "#f34b7d",
  Ruby: "#701516", Swift: "#F05138", Kotlin: "#A97BFF", PHP: "#4F5D95",
  "C#": "#178600", Vue: "#41b883", Dart: "#00B4AB", Lua: "#000080",
};

function langDot(lang) {
  const color = langColors[lang] || "#8b8b8b";
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:4px;vertical-align:middle"></span>`;
}

function buildHtml(top10, today, periodLabel) {
  const cards = top10.map((r, i) => {
    const stars = Number(r.totalStars) || 0;
    const starsFmt = stars >= 1000 ? (stars / 1000).toFixed(1) + "k" : String(stars);
    return `
    <tr>
      <td style="padding:16px 18px;border:1px solid #30363d;border-radius:10px;margin-bottom:12px;display:block;background:#161b22">
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%">
          <tr>
            <td style="vertical-align:top;padding-right:14px">
              <span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:50%;background:#1f6feb;color:#fff;font-size:13px;font-weight:700">${i + 1}</span>
            </td>
            <td style="vertical-align:top;width:100%">
              <a href="${r.url}" style="font-size:16px;font-weight:600;color:#58a6ff;text-decoration:none">${r.name}</a>
              ${r.descZh ? `<p style="margin:8px 0 0 0;font-size:14px;color:#e6edf3;line-height:1.5">${r.descZh}</p>` : ""}
              ${r.description ? `<p style="margin:4px 0 0 0;font-size:12px;color:#8b949e;line-height:1.4">${r.description}</p>` : ""}
              <div style="margin-top:10px;font-size:13px;color:#8b949e">
                ${r.language ? `<span>${langDot(r.language)} ${r.language} &nbsp;</span>` : ""}
                <span>⭐ ${starsFmt}</span>
                <span style="margin-left:14px">📈 ${r.starsToday}</span>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#0d1117;margin:0;padding:24px 20px">
<table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;margin:0 auto;background:#0d1117">
  <tr><td style="padding:0 0 20px 0">
    <h2 style="margin:0;font-size:22px;color:#e6edf3">🔥 GitHub ${periodLabel}热门仓库 — ${today}</h2>
    <p style="margin:6px 0 0 0;font-size:13px;color:#8b949e">今日 Top ${top10.length}</p>
  </td></tr>
  ${cards}
  <tr><td style="padding-top:24px;text-align:center">
    <p style="font-size:11px;color:#484f58">由 <a href="https://github.com/Emanon0718/Emanon-will-do-this" style="color:#58a6ff;text-decoration:none">GitHub Trending Bot</a> 自动发送</p>
  </td></tr>
</table>
</body>
</html>`;
}

function buildText(top10, today, periodLabel) {
  const lines = [`GitHub ${periodLabel}热门仓库 — ${today}`, "", "今日 Top 10:", ""];
  for (let i = 0; i < top10.length; i++) {
    const r = top10[i];
    lines.push(`${i + 1}. ${r.name}`);
    if (r.descZh) lines.push(`   ${r.descZh}`);
    if (r.description) lines.push(`   (原文) ${r.description}`);
    lines.push(`   语言: ${r.language || "未知"} | ${r.url}`);
    lines.push(`   总 ⭐: ${r.totalStars} | ${r.starsToday}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const TO_EMAIL = process.env.TO_EMAIL;
  const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev";

  if (!RESEND_API_KEY || !TO_EMAIL) {
    throw new Error("缺少必需的环境变量: RESEND_API_KEY 和 TO_EMAIL");
  }

  const now = new Date();
  const SINCE = process.env.SINCE ||
    (now.getUTCDate() === 1 ? "monthly" :
     now.getUTCDay() === 1 ? "weekly" :
     "daily");

  const periodLabels = { daily: "每日", weekly: "本周", monthly: "本月" };
  const periodLabel = periodLabels[SINCE] || "每日";
  const today = now.toISOString().split("T")[0];

  console.log(`模式: ${periodLabel} (since=${SINCE})`);
  console.log(`正在获取 ${today} 的 GitHub Trending...`);

  const html = await retry(
    () => fetch(`https://github.com/trending?since=${SINCE}`, {
      headers: { "User-Agent": "Trending-Email-Bot" },
      signal: AbortSignal.timeout(30000),
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    }),
    { label: "抓取" }
  );

  const $ = cheerio.load(html);
  const repos = [];

  $("article.Box-row").each((_i, el) => {
    const $el = $(el);
    const h2 = $el.find("h2");
    const name = h2.text().replace(/\s+/g, " ").trim();
    const url = "https://github.com" + h2.find("a").attr("href");
    const description = $el.find("p").first().text().trim();
    const language = $el.find('[itemprop="programmingLanguage"]').text().trim();
    const starsEl = $el.find("a[href$='/stargazers']").first();
    const totalStars = starsEl.text().replace(/\s+/g, "").replace(/,/g, "") || "?";
    const starsToday = $el.find(".float-sm-right").first().text().trim();

    repos.push({ name, url, description, language, totalStars, starsToday });
  });

  console.log(`获取到 ${repos.length} 个热门仓库`);
  const top10 = repos.slice(0, 10);

  // 翻译描述
  console.log("正在翻译描述...");
  const results = await Promise.allSettled(
    top10.map(r =>
      r.description
        ? translate(r.description, {
            to: "zh-CN",
            fetchOptions: { signal: AbortSignal.timeout(10000) },
          })
        : Promise.resolve(null)
    )
  );
  results.forEach((res, i) => {
    if (res.status === "fulfilled" && res.value) {
      top10[i].descZh = res.value.text;
    } else {
      if (res.status === "rejected") {
        console.error(`  翻译失败: ${top10[i].name} — ${res.reason.message}`);
      }
      top10[i].descZh = "";
    }
  });

  const textBody = buildText(top10, today, periodLabel);
  const htmlBody = buildHtml(top10, today, periodLabel);

  console.log("--- 邮件内容预览 ---");
  console.log(textBody);
  console.log("--- 预览结束 ---");

  const resend = new Resend(RESEND_API_KEY);
  const { data, error } = await retry(
    async () => {
      const result = await resend.emails.send({
        from: `GitHub Trending <${FROM_EMAIL}>`,
        to: [TO_EMAIL],
        subject: `GitHub ${periodLabel}热门仓库 — ${today}`,
        text: textBody,
        html: htmlBody,
      });
      if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
      return result;
    },
    { label: "发送" }
  );

  if (error) {
    throw new Error(`邮件发送失败: ${JSON.stringify(error)}`);
  }

  console.log("邮件发送成功!", data?.id);
  return data;
}

// SCF entry point
export async function main_handler(event, context) {
  try {
    await main();
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error("\n致命错误:", err.message);
    console.error(err.stack);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

import * as cheerio from "cheerio";
import { Resend } from "resend";
import { translate } from "@vitalets/google-translate-api";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO_EMAIL = process.env.TO_EMAIL;
const FROM_EMAIL = process.env.FROM_EMAIL || "onboarding@resend.dev";

if (!RESEND_API_KEY || !TO_EMAIL) {
  console.error("缺少必需的环境变量: RESEND_API_KEY 和 TO_EMAIL");
  process.exit(1);
}

const today = new Date().toISOString().split("T")[0];

console.log(`正在获取 ${today} 的 GitHub Trending...`);

const html = await fetch("https://github.com/trending", {
  headers: { "User-Agent": "Trending-Email-Bot" },
  signal: AbortSignal.timeout(30000),
}).then((r) => r.text());

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

// 翻译仓库描述为中文（并行）
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

const lines = [`GitHub 每日热门仓库 — ${today}`, "", "今日 Top 10:", ""];

for (let i = 0; i < top10.length; i++) {
  const r = top10[i];
  lines.push(`${i + 1}. ${r.name}`);
  if (r.descZh) lines.push(`   ${r.descZh}`);
  if (r.description) lines.push(`   (原文) ${r.description}`);
  lines.push(`   语言: ${r.language || "未知"} | ${r.url}`);
  lines.push(`   总 ⭐: ${r.totalStars} | ${r.starsToday}`);
  lines.push("");
}

const body = lines.join("\n");

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

function buildHtml(top10, today) {
  const cards = top10.map((r, i) => {
    const stars = Number(r.totalStars) || 0;
    const starsFmt = stars >= 1000 ? (stars / 1000).toFixed(1) + "k" : String(stars);
    return `
    <tr>
      <td style="padding:14px 16px;border:1px solid #e1e4e8;border-radius:8px;margin-bottom:8px;display:block;background:#fff">
        <table cellpadding="0" cellspacing="0" border="0" style="width:100%">
          <tr>
            <td style="font-size:18px;font-weight:700;color:#0366d6;padding-right:10px;vertical-align:top">#${i + 1}</td>
            <td style="vertical-align:top;width:100%">
              <a href="${r.url}" style="font-size:16px;font-weight:600;color:#0366d6;text-decoration:none">${r.name}</a>
              ${r.descZh ? `<p style="margin:6px 0 0 0;font-size:14px;color:#24292e">${r.descZh}</p>` : ""}
              ${r.description ? `<p style="margin:4px 0 0 0;font-size:12px;color:#6a737d">${r.description}</p>` : ""}
              <div style="margin-top:8px;font-size:13px;color:#586069">
                ${r.language ? `<span>${langDot(r.language)} ${r.language} &nbsp;</span>` : ""}
                <span>⭐ ${starsFmt}</span>
                <span style="margin-left:12px">📈 ${r.starsToday}</span>
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
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f6f8fa;margin:0;padding:20px">
<table cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;margin:0 auto;background:#f6f8fa">
  <tr><td style="padding:0 0 16px 0">
    <h2 style="margin:0;font-size:22px;color:#24292e">🔥 GitHub 每日热门仓库 — ${today}</h2>
    <p style="margin:4px 0 0 0;font-size:13px;color:#586069">今日 Top ${top10.length}</p>
  </td></tr>
  ${cards}
  <tr><td style="padding-top:20px;text-align:center">
    <p style="font-size:11px;color:#959da5">由 <a href="https://github.com/Emanon0718/Emanon-will-do-this" style="color:#0366d6">GitHub Trending Bot</a> 自动发送</p>
  </td></tr>
</table>
</body>
</html>`;
}

const htmlBody = buildHtml(top10, today);

console.log("--- 邮件内容预览 ---");
console.log(body);
console.log("--- 预览结束 ---");

const resend = new Resend(RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: `GitHub Trending <${FROM_EMAIL}>`,
  to: [TO_EMAIL],
  subject: `GitHub 每日热门仓库 — ${today}`,
  text: body,
  html: htmlBody,
});

if (error) {
  console.error("邮件发送失败:", error);
  process.exit(1);
}

console.log("邮件发送成功!", data);

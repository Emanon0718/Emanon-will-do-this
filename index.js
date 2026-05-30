import * as cheerio from "cheerio";
import { Resend } from "resend";

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

const lines = [`GitHub Trending Daily — ${today}`, "", "Today's Top Repos:", ""];

for (let i = 0; i < top10.length; i++) {
  const r = top10[i];
  lines.push(`${i + 1}. ${r.name}`);
  if (r.description) lines.push(`   ${r.description}`);
  lines.push(`   Language: ${r.language || "Unknown"} | ${r.url}`);
  lines.push(`   Total ⭐: ${r.totalStars} | ${r.starsToday}`);
  lines.push("");
}

const body = lines.join("\n");

console.log("--- 邮件内容预览 ---");
console.log(body);
console.log("--- 预览结束 ---");

const resend = new Resend(RESEND_API_KEY);

const { data, error } = await resend.emails.send({
  from: `GitHub Trending <${FROM_EMAIL}>`,
  to: [TO_EMAIL],
  subject: `GitHub Trending Daily — ${today}`,
  text: body,
});

if (error) {
  console.error("邮件发送失败:", error);
  process.exit(1);
}

console.log("邮件发送成功!", data);

// api/cron.ts
// Vercel Cron から叩かれて、Qiita と DEV Community の人気記事を Discord に投稿
import * as cheerio from "cheerio";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL!;
const QIITA_TOKEN = process.env.QIITA_TOKEN ?? "";

// ---- Qiita ----
type QiitaItem = { title: string; url: string; likes_count?: number };
type LinkItem  = { title: string; url: string; note?: string };

async function fetchQiitaTop3(): Promise<LinkItem[]> {
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const jstYesterday = new Date(jstNow.getTime() - 24 * 60 * 60 * 1000);
  const y = jstYesterday.getUTCFullYear();
  const m = String(jstYesterday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jstYesterday.getUTCDate()).padStart(2, "0");

  const url = `https://qiita.com/api/v2/items?per_page=100&query=created:>=${y}-${m}-${d}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (QIITA_TOKEN) headers.Authorization = `Bearer ${QIITA_TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Qiita API error: ${res.status}`);
  const items: QiitaItem[] = await res.json();

  return items
    .sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0))
    .slice(0, 3)
    .map((it) => ({
      title: it.title,
      url: it.url,
      note: `LGTM: ${it.likes_count ?? 0}`,
    }));
}

// ---- DEV Community (dev.to) ----
// RSSは UTF-8 なので iconv は不要
async function fetchDevToTop3(): Promise<LinkItem[]> {
  const res = await fetch("https://dev.to/feed");
  if (!res.ok) throw new Error(`DEV.to feed error: ${res.status}`);
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const items: LinkItem[] = [];
  $("item").each((_, el) => {
    const title = $(el).find("title").first().text().trim();
    const link  = $(el).find("link").first().text().trim();
    if (title && link) items.push({ title, url: link });
  });

  return items.slice(0, 3);
}

// ---- Discord 送信 ----
function buildDiscordMessage(qiita: LinkItem[], devto: LinkItem[]) {
  const a =
    "**Qiita 人気記事**\n" +
    qiita.map((x, i) => `${i + 1}. ${x.title}\n${x.url}${x.note ? `\n${x.note}` : ""}`).join("\n\n");
  const b =
    "**DEV Community 人気記事**\n" +
    devto.map((x, i) => `${i + 1}. ${x.title}\n${x.url}`).join("\n\n");
  return `${a}\n\n${b}`;
}

// ---- エントリーポイント ----
export default async function handler(req: any, res: any) {
  try {
    if (!DISCORD_WEBHOOK_URL) throw new Error("DISCORD_WEBHOOK_URL is not set");
    const [qiita, devto] = await Promise.all([fetchQiitaTop3(), fetchDevToTop3()]);
    const content = buildDiscordMessage(qiita, devto);

    const r = await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!r.ok) throw new Error(`Discord webhook error: ${r.status} ${await r.text()}`);

    res.status(200).send("ok");
  } catch (e: any) {
    console.error(e);
    res.status(500).send(e?.message ?? "error");
  }
}

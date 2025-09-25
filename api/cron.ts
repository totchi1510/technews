import type { VercelRequest, VercelResponse } from "@vercel/node";
import cheerio from "cheerio";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL!;
const QIITA_TOKEN = process.env.QIITA_TOKEN ?? "";

type QiitaItem = {
  title: string;
  url: string;
  likes_count: number;
};

async function fetchQiitaTop3() {
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

async function fetchITMediaTop3() {
  const res = await fetch("https://www.itmedia.co.jp/ranking/", {
    headers: { "User-Agent": "vercel-cron/1.0" },
  });
  if (!res.ok) throw new Error(`ITmedia ranking error: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const links: { title: string; url: string }[] = [];
  $("a").each((_, el) => {
    const t = $(el).text().trim();
    const href = $(el).attr("href") || "";
    if (!t || !href) return;
    if (!href.startsWith("https://www.itmedia.co.jp")) return;
    if (t.length < 8) return; // タイトルが短すぎるものを除外
    links.push({ title: t, url: href });
  });

  return links.slice(0, 3).map((it) => ({ ...it, note: "" }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const [qiita, itmedia] = await Promise.all([fetchQiitaTop3(), fetchITMediaTop3()]);
    const content =
      "**Qiita 人気記事**\n" +
      qiita.map((x, i) => `${i + 1}. ${x.title}\n${x.url} (${x.note})`).join("\n\n") +
      "\n\n**ITmedia 人気記事**\n" +
      itmedia.map((x, i) => `${i + 1}. ${x.title}\n${x.url}`).join("\n\n");

    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });

    res.status(200).send("ok");
  } catch (err: any) {
    console.error(err);
    res.status(500).send(err.message ?? "error");
  }
}

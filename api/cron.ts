// api/cron.ts
// Vercel Cron から叩かれて、Qiita/ITmediaの人気記事をDiscordに投稿
import cheerio from "cheerio";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL!;
const QIITA_TOKEN = process.env.QIITA_TOKEN ?? "";

// ---- Qiita ----
type QiitaItem = { title: string; url: string; likes_count?: number };
type LinkItem = { title: string; url: string; note?: string };

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

// ---- ITmedia ----
async function fetchITMediaTop3(): Promise<LinkItem[]> {
  const res = await fetch("https://www.itmedia.co.jp/ranking/", {
    headers: { "User-Agent": "vercel-cron/1.0" },
  });
  if (!res.ok) throw new Error(`ITmedia ranking error: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const links: LinkItem[] = [];
  $("a").each((_, el) => {
    const t = $(el).text().trim();
    const href = $(el).attr("href") || "";
    if (!t || !href) return;
    if (!href.startsWith("https://www.itmedia.co.jp")) return; // ★ここが未完で落ちていました
    if (t.length < 8) return;
    links.push({ title: t, url: href });
  });

  // 重複URL除去 → 先頭3件
  const seen = new Set<string>();
  const unique: LinkItem[] = [];
  for (const l of links) {
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    unique.push(l);
  }
  return unique.slice(0, 3);
}

// ---- Discord 送信 ----
function buildDiscordMessage(qiita: LinkItem[], itm: LinkItem[]) {
  const a =
    "**Qiita 人気記事**\n" +
    qiita.map((x, i) => `${i + 1}. ${x.title}\n${x.url}${x.note ? `\n${x.note}` : ""}`).join("\n\n");
  const b =
    "**ITmedia 人気記事**\n" +
    itm.map((x, i) => `${i + 1}. ${x.title}\n${x.url}`).join("\n\n");
  return `${a}\n\n${b}`;
}

// 型を使わず any でOK（@vercel/node は不要）
export default async function handler(req: any, res: any) {
  try {
    if (!DISCORD_WEBHOOK_URL) throw new Error("DISCORD_WEBHOOK_URL is not set");
    const [q, i] = await Promise.all([fetchQiitaTop3(), fetchITMediaTop3()]);
    const content = buildDiscordMessage(q, i);

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

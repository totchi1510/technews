// Vercel Serverless Function (Node.js)
// 7:00 / 17:00 JST に Vercel Cron から GET される想定
import cheerio from "cheerio";

// ---- 設定 ----
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL!;
const QIITA_TOKEN = process.env.QIITA_TOKEN ?? "";

type QiitaItem = {
  title: string;
  url: string;
  likes_count: number;
  created_at: string;
  user?: { id?: string };
};

async function fetchQiitaTop3(): Promise<{ title: string; url: string; note: string }[]> {
  // 直近24時間（JST）でフィルタ
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const jstYesterday = new Date(jstNow.getTime() - 24 * 60 * 60 * 1000);
  const y = jstYesterday.getUTCFullYear();
  const m = String(jstYesterday.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jstYesterday.getUTCDate()).padStart(2, "0");

  // Qiita API: /api/v2/items?per_page=100&query=created:>=YYYY-MM-DD
  // ※ like数はレスポンスの likes_count をクライアント側でソートします。
  const url = `https://qiita.com/api/v2/items?per_page=100&query=created:>=${y}-${m}-${d}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (QIITA_TOKEN) headers.Authorization = `Bearer ${QIITA_TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Qiita API error: ${res.status}`);
  const items: QiitaItem[] = await res.json();

  const top3 = items
    .sort((a, b) => (b.likes_count ?? 0) - (a.likes_count ?? 0))
    .slice(0, 3)
    .map((it) => ({
      title: it.title,
      url: it.url,
      note: `LGTM: ${it.likes_count ?? 0}`,
    }));

  return top3;
}

async function fetchITMediaTop3(): Promise<{ title: string; url: string; note: string }[]> {
  // ランキング面をスクレイピング
  const res = await fetch("https://www.itmedia.co.jp/ranking/", {
    headers: { "User-Agent": "vercel-cron/1.0" },
  });
  if (!res.ok) throw new Error(`ITmedia ranking error: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // ページ構造は時期で変わり得るので、上位リンクっぽい要素を複数パターンで探索
  const links: { title: string; url: string }[] = [];
  $("a").each((_, el) => {
    const t = $(el).text().trim();
    const href = $(el).attr("href") || "";
    // itmediaドメインの記事へのリンクで、ある程度タイトル長があるものを候補に
    if (href.startsWith("


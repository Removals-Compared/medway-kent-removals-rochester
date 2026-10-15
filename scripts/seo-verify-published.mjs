// ════════════════════════════════════════════════════════════
//  Confirms that a page the publisher wrote is really live, with the right
//  title, description and text, and only then marks the article `published`.
//  Articles that do not match yet stay `publishing` with the reason noted;
//  nothing is ever marked published on faith.
//
//  Env: DATABASE_URL, VERIFY_ATTEMPTS (default 12), VERIFY_DELAY_MS (default 30000)
// ════════════════════════════════════════════════════════════
import { parsePage } from '../seo/lib/seo-audit-lib.mjs';
import { SITE } from '../seo/lib/seo-post-render.mjs';

if (!process.env.DATABASE_URL) { console.log('No DATABASE_URL: nothing to verify.'); process.exit(0); }
const ATTEMPTS = Number(process.env.VERIFY_ATTEMPTS || 12);
const DELAY = Number(process.env.VERIFY_DELAY_MS ?? 30000);
const BASE = process.env.VERIFY_BASE || SITE;
const { neon } = await import('@neondatabase/serverless');
const q = (t, p = []) => neon(process.env.DATABASE_URL).query(t, p);

const plain = (h) => String(h).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function check(url, rev) {
  let r;
  try { r = await fetch(url + (url.includes('?') ? '&' : '?') + 'verify=' + Date.now(), { redirect: 'follow', headers: { 'user-agent': 'MKR-publish-verify/1.0' }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { return `could not fetch the page (${String(e.message).slice(0, 60)})`; }
  if (r.status !== 200) return `the page returns ${r.status}`;
  const html = await r.text();
  const p = parsePage(html, url);
  if (!p.title.startsWith(rev.title)) return `the live title is "${p.title.slice(0, 70)}"`;
  if ((rev.meta_description || '') !== p.meta_description) return 'the live meta description differs from the approved one';
  if (p.canonical && !p.canonical.endsWith(new URL(url).pathname)) return `the canonical points to ${p.canonical}`;
  const snippet = plain(rev.content).slice(0, 80);
  if (snippet && !plain(html).includes(snippet)) return 'the live text does not start with the approved text';
  return null;
}

const rows = await q(
  `SELECT a.id, a.slug, a.published_url, r.title, r.meta_description, r.content, r.meta
     FROM seo_articles a JOIN seo_article_revisions r ON r.id = a.current_revision_id WHERE a.status = 'publishing' ORDER BY a.id`);
if (!rows.length) { console.log('nothing is waiting to be verified'); process.exit(0); }

let ok = 0, waiting = 0;
for (const a of rows) {
  const url = a.published_url || `${BASE}/blog/posts/${(a.meta && a.meta.slug) || a.slug}`;
  let why = 'not checked';
  for (let i = 0; i < ATTEMPTS; i++) {
    why = await check(url.replace(SITE, BASE), a);
    if (!why) break;
    if (i < ATTEMPTS - 1) await sleep(DELAY);
  }
  if (!why) {
    const done = await q(
      `UPDATE seo_articles SET status='published', published_revision_id=current_revision_id, published_url=$2, published_at=now(), last_error=NULL WHERE id=$1 AND status='publishing' RETURNING id`, [a.id, url]);
    if (done.length) { ok++; console.log(`VERIFIED ${url}`); await q(`INSERT INTO seo_activity (actor, action, article_id, detail) VALUES ('publisher','article_published',$1,$2)`, [a.id, url]); }
  } else {
    waiting++;
    console.log(`NOT YET ${url}: ${why}`);
    await q(`UPDATE seo_articles SET last_error=$2 WHERE id=$1 AND status='publishing'`, [a.id, `Waiting for the live page: ${why}`.slice(0, 400)]);
  }
}
console.log(`${ok} verified, ${waiting} still waiting`);
process.exit(0);

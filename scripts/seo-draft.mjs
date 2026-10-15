// ════════════════════════════════════════════════════════════
//  Drafting job. Turns one queued request into a draft revision that waits
//  for the owner. It never approves or publishes anything.
//
//    node scripts/seo-draft.mjs --job 12
//
//  Needs DATABASE_URL and ANTHROPIC_API_KEY (SEO_MODEL optional).
//  Run by .github/workflows/seo-draft.yml when "Draft this" is pressed.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { makeClaude, runDraft, DEFAULT_MODEL, slugify } from './seo-draft-lib.mjs';
import { allowedAmountsFrom, corpusEntry } from './seo-quality-lib.mjs';

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : null; };
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const jobId = Number(val('job'));
if (!jobId) { console.error('Usage: node scripts/seo-draft.mjs --job <seo_jobs id>'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(2); }

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const q = (text, params = []) => sql.query(text, params);

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const listHtml = (dir) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.html') && !f.endsWith('-block.html')).map((f) => path.join(dir, f)); } catch { return []; } };

async function buildContext(articleId) {
  const facts = JSON.parse(read('seo/business-facts.json'));
  const pricing = read('pricing.md');
  const pagesDb = await q(`SELECT path, title FROM seo_pages WHERE (robots IS NULL OR robots NOT ILIKE '%noindex%') ORDER BY path`);
  const pages = pagesDb.map((p) => ({ path: p.path, title: String(p.title || '').replace(/\s*\|.*$/, '') }));
  const files = [...listHtml('.'), ...listHtml('blog/posts')];
  const corpus = [];
  const existingSlugs = new Set((await q(`SELECT slug FROM seo_articles WHERE id <> $1`, [articleId])).map((r) => r.slug));
  for (const f of files) {
    const p = '/' + f.replace(/\.html$/, '');
    corpus.push(corpusEntry(p === '/index' ? '/' : p, read(f)));
    const base = path.basename(f, '.html');
    if (f.startsWith('blog/posts/')) existingSlugs.add(base); else existingSlugs.add(base);
  }
  return {
    facts, pricing, pages, corpus, existingSlugs,
    allowedAmounts: allowedAmountsFrom(pricing, facts.allowed_extra_amounts || []),
    sitePaths: new Set(pages.map((p) => p.path)),
    model: process.env.SEO_MODEL || DEFAULT_MODEL,
  };
}

let article;
try {
  const job = (await q(`SELECT * FROM seo_jobs WHERE id = $1`, [jobId]))[0];
  if (!job || job.type !== 'draft') throw new Error(`Job ${jobId} is not a draft job`);
  await q(`UPDATE seo_jobs SET status='running', started_at=now(), attempts=attempts+1 WHERE id=$1`, [jobId]);
  const input = job.payload;
  article = (await q(`SELECT * FROM seo_articles WHERE id = $1`, [input.article_id]))[0];
  if (!article) throw new Error('The article for this job no longer exists');

  const ctx = await buildContext(article.id);
  if (!ctx.pages.length) throw new Error('No pages in seo_pages. Run the site audit first so the draft can link to real pages.');
  const llm = makeClaude({ apiKey: process.env.ANTHROPIC_API_KEY, model: ctx.model });
  const setStatus = (s) => q(`UPDATE seo_articles SET status=$2 WHERE id=$1`, [article.id, s]);

  const { revision, quality } = await runDraft({ input, ctx, llm, onStep: setStatus });
  const slugFree = revision.meta.slug && !ctx.existingSlugs.has(revision.meta.slug);

  const version = (await q(`SELECT coalesce(max(version),0)+1 AS v FROM seo_article_revisions WHERE article_id=$1`, [article.id]))[0].v;
  const rev = (await q(
    `INSERT INTO seo_article_revisions (article_id, version, title, meta_description, content, meta, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,'ai-draft') RETURNING id, content_hash`,
    [article.id, version, revision.title, revision.meta_description, revision.content, JSON.stringify(revision.meta)]))[0];

  const report = { ...quality, revision_id: rev.id, content_hash: rev.content_hash, acknowledged: [], checked_at: new Date().toISOString() };
  const status = quality.critical_count > 0 ? 'needs_revision' : 'awaiting_approval';
  await q(
    `UPDATE seo_articles SET current_revision_id=$2, title=$3, slug=CASE WHEN $4::boolean THEN $5 ELSE slug END,
            quality_score=$6, quality_report=$7::jsonb, status=$8, last_error=NULL WHERE id=$1`,
    [article.id, rev.id, revision.title, slugFree, revision.meta.slug, quality.score, JSON.stringify(report), status]);
  await q(`UPDATE seo_jobs SET status='succeeded', finished_at=now(), result=$2::jsonb WHERE id=$1`,
    [jobId, JSON.stringify({ article_id: article.id, revision_id: rev.id, status, critical: quality.critical_count, warnings: quality.warn_count, words: quality.stats.words })]);
  await q(`INSERT INTO seo_activity (actor, action, article_id, detail) VALUES ('ai-draft','draft_created',$1,$2)`, [article.id, `"${revision.title}" ${quality.stats.words} words, ${quality.critical_count} critical, ${quality.warn_count} warnings`]);
  console.log(`Draft ready: "${revision.title}" (${quality.stats.words} words). Status ${status}. Critical ${quality.critical_count}, warnings ${quality.warn_count}.`);
} catch (e) {
  console.error('Draft failed:', e.message);
  const msg = String(e.message).slice(0, 500);
  await q(`UPDATE seo_jobs SET status='failed', finished_at=now(), last_error=$2 WHERE id=$1`, [jobId, msg]).catch(() => {});
  if (article) await q(`UPDATE seo_articles SET status='failed', last_error=$2 WHERE id=$1`, [article.id, msg]).catch(() => {});
  process.exit(1);
}

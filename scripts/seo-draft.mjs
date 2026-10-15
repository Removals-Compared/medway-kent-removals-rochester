// ════════════════════════════════════════════════════════════
//  Drafting job. Turns one queued request into a draft revision that waits
//  for the owner. It never approves or publishes anything.
//
//    node scripts/seo-draft.mjs --job 12     draft the request in seo_jobs row 12
//    node scripts/seo-draft.mjs --queued     redraft every imported queue post that
//                                            has not been redrafted yet (one by one)
//    node scripts/seo-draft.mjs --posts      the same for imported LIVE posts (seo-import-published.mjs)
//
//  Needs DATABASE_URL and ANTHROPIC_API_KEY (SEO_MODEL optional).
//  Run by .github/workflows/seo-draft.yml.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { makeClaude, runDraft, DEFAULT_MODEL } from '../seo/lib/seo-draft-lib.mjs';
import { allowedAmountsFrom, corpusEntry } from '../seo/lib/seo-quality-lib.mjs';

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : null; };
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const jobArg = Number(val('job'));
const queuedMode = args.includes('--queued') || args.includes('--posts');
const postsMode = args.includes('--posts');
if (!jobArg && !queuedMode) { console.error('Usage: node scripts/seo-draft.mjs --job <seo_jobs id>  |  --queued'); process.exit(2); }
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
  const corpus = [];
  const existingSlugs = new Set((await q(`SELECT slug FROM seo_articles WHERE id <> $1`, [articleId])).map((r) => r.slug));
  for (const f of [...listHtml('.'), ...listHtml('blog/posts')]) {
    const p = '/' + f.replace(/\.html$/, '');
    corpus.push(corpusEntry(p === '/index' ? '/' : p, read(f)));
    existingSlugs.add(path.basename(f, '.html'));
  }
  return {
    facts, pricing, pages, corpus, existingSlugs,
    allowedAmounts: allowedAmountsFrom(pricing, facts.allowed_extra_amounts || []),
    sitePaths: new Set(pages.map((p) => p.path)),
    model: process.env.SEO_MODEL || DEFAULT_MODEL,
  };
}

// Fields a later step (sync, publishing) needs from the first version of an imported post.
const KEEP_META = ['source_file', 'scheduled_for', 'blog_meta_html', 'imported', 'imported_published', 'original_date'];
const plainText = (h) => String(h).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

async function draftOne(jobId) {
  let article;
  try {
    const job = (await q(`SELECT * FROM seo_jobs WHERE id = $1`, [jobId]))[0];
    if (!job || job.type !== 'draft') throw new Error(`Job ${jobId} is not a draft job`);
    await q(`UPDATE seo_jobs SET status='running', started_at=now(), attempts=attempts+1 WHERE id=$1`, [jobId]);
    const input = { ...job.payload };
    article = (await q(`SELECT * FROM seo_articles WHERE id = $1`, [input.article_id]))[0];
    if (!article) throw new Error('The article for this job no longer exists');

    const prev = (await q(`SELECT meta, content, created_by FROM seo_article_revisions WHERE article_id=$1 ORDER BY version DESC LIMIT 1`, [article.id]))[0];
    if (prev) input.keep_slug = (prev.meta && prev.meta.slug) || article.slug; // a redraft keeps the address it was scheduled under
    if (prev && prev.meta && (prev.meta.imported || prev.meta.imported_published)) input.existing_text = plainText(prev.content).slice(0, 4000); // so the rewrite builds on what is already there

    const ctx = await buildContext(article.id);
    if (input.keep_slug) ctx.existingSlugs.delete(input.keep_slug); // a redraft's own address is not a clash
    if (!ctx.pages.length) throw new Error('No pages in seo_pages. Run the site audit first so the draft can link to real pages.');
    const llm = makeClaude({ apiKey: process.env.ANTHROPIC_API_KEY, model: ctx.model });
    const setStatus = (s) => q(`UPDATE seo_articles SET status=$2 WHERE id=$1`, [article.id, s]);

    const { revision, quality } = await runDraft({ input, ctx, llm, onStep: setStatus });
    if (prev && prev.meta) for (const k of KEEP_META) if (prev.meta[k] !== undefined) revision.meta[k] = prev.meta[k];

    const version = (await q(`SELECT coalesce(max(version),0)+1 AS v FROM seo_article_revisions WHERE article_id=$1`, [article.id]))[0].v;
    const rev = (await q(
      `INSERT INTO seo_article_revisions (article_id, version, title, meta_description, content, meta, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,'ai-draft') RETURNING id, content_hash`,
      [article.id, version, revision.title, revision.meta_description, revision.content, JSON.stringify(revision.meta)]))[0];

    const report = { ...quality, revision_id: rev.id, content_hash: rev.content_hash, acknowledged: [], checked_at: new Date().toISOString() };
    const status = quality.critical_count > 0 ? 'needs_revision' : 'awaiting_approval';
    const newSlug = revision.meta.slug;
    const adoptSlug = !prev && !!newSlug && newSlug !== article.slug && !ctx.existingSlugs.has(newSlug); // only a brand-new draft may take the writer's address
    await q(
      `UPDATE seo_articles SET current_revision_id=$2, title=$3, quality_score=$4, quality_report=$5::jsonb, status=$6, last_error=NULL,
              slug=CASE WHEN $7::boolean THEN $8 ELSE slug END WHERE id=$1`,
      [article.id, rev.id, revision.title, quality.score, JSON.stringify(report), status, adoptSlug, newSlug]);
    await q(`UPDATE seo_jobs SET status='succeeded', finished_at=now(), result=$2::jsonb WHERE id=$1`,
      [jobId, JSON.stringify({ article_id: article.id, revision_id: rev.id, status, critical: quality.critical_count, warnings: quality.warn_count, words: quality.stats.words })]);
    await q(`INSERT INTO seo_activity (actor, action, article_id, detail) VALUES ('ai-draft','draft_created',$1,$2)`, [article.id, `"${revision.title}" ${quality.stats.words} words, ${quality.critical_count} critical, ${quality.warn_count} warnings`]);
    console.log(`Draft ready: "${revision.title}" (${quality.stats.words} words). Status ${status}. Critical ${quality.critical_count}, warnings ${quality.warn_count}.`);
    for (const f of quality.findings.filter((x) => x.severity === 'critical')) console.log(`   needs your attention: ${f.message}`);
    return true;
  } catch (e) {
    console.error('Draft failed:', e.message);
    const msg = String(e.message).slice(0, 500);
    await q(`UPDATE seo_jobs SET status='failed', finished_at=now(), last_error=$2 WHERE id=$1`, [jobId, msg]).catch(() => {});
    if (article) await q(`UPDATE seo_articles SET status='failed', last_error=$2 WHERE id=$1`, [article.id, msg]).catch(() => {});
    return false;
  }
}

let allOk = true;
if (jobArg) {
  allOk = await draftOne(jobArg);
} else {
  // Every imported queue post that is still on its original, too-short text.
  const todo = await q(
    `SELECT a.id, a.title, a.slug, a.target_keyword FROM seo_articles a JOIN seo_article_revisions r ON r.id = a.current_revision_id
      WHERE a.source = $1 AND r.created_by = 'import' AND a.status IN ('needs_revision','awaiting_approval','planned','failed')
      ORDER BY a.scheduled_for, a.id`, [postsMode ? 'bot' : 'scheduled_queue']);
  console.log(`${todo.length} ${postsMode ? 'live' : 'queued'} post(s) to redraft`);
  for (const a of todo) {
    console.log(`\n== ${a.title}`);
    const job = (await q(
      `INSERT INTO seo_jobs (type, status, requested_by, payload) VALUES ('draft','queued','github-action',$1::jsonb) RETURNING id`,
      [JSON.stringify({ article_id: a.id, keyword: a.target_keyword || a.title, kind: 'post', notes: postsMode ? 'Rewrite and expand this LIVE article into a fuller, genuinely useful version at the same address. Keep its subject and its good points. Keep the title if it already works.' : 'Redraft of a short scheduled post: write a fuller, more useful article. Keep the same subject.' })]))[0];
    if (!(await draftOne(job.id))) allOk = false;
  }
}
process.exit(allOk ? 0 : 1);

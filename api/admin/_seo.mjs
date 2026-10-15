// ════════════════════════════════════════════════════════════
//  SEO module: database reads/writes for api/admin/seo.mjs.
//  Tables are created by admin/SEO-SCHEMA.sql (run once in Neon).
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { q } from './_sql.mjs';
import { checkDraft, allowedAmountsFrom, ACKNOWLEDGEABLE } from '../../seo/lib/seo-quality-lib.mjs';
import { slugify } from '../../seo/lib/seo-draft-lib.mjs';

export async function tablesReady() {
  const r = await q(`SELECT to_regclass('public.seo_jobs') AS jobs, to_regclass('public.seo_articles') AS articles`);
  return !!(r[0] && r[0].jobs && r[0].articles);
}

export async function logSeo(actor, action, detail = '', articleId = null) {
  try {
    await q('INSERT INTO seo_activity (actor, action, article_id, detail) VALUES ($1,$2,$3,$4)', [actor, action, articleId, detail]);
  } catch { /* logging must never break the action */ }
}

export async function overview() {
  const [pages, issues, jobs, articles] = await Promise.all([
    q(`SELECT page_type, count(*)::int AS n, round(avg(word_count))::int AS avg_words FROM seo_pages GROUP BY page_type ORDER BY page_type`),
    q(`SELECT severity, count(*)::int AS n FROM seo_audit_issues WHERE status = 'open' GROUP BY severity`),
    q(`SELECT id, type, status, result, last_error, finished_at, created_at FROM seo_jobs WHERE type = 'audit' ORDER BY id DESC LIMIT 1`),
    q(`SELECT status, count(*)::int AS n FROM seo_articles GROUP BY status`),
  ]);
  const sev = { error: 0, warn: 0, info: 0 };
  issues.forEach((r) => { sev[r.severity] = r.n; });
  return {
    pages,
    page_total: pages.reduce((a, r) => a + r.n, 0),
    open_issues: sev,
    last_audit: jobs[0] || null,
    articles: Object.fromEntries(articles.map((r) => [r.status, r.n])),
  };
}

export async function listPages() {
  return q(`
    SELECT p.url, p.path, p.page_type, p.title, p.word_count, p.links_in, p.in_sitemap, p.last_crawled,
           count(i.id) FILTER (WHERE i.status = 'open' AND i.severity = 'error')::int AS errors,
           count(i.id) FILTER (WHERE i.status = 'open' AND i.severity = 'warn')::int  AS warnings
      FROM seo_pages p LEFT JOIN seo_audit_issues i ON i.url = p.url
     GROUP BY p.url, p.path, p.page_type, p.title, p.word_count, p.links_in, p.in_sitemap, p.last_crawled
     ORDER BY errors DESC, warnings DESC, p.path
     LIMIT 500`);
}

export async function listIssues({ status = 'open', severity, type } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'all') { params.push(status); where.push(`status = $${params.length}`); }
  if (severity) { params.push(severity); where.push(`severity = $${params.length}`); }
  if (type) { params.push(type); where.push(`type = $${params.length}`); }
  return q(
    `SELECT id, url, type, issue_key, severity, detail, status, last_seen FROM seo_audit_issues
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, type, url LIMIT 1000`,
    params);
}

export async function setIssueStatus(id, status) {
  if (!['open', 'ignored'].includes(status)) throw new Error('bad status');
  const r = await q(`UPDATE seo_audit_issues SET status = $2 WHERE id = $1 AND status <> 'resolved' RETURNING id, status`, [id, status]);
  return r[0] || null;
}

export async function listJobs(limit = 20) {
  return q(`SELECT id, type, status, result, last_error, requested_by, created_at, started_at, finished_at FROM seo_jobs ORDER BY id DESC LIMIT $1`, [limit]);
}

// One job of each type at a time: a click while one is queued/running returns that job.
export async function enqueueJob(type, actor) {
  const existing = await q(`SELECT id, status FROM seo_jobs WHERE type=$1 AND status IN ('queued','running') AND created_at > now() - interval '2 hours' ORDER BY id DESC LIMIT 1`, [type]);
  if (existing[0]) return { job: existing[0], created: false };
  const r = await q(`INSERT INTO seo_jobs (type, status, requested_by) VALUES ($1,'queued',$2) RETURNING id, status`, [type, actor]);
  return { job: r[0], created: true };
}

export async function listArticles() {
  return q(`SELECT id, slug, title, kind, target_keyword, status, source, scheduled_for, quality_score, last_error,
                   coalesce((quality_report->>'critical_count')::int, 0) AS critical,
                   coalesce((quality_report->>'warn_count')::int, 0) AS warnings, updated_at
              FROM seo_articles ORDER BY CASE status WHEN 'awaiting_approval' THEN 0 WHEN 'needs_revision' THEN 1 ELSE 2 END, updated_at DESC LIMIT 200`);
}

export async function getSetting(key, fallback) {
  const r = await q('SELECT value FROM seo_settings WHERE key = $1', [key]);
  return r[0] ? r[0].value : fallback;
}

// The BrightLocal development key allows 1000 requests in total, then it is
// disabled. Nothing may call BrightLocal unless this budget says there is room.
export const BRIGHTLOCAL_DEFAULT = { limit: 1000, used: 0, reserve: 100 };
// Search Console credentials live in GitHub (where the importer runs), not in
// Vercel, so "connected" is judged by a successful import as well as by env vars.
export async function searchConsoleStatus() {
  const env = !!(process.env.GSC_SERVICE_ACCOUNT_JSON || (process.env.GSC_CLIENT_ID && process.env.GSC_CLIENT_SECRET && process.env.GSC_REFRESH_TOKEN));
  const r = await q(`SELECT finished_at, result FROM seo_jobs WHERE type = 'gsc_import' AND status = 'succeeded' ORDER BY id DESC LIMIT 1`);
  const last = r[0] || null;
  return { connected: env || !!last, via_env: env, last_import: last ? { finished_at: last.finished_at, result: last.result } : null };
}

export async function brightlocalBudget() {
  const v = await getSetting('brightlocal_budget', BRIGHTLOCAL_DEFAULT);
  return { ...BRIGHTLOCAL_DEFAULT, ...v, remaining: Math.max(0, (v.limit ?? 1000) - (v.used ?? 0)) };
}

const WORKFLOWS = { audit: 'seo-audit.yml', gsc_import: 'seo-gsc-import.yml', draft: 'seo-draft.yml' };

export async function dispatchWorkflow(type, jobId) {
  const file = WORKFLOWS[type];
  if (!file) return { dispatched: false, reason: 'no workflow for this job type' };
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { dispatched: false, reason: 'GITHUB_DISPATCH_TOKEN is not set' };
  const repo = process.env.GITHUB_REPO || 'Removals-Compared/medway-kent-removals-rochester';
  const ref = process.env.SEO_WORKFLOW_REF || 'main';
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'mkr-seo' },
    body: JSON.stringify({ ref, inputs: { job_id: String(jobId) } }),
  });
  if (r.status === 204) return { dispatched: true };
  return { dispatched: false, reason: `GitHub returned ${r.status}` };
}

// ── Search Console data ─────────────────────────────────────
// All windows end on the newest date we hold, so "last 28 days" never includes
// days Google has not published yet.
async function latestDate() {
  const r = await q(`SELECT to_char(max(date), 'YYYY-MM-DD') AS d FROM seo_search_metrics`);
  return r[0] && r[0].d ? r[0].d : null;
}

export async function opportunityData() {
  const end = await latestDate();
  if (!end) return null;
  const [rows, cur, prev, sitePages, ignored] = await Promise.all([
    q(`SELECT query, page, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions,
              round(sum(position * impressions) / nullif(sum(impressions), 0), 2) AS position
         FROM seo_search_metrics WHERE date BETWEEN ($1::date - 27) AND $1::date
        GROUP BY query, page HAVING sum(impressions) > 0`, [end]),
    q(`SELECT page, sum(clicks)::int AS clicks FROM seo_search_metrics WHERE date BETWEEN ($1::date - 27) AND $1::date AND page <> '' GROUP BY page`, [end]),
    q(`SELECT page, sum(clicks)::int AS clicks FROM seo_search_metrics WHERE date BETWEEN ($1::date - 55) AND ($1::date - 28) AND page <> '' GROUP BY page`, [end]),
    q(`SELECT url, path, page_type, title FROM seo_pages`),
    q(`SELECT lower(query) AS query FROM seo_keywords WHERE status = 'ignored'`),
  ]);
  return { end, rows, pageTotals: { cur, prev }, sitePages, ignored: new Set(ignored.map((r) => r.query)) };
}

export async function setQueryStatus(query, status) {
  if (!['new', 'targeted', 'ignored'].includes(status)) throw new Error('bad status');
  const r = await q(
    `INSERT INTO seo_keywords (query, source, status) VALUES ($1, 'gsc', $2)
     ON CONFLICT (query) DO UPDATE SET status = EXCLUDED.status, updated_at = now() RETURNING query, status`,
    [String(query).trim().toLowerCase().slice(0, 300), status]);
  return r[0];
}

export async function reportData() {
  const end = await latestDate();
  if (!end) return { has_data: false };
  const totals = async (a, b) => (await q(
    `SELECT coalesce(sum(clicks),0)::int AS clicks, coalesce(sum(impressions),0)::int AS impressions,
            round(sum(position * impressions) / nullif(sum(impressions), 0), 1) AS position
       FROM seo_search_metrics WHERE date BETWEEN ($1::date - $2::int) AND ($1::date - $3::int)`, [end, a, b]))[0];
  const [cur, prev, daily, topQueries, topPages, first, lastJob] = await Promise.all([
    totals(27, 0), totals(55, 28),
    q(`SELECT to_char(date, 'YYYY-MM-DD') AS date, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions
         FROM seo_search_metrics WHERE date BETWEEN ($1::date - 27) AND $1::date GROUP BY date ORDER BY date`, [end]),
    q(`SELECT query, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions,
              round(sum(position * impressions) / nullif(sum(impressions), 0), 1) AS position
         FROM seo_search_metrics WHERE date BETWEEN ($1::date - 27) AND $1::date
        GROUP BY query ORDER BY clicks DESC, impressions DESC LIMIT 10`, [end]),
    q(`SELECT page, sum(clicks)::int AS clicks, sum(impressions)::int AS impressions,
              round(sum(position * impressions) / nullif(sum(impressions), 0), 1) AS position
         FROM seo_search_metrics WHERE date BETWEEN ($1::date - 27) AND $1::date AND page <> ''
        GROUP BY page ORDER BY clicks DESC, impressions DESC LIMIT 10`, [end]),
    q(`SELECT to_char(min(date), 'YYYY-MM-DD') AS d FROM seo_search_metrics`),
    q(`SELECT id, status, result, finished_at FROM seo_jobs WHERE type = 'gsc_import' ORDER BY id DESC LIMIT 1`),
  ]);
  let leads = null;
  try {
    leads = await q(`SELECT coalesce(source, 'not answered') AS source, count(*)::int AS n FROM quote_requests
                      WHERE created_at > now() - interval '28 days' AND status IS DISTINCT FROM 'deleted' GROUP BY 1 ORDER BY n DESC`);
  } catch { /* source column not present */ }
  return { has_data: true, end, since: first[0] && first[0].d, current: cur, previous: prev, daily, top_queries: topQueries, top_pages: topPages, leads_by_source: leads, last_import: lastJob[0] || null };
}

// ═══════════════════════════════════════════════════════════
//  Articles: drafts, edits, approval
// ═══════════════════════════════════════════════════════════
const DRAFTS_PER_DAY = 20;
const root = () => process.cwd();
function readRepo(file) {
  for (const base of [root(), path.join(root(), '..'), path.join(root(), '../..')]) {
    try { return fs.readFileSync(path.join(base, file), 'utf8'); } catch { /* try next */ }
  }
  throw new Error(`Cannot read ${file} on the server`);
}

async function qualityContext(articleId) {
  const pricing = readRepo('pricing.md');
  const facts = JSON.parse(readRepo('seo/business-facts.json'));
  const [pages, slugs] = await Promise.all([
    q(`SELECT path FROM seo_pages`),
    q(`SELECT slug FROM seo_articles WHERE id <> $1`, [articleId]),
  ]);
  const existingSlugs = new Set(slugs.map((r) => r.slug));
  for (const p of pages) { const last = p.path.split('/').pop(); if (last) existingSlugs.add(last); }
  return { allowedAmounts: allowedAmountsFrom(pricing, facts.allowed_extra_amounts || []), sitePaths: new Set(pages.map((r) => r.path)), existingSlugs, corpus: [] };
}

export async function getArticle(id) {
  const a = (await q(`SELECT * FROM seo_articles WHERE id = $1`, [id]))[0];
  if (!a) return null;
  const [revisions, approvals] = await Promise.all([
    q(`SELECT id, version, title, meta_description, content, meta, content_hash, created_by, created_at FROM seo_article_revisions WHERE article_id = $1 ORDER BY version DESC`, [id]),
    q(`SELECT id, revision_id, decision, reviewer, reason, decided_at FROM seo_approvals WHERE article_id = $1 ORDER BY id DESC`, [id]),
  ]);
  return { article: a, revisions, approvals };
}

export async function createDraftRequest({ keyword, kind = 'post', notes = '', evidence = null }, actor) {
  keyword = String(keyword || '').trim().slice(0, 140);
  if (keyword.length < 3) throw Object.assign(new Error('Enter the search or topic this article is for'), { status: 400 });
  const recent = (await q(`SELECT count(*)::int AS n FROM seo_jobs WHERE type = 'draft' AND created_at > now() - interval '24 hours'`))[0].n;
  if (recent >= DRAFTS_PER_DAY) throw Object.assign(new Error(`Draft limit reached (${DRAFTS_PER_DAY} a day) to keep AI costs predictable. Try again tomorrow.`), { status: 429 });
  const busy = (await q(`SELECT count(*)::int AS n FROM seo_jobs WHERE type = 'draft' AND status IN ('queued','running') AND created_at > now() - interval '2 hours'`))[0].n;
  if (busy >= 3) throw Object.assign(new Error('Three drafts are already being written. Wait for one to finish.'), { status: 429 });
  let slug = slugify(keyword) || 'draft';
  for (let i = 2; (await q(`SELECT 1 FROM seo_articles WHERE slug = $1`, [slug])).length; i++) slug = `${slugify(keyword)}-${i}`.slice(0, 80);
  const art = (await q(
    `INSERT INTO seo_articles (slug, title, kind, target_keyword, status, source) VALUES ($1,$2,'post',$3,'planned',$4) RETURNING id, slug`,
    [slug, keyword, keyword, evidence ? 'opportunity' : 'manual']))[0];
  const job = (await q(
    `INSERT INTO seo_jobs (type, status, requested_by, payload) VALUES ('draft','queued',$1,$2::jsonb) RETURNING id, status`,
    [actor, JSON.stringify({ article_id: art.id, keyword, kind: 'post', notes: String(notes).slice(0, 1000), evidence })]))[0];
  await logSeo(actor, 'draft_requested', `"${keyword}"`, art.id);
  return { article: art, job };
}

export async function redraft(articleId, actor) {
  const a = (await q(`SELECT id, title, target_keyword, status FROM seo_articles WHERE id = $1`, [articleId]))[0];
  if (!a) throw Object.assign(new Error('Article not found'), { status: 404 });
  if (['publishing', 'published', 'archived'].includes(a.status)) throw Object.assign(new Error(`A ${a.status} article cannot be redrafted`), { status: 409 });
  const recent = (await q(`SELECT count(*)::int AS n FROM seo_jobs WHERE type = 'draft' AND created_at > now() - interval '24 hours'`))[0].n;
  if (recent >= DRAFTS_PER_DAY) throw Object.assign(new Error(`Draft limit reached (${DRAFTS_PER_DAY} a day).`), { status: 429 });
  const job = (await q(
    `INSERT INTO seo_jobs (type, status, requested_by, payload) VALUES ('draft','queued',$1,$2::jsonb) RETURNING id, status`,
    [actor, JSON.stringify({ article_id: a.id, keyword: a.target_keyword || a.title, kind: 'post', notes: 'Redraft: write a fuller, more useful version.' })]))[0];
  await logSeo(actor, 'redraft_requested', a.title, a.id);
  return { article: a, job };
}

function reportFor(result, rev, acknowledged) {
  return { ...result, revision_id: rev.id, content_hash: rev.content_hash, acknowledged, checked_at: new Date().toISOString() };
}
const statusFor = (critical) => (critical > 0 ? 'needs_revision' : 'awaiting_approval');

// Saving an edit never changes an old revision: it adds a new one, which has to be approved again.
export async function saveRevision(articleId, { title, meta_description, content, slug }, actor) {
  const got = await getArticle(articleId);
  if (!got) throw Object.assign(new Error('Article not found'), { status: 404 });
  const { article, revisions } = got;
  if (['publishing', 'archived'].includes(article.status)) throw Object.assign(new Error(`An article that is ${article.status} cannot be edited`), { status: 409 });
  const prev = revisions[0];
  title = String(title ?? '').trim(); meta_description = String(meta_description ?? '').trim(); content = String(content ?? '').trim();
  slug = slugify(slug || (prev && prev.meta && prev.meta.slug) || article.slug);
  if (!title || !content) throw Object.assign(new Error('Title and text are required'), { status: 400 });
  if (content.length > 200000) throw Object.assign(new Error('The text is too long'), { status: 400 });
  const meta = { ...((prev && prev.meta) || {}), slug };
  const version = (prev ? prev.version : 0) + 1;
  const rev = (await q(
    `INSERT INTO seo_article_revisions (article_id, version, title, meta_description, content, meta, created_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id, content_hash`,
    [articleId, version, title, meta_description, content, JSON.stringify(meta), actor]))[0];
  const ctx = await qualityContext(articleId);
  const result = checkDraft({ title, meta_description, slug, content, keyword: meta.keyword || article.target_keyword || '', hasImage: !!meta.image_id, claims_to_verify: meta.claims_to_verify || [] }, ctx);
  const report = reportFor(result, rev, []);
  const slugFree = !ctx.existingSlugs.has(slug);
  // Moving back to awaiting_approval / needs_revision also withdraws any earlier approval, because the gate only honours an approval of the CURRENT revision.
  await q(
    `UPDATE seo_articles SET current_revision_id=$2, title=$3, slug=CASE WHEN $4::boolean THEN $5 ELSE slug END, quality_score=$6, quality_report=$7::jsonb, status=$8, last_error=NULL WHERE id=$1`,
    [articleId, rev.id, title, slugFree, slug, result.score, JSON.stringify(report), statusFor(result.critical_count)]);
  await logSeo(actor, 'revision_saved', `version ${version}: ${result.critical_count} critical, ${result.warn_count} warnings`, articleId);
  return { revision_id: rev.id, version, status: statusFor(result.critical_count), quality: report };
}

async function recheck(article, revision, acknowledged) {
  const ctx = await qualityContext(article.id);
  const meta = revision.meta || {};
  const ackKeys = new Set(acknowledged.filter((a) => a.content_hash === revision.content_hash).map((a) => a.key));
  const result = checkDraft({ title: revision.title, meta_description: revision.meta_description || '', slug: meta.slug || article.slug, content: revision.content, keyword: meta.keyword || article.target_keyword || '', hasImage: !!meta.image_id, claims_to_verify: meta.claims_to_verify || [] }, { ...ctx, acknowledged: ackKeys });
  return reportFor(result, revision, acknowledged);
}

export async function acknowledge(articleId, key, actor) {
  const got = await getArticle(articleId);
  if (!got) throw Object.assign(new Error('Article not found'), { status: 404 });
  const { article, revisions } = got;
  const cur = revisions.find((r) => r.id === article.current_revision_id);
  if (!cur) throw Object.assign(new Error('No current version'), { status: 409 });
  const report0 = await recheck(article, cur, (article.quality_report && article.quality_report.acknowledged) || []);
  const f = report0.findings.find((x) => x.key === key);
  if (!f) throw Object.assign(new Error('That finding is not in the current version'), { status: 404 });
  if (!ACKNOWLEDGEABLE.has(f.code)) throw Object.assign(new Error('This kind of problem has to be fixed in the text, it cannot be confirmed'), { status: 409 });
  if (f.severity === 'acknowledged') return { quality: report0 };
  const acknowledged = [...report0.acknowledged, { key, code: f.code, detail: f.detail, by: actor, at: new Date().toISOString(), content_hash: cur.content_hash }];
  const report = await recheck(article, cur, acknowledged);
  const next = ['needs_revision', 'awaiting_approval'].includes(article.status) ? statusFor(report.critical_count) : article.status;
  await q(`UPDATE seo_articles SET quality_report=$2::jsonb, quality_score=$3, status=$4 WHERE id=$1`, [articleId, JSON.stringify(report), report.score, next]);
  await logSeo(actor, 'finding_acknowledged', `${f.code}: ${f.detail}`, articleId);
  return { quality: report, status: next };
}

export async function decide(articleId, revisionId, decision, reason, actor) {
  if (!['approve', 'reject', 'request_changes'].includes(decision)) throw Object.assign(new Error('Unknown decision'), { status: 400 });
  reason = String(reason || '').trim().slice(0, 1000);
  if (decision !== 'approve' && !reason) throw Object.assign(new Error('Add a reason so the next draft can fix it'), { status: 400 });
  const got = await getArticle(articleId);
  if (!got) throw Object.assign(new Error('Article not found'), { status: 404 });
  const { article, revisions } = got;
  if (Number(revisionId) !== Number(article.current_revision_id)) throw Object.assign(new Error('That is not the current version. Reload and review the latest one.'), { status: 409 });
  if (article.status !== 'awaiting_approval' && !(decision !== 'approve' && article.status === 'needs_revision')) {
    throw Object.assign(new Error(`This article is ${article.status.replace(/_/g, ' ')}, so it cannot be ${decision === 'approve' ? 'approved' : 'decided on'} now`), { status: 409 });
  }
  const cur = revisions.find((r) => r.id === article.current_revision_id);
  const report = await recheck(article, cur, (article.quality_report && article.quality_report.acknowledged) || []);
  if (decision === 'approve' && report.critical_count > 0) {
    await q(`UPDATE seo_articles SET quality_report=$2::jsonb, status='needs_revision' WHERE id=$1`, [articleId, JSON.stringify(report)]);
    throw Object.assign(new Error(`${report.critical_count} serious problem(s) must be fixed or confirmed before this can be approved`), { status: 409, findings: report.findings.filter((f) => f.severity === 'critical') });
  }
  await q(`UPDATE seo_articles SET quality_report=$2::jsonb, quality_score=$3 WHERE id=$1`, [articleId, JSON.stringify(report), report.score]);
  await q(
    `INSERT INTO seo_approvals (article_id, revision_id, decision, reviewer, reviewer_role, reason) VALUES ($1,$2,$3,$4,'admin',$5)`,
    [articleId, revisionId, decision, actor, reason || null]);
  const next = { approve: 'approved', reject: 'rejected', request_changes: 'needs_revision' }[decision];
  try { await q(`UPDATE seo_articles SET status=$2 WHERE id=$1`, [articleId, next]); }
  catch (e) { throw Object.assign(new Error(String(e.message).replace(/^.*?:\s*/, '')), { status: 409 }); }
  await logSeo(actor, `article_${next}`, `version ${cur.version}${reason ? ': ' + reason : ''}`, articleId);
  return { status: next, version: cur.version };
}

export async function archiveArticle(articleId, actor) {
  const r = await q(`UPDATE seo_articles SET status='archived' WHERE id=$1 AND status NOT IN ('publishing') RETURNING id, status`, [articleId]);
  if (!r[0]) throw Object.assign(new Error('Article not found or being published'), { status: 409 });
  await logSeo(actor, 'article_archived', '', articleId);
  return r[0];
}

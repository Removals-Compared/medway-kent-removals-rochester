// ════════════════════════════════════════════════════════════
//  SEO module: database reads/writes for api/admin/seo.mjs.
//  Tables are created by admin/SEO-SCHEMA.sql (run once in Neon).
// ════════════════════════════════════════════════════════════
import { q } from './_sql.mjs';

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
  return q(`SELECT id, slug, title, kind, target_keyword, status, source, scheduled_for, quality_score, updated_at FROM seo_articles ORDER BY updated_at DESC LIMIT 200`);
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

const WORKFLOWS = { audit: 'seo-audit.yml', gsc_import: 'seo-gsc-import.yml' };

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

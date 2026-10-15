// ════════════════════════════════════════════════════════════
//  SEO audit runner.  Read-only crawl of this site.
//
//    node scripts/seo-audit.mjs                      live crawl, print summary
//    node scripts/seo-audit.mjs --out audit.json     also save the full report
//    node scripts/seo-audit.mjs --root .             audit local files instead (no network)
//    node scripts/seo-audit.mjs --db [--job 12]      save results to Neon (needs DATABASE_URL
//                                                    and admin/SEO-SCHEMA.sql already run)
//
//  Run by .github/workflows/seo-audit.yml (weekly and on demand).
//  It never changes the website. Fixes are suggestions the owner applies.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { SITE, toPath, parsePage, analyse, summarise } from '../seo/lib/seo-audit-lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const val = (n) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : null; };

const ROOT = val('root') ? path.resolve(val('root')) : null;
const UA = 'MKR-SEO-Audit/1.0 (+own-site check)';
const CONCURRENCY = 4;
const NON_HTML = /\.(txt|md|xml|json)$/i;

// ── Fetchers: same shape for live site and local files ──────
async function liveGet(p, { wantBody = true } = {}) {
  const r = await fetch(SITE + (p === '/' ? '/' : p), {
    redirect: 'manual',
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  const ct = r.headers.get('content-type') || '';
  let body = '';
  if (wantBody && r.status === 200 && /html|text|xml/i.test(ct)) body = await r.text();
  else await r.body?.cancel();
  return { status: r.status, location: r.headers.get('location') || '', body };
}

function fileFor(p) {
  const rel = p === '/' ? 'index' : p.slice(1);
  for (const f of [rel + '.html', path.join(rel, 'index.html'), rel]) {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}
async function fileGet(p) {
  const f = fileFor(p);
  if (!f) return { status: 404, location: '', body: '' };
  return { status: 200, location: '', body: fs.readFileSync(f, 'utf8') };
}
const get = ROOT ? fileGet : liveGet;

async function pool(items, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
      if (!ROOT) await new Promise((r) => setTimeout(r, 60)); // be gentle with our own site
    }
  }));
  return out;
}

// ── Crawl ───────────────────────────────────────────────────
async function crawl() {
  const sm = await get('/sitemap.xml');
  if (sm.status !== 200) throw new Error(`sitemap.xml returned ${sm.status}`);
  const sitemap = [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => {
    const url = m[1];
    return { url, path: toPath(url), nonHtml: NON_HTML.test(url) };
  });
  const robots = (await get('/robots.txt')).body || '';

  const status = {};
  const redirects = {};
  const pages = [];

  await pool(sitemap.filter((s) => !s.nonHtml), async (s) => {
    const r = await get(s.path);
    status[s.path] = r.status;
    if (r.location) redirects[s.path] = r.location;
    if (r.status === 200 && r.body) pages.push(parsePage(r.body, s.url));
  });
  // non-HTML sitemap entries: just confirm they exist
  await pool(sitemap.filter((s) => s.nonHtml), async (s) => {
    const r = await get(s.path, { wantBody: false });
    status[s.path] = r.status;
  });

  // Every internal link target not already checked (e.g. pages missing from the sitemap)
  const extra = new Set();
  for (const p of pages) for (const t of p.all_links) if (!(t in status)) extra.add(t);
  const extraPages = [];
  await pool([...extra], async (t) => {
    const r = await get(t);
    status[t] = r.status;
    if (r.location) redirects[t] = r.location;
    // a page outside the sitemap that is a real HTML page: audit it too
    if (r.status === 200 && r.body && /<html|<!doctype/i.test(r.body)) extraPages.push(parsePage(r.body, SITE + t));
  });
  pages.push(...extraPages);

  pages.sort((a, b) => a.path.localeCompare(b.path));
  return { pages, ctx: { site: SITE, sitemap, robotsTxt: robots, status, redirects } };
}

// ── Output shaping ──────────────────────────────────────────
function slim(p, inSitemap) {
  return {
    url: p.url, path: p.path, page_type: p.page_type, status_code: 200,
    title: p.title, meta_description: p.meta_description, canonical: p.canonical, robots: p.robots,
    h1: p.h1, h1_count: p.h1_count, word_count: p.word_count,
    images: p.images, images_missing_alt: p.images_missing_alt,
    links_out: p.links_out, links_in: p.links_in,
    in_sitemap: inSitemap, schema_types: p.schema_types,
  };
}

// ── Database (optional) ─────────────────────────────────────
async function saveToDb(report, jobId) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const q = (text, params = []) => sql.query(text, params);
  try { await q('SELECT 1 FROM seo_jobs LIMIT 1'); }
  catch { throw new Error('SEO tables are missing. Run admin/SEO-SCHEMA.sql in the Neon SQL editor first.'); }

  let id = jobId;
  if (id) await q(`UPDATE seo_jobs SET status='running', started_at=now(), attempts=attempts+1 WHERE id=$1`, [id]);
  else id = (await q(`INSERT INTO seo_jobs (type,status,started_at,attempts,requested_by) VALUES ('audit','running',now(),1,$1) RETURNING id`, [process.env.GITHUB_ACTIONS ? 'github-action' : 'cli']))[0].id;

  try {
    await q(`
      INSERT INTO seo_pages (url,path,page_type,status_code,title,meta_description,canonical,robots,h1,h1_count,word_count,images,images_missing_alt,links_out,links_in,in_sitemap,schema_types,last_crawled)
      SELECT x.url,x.path,x.page_type,x.status_code,x.title,x.meta_description,x.canonical,x.robots,x.h1,x.h1_count,x.word_count,x.images,x.images_missing_alt,x.links_out,x.links_in,x.in_sitemap,
             COALESCE(ARRAY(SELECT jsonb_array_elements_text(x.schema_types)), '{}'), now()
        FROM jsonb_to_recordset($1::jsonb) AS x(url text,path text,page_type text,status_code int,title text,meta_description text,canonical text,robots text,h1 text,h1_count int,word_count int,images int,images_missing_alt int,links_out int,links_in int,in_sitemap boolean,schema_types jsonb)
      ON CONFLICT (url) DO UPDATE SET path=EXCLUDED.path,page_type=EXCLUDED.page_type,status_code=EXCLUDED.status_code,title=EXCLUDED.title,
        meta_description=EXCLUDED.meta_description,canonical=EXCLUDED.canonical,robots=EXCLUDED.robots,h1=EXCLUDED.h1,h1_count=EXCLUDED.h1_count,
        word_count=EXCLUDED.word_count,images=EXCLUDED.images,images_missing_alt=EXCLUDED.images_missing_alt,links_out=EXCLUDED.links_out,
        links_in=EXCLUDED.links_in,in_sitemap=EXCLUDED.in_sitemap,schema_types=EXCLUDED.schema_types,last_crawled=now()`,
      [JSON.stringify(report.pages)]);
    // pages that no longer exist in the crawl
    await q(`DELETE FROM seo_pages WHERE last_crawled < now() - interval '1 day' AND url <> ALL($1::text[])`, [report.pages.map((p) => p.url)]);

    await q(`
      INSERT INTO seo_audit_issues (url,type,issue_key,severity,detail,run_id,status,first_seen,last_seen)
      SELECT x.url,x.type,x.issue_key,x.severity,x.detail,$2,'open',now(),now()
        FROM jsonb_to_recordset($1::jsonb) AS x(url text,type text,issue_key text,severity text,detail text)
      ON CONFLICT (url,type,issue_key) DO UPDATE SET severity=EXCLUDED.severity, detail=EXCLUDED.detail, run_id=EXCLUDED.run_id, last_seen=now(),
        status = CASE WHEN seo_audit_issues.status='resolved' THEN 'open' ELSE seo_audit_issues.status END`,
      [JSON.stringify(report.issues), id]);
    // anything open that this run did not see is fixed
    await q(`UPDATE seo_audit_issues SET status='resolved' WHERE status='open' AND run_id IS DISTINCT FROM $1`, [id]);

    await q(`UPDATE seo_jobs SET status='succeeded', finished_at=now(), result=$2::jsonb WHERE id=$1`, [id, JSON.stringify(report.summary)]);
    await q(`INSERT INTO seo_activity (actor,action,detail) VALUES ($1,'audit_completed',$2)`, ['audit-runner', `${report.summary.pages} pages, ${report.summary.issues} issues`]);
  } catch (e) {
    await q(`UPDATE seo_jobs SET status='failed', finished_at=now(), last_error=$2 WHERE id=$1`, [id, String(e.message || e).slice(0, 500)]).catch(() => {});
    throw e;
  }
  return id;
}

// ── Main ────────────────────────────────────────────────────
const t0 = Date.now();
const { pages, ctx } = await crawl();
const issues = analyse(pages, ctx);
const inSm = new Set(ctx.sitemap.map((s) => s.path));
const report = {
  generated_at: new Date().toISOString(),
  mode: ROOT ? 'files' : 'live',
  site: SITE,
  pages: pages.map((p) => slim(p, inSm.has(p.path))),
  issues,
  summary: summarise(pages, issues),
};

if (val('out')) fs.writeFileSync(val('out'), JSON.stringify(report, null, 2));
console.log(`Audited ${report.summary.pages} pages in ${Math.round((Date.now() - t0) / 1000)}s (${report.mode})`);
console.log('Issues:', report.summary.by_severity);
console.log('By type:', report.summary.by_type);

if (flag('db')) {
  const id = await saveToDb(report, val('job') ? Number(val('job')) : null);
  console.log(`Saved to database (job ${id}).`);
}

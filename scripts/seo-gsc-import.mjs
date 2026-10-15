// ════════════════════════════════════════════════════════════
//  Search Console import. Read-only against Google; writes only seo_* tables.
//
//    node scripts/seo-gsc-import.mjs --db                 incremental (since last import)
//    node scripts/seo-gsc-import.mjs --db --days 90       backfill the last 90 days
//    node scripts/seo-gsc-import.mjs --db --job 12        record progress on a queued job
//    node scripts/seo-gsc-import.mjs --out rows.json      fetch and save, no database
//
//  Needs GSC_* env vars (see seo-gsc-lib.mjs) and, with --db, DATABASE_URL.
//  Run by .github/workflows/seo-gsc-import.yml (weekly and on demand).
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import { authMode, getAccessToken, listSites, pickSite, dateWindow, fetchRows, toMetricRows } from './seo-gsc-lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const val = (n) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : null; };

let sql = null;
async function db() {
  if (sql) return sql;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const { neon } = await import('@neondatabase/serverless');
  const c = neon(process.env.DATABASE_URL);
  sql = (text, params = []) => c.query(text, params);
  try { await sql('SELECT 1 FROM seo_search_metrics LIMIT 1'); }
  catch { throw new Error('SEO tables are missing. Run admin/SEO-SCHEMA.sql in the Neon SQL editor first.'); }
  return sql;
}

async function startJob(jobId) {
  const q = await db();
  if (jobId) { await q(`UPDATE seo_jobs SET status='running', started_at=now(), attempts=attempts+1 WHERE id=$1`, [jobId]); return jobId; }
  return (await q(`INSERT INTO seo_jobs (type,status,started_at,attempts,requested_by) VALUES ('gsc_import','running',now(),1,$1) RETURNING id`, [process.env.GITHUB_ACTIONS ? 'github-action' : 'cli']))[0].id;
}

async function save(rows) {
  const q = await db();
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await q(`
      INSERT INTO seo_search_metrics (date, query, page, clicks, impressions, ctr, position)
      SELECT x.date, x.query, x.page, x.clicks, x.impressions, x.ctr, x.position
        FROM jsonb_to_recordset($1::jsonb) AS x(date date, query text, page text, clicks int, impressions int, ctr numeric, position numeric)
      ON CONFLICT (date, query, page) DO UPDATE SET clicks=EXCLUDED.clicks, impressions=EXCLUDED.impressions, ctr=EXCLUDED.ctr, position=EXCLUDED.position`,
      [JSON.stringify(rows.slice(i, i + BATCH))]);
  }
}

const mode = authMode();
if (!mode) {
  console.error('Search Console is not connected: set GSC_SERVICE_ACCOUNT_JSON (or GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REFRESH_TOKEN).');
  process.exit(2);
}

let jobId = null;
try {
  if (flag('db')) jobId = await startJob(val('job') ? Number(val('job')) : null);
  const token = await getAccessToken();
  const site = pickSite(await listSites(token), val('site') || process.env.GSC_SITE);

  let from = null;
  if (flag('db') && !val('days')) {
    const last = (await (await db())(`SELECT to_char(max(date) - 3, 'YYYY-MM-DD') AS d FROM seo_search_metrics`))[0];
    from = last && last.d ? last.d : null; // GSC revises the latest days, so re-read a few
  }
  const win = dateWindow({ days: Number(val('days')) || 90, from });
  console.log(`Property ${site}, ${win.start} to ${win.end} (${mode})`);

  const apiRows = await fetchRows(token, site, win);
  const rows = toMetricRows(apiRows);
  const clicks = rows.reduce((a, r) => a + r.clicks, 0);
  const impressions = rows.reduce((a, r) => a + r.impressions, 0);
  console.log(`Fetched ${rows.length} rows, ${clicks} clicks, ${impressions} impressions`);

  if (val('out')) fs.writeFileSync(val('out'), JSON.stringify({ site, ...win, rows }, null, 2));
  if (flag('db')) {
    await save(rows);
    const q = await db();
    const result = { site, start: win.start, end: win.end, rows: rows.length, clicks, impressions };
    await q(`UPDATE seo_jobs SET status='succeeded', finished_at=now(), result=$2::jsonb WHERE id=$1`, [jobId, JSON.stringify(result)]);
    await q(`INSERT INTO seo_activity (actor, action, detail) VALUES ('gsc-import','gsc_import_completed',$1)`, [`${rows.length} rows ${win.start} to ${win.end}`]);
    console.log(`Saved to database (job ${jobId}).`);
  }
} catch (e) {
  console.error('Import failed:', e.message);
  if (jobId && sql) await sql(`UPDATE seo_jobs SET status='failed', finished_at=now(), last_error=$2 WHERE id=$1`, [jobId, String(e.message).slice(0, 500)]).catch(() => {});
  process.exit(1);
}

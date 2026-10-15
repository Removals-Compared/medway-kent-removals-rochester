// ════════════════════════════════════════════════════════════
//  AI search visibility: automatic checks and one-off seeding.
//
//    node scripts/seo-ai-check.mjs --seed          load your BrightLocal snapshot(s), your
//                                                  15 Sep baseline and the list of searches
//    node scripts/seo-ai-check.mjs [--job 12]      ask each AI engine each search (a few
//                                                  times) and record whether you were
//                                                  named or cited
//
//  Engines run only when their key is present:
//    ANTHROPIC_API_KEY  -> Claude (with web search)       PERPLEXITY_API_KEY -> Perplexity
//    OPENAI_API_KEY     -> ChatGPT (with web search)
//  Google AI Overviews / AI Mode and Bing Copilot have no suitable API; enter them
//  by hand or via BrightLocal in the admin AI tab. Needs DATABASE_URL.
//
//  Spend is capped: at most MAX_CALLS_PER_RUN calls per run and MONTHLY_CAP per month.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { parseBrightLocalReport, reportRows, runChecks, CLIENTS, engineFrom, findCompetitors, ENGINES } from '../seo/lib/seo-ai-lib.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const val = (n) => { const i = args.indexOf('--' + n); return i > -1 ? args[i + 1] : null; };
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const MAX_CALLS_PER_RUN = Number(process.env.AI_MAX_CALLS_PER_RUN || 240);
const MONTHLY_CAP = Number(process.env.AI_MONTHLY_CAP || 600);
const SAMPLES = Math.max(1, Math.min(4, Number(process.env.AI_SAMPLES || 2)));
const MAX_QUERIES = 20;
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }
const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const q = (t, p = []) => sql.query(t, p);
try { await q('SELECT 1 FROM seo_ai_checks LIMIT 1'); }
catch { console.error('The AI tables are missing. Run the "MKR SEO Migrate" workflow first.'); process.exit(2); }

const today = new Date().toISOString().slice(0, 10);
// ── Seed ────────────────────────────────────────────────────
async function importSnapshot(file) {
  const rep = parseBrightLocalReport(fs.readFileSync(file, 'utf8'));
  for (const r of reportRows(rep)) {
    await q(`INSERT INTO seo_ai_bl_rows (report_date, kind, name, visibility, mention_rate, share_of_voice, avg_position, citations, coverage_rate, cited_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (report_date, kind, name) DO UPDATE SET visibility=EXCLUDED.visibility, mention_rate=EXCLUDED.mention_rate, share_of_voice=EXCLUDED.share_of_voice,
               avg_position=EXCLUDED.avg_position, citations=EXCLUDED.citations, coverage_rate=EXCLUDED.coverage_rate, cited_by=EXCLUDED.cited_by, imported_at=now()`,
      [r.report_date, r.kind, r.name, r.visibility, r.mention_rate, r.share_of_voice, r.avg_position, r.citations, r.coverage_rate, r.cited_by]);
  }
  console.log(`BrightLocal report ${rep.report_date}: visibility ${rep.summary.visibility}, ${rep.prompts.length} prompts, ${rep.competitors.length} competitors, ${rep.sources.length} sources`);
  return rep;
}

function baselineRows(md) {
  const sec = md.split(/^##\s+Baseline.*$/m)[1];
  if (!sec) return [];
  const date = (md.match(/^##\s+Baseline:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/m) || []);
  const MON = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
  const checked_on = date[1] ? `${date[3]}-${MON[date[2].toLowerCase()]}-${String(date[1]).padStart(2, '0')}` : '2026-09-15';
  const out = [];
  for (const line of sec.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l))) {
    const c = line.split('|').slice(1, -1).map((x) => x.trim());
    const query = c[1].replace(/\s*\((?:Bing|Google|ChatGPT|Perplexity)\)\s*$/i, '');
    [['perplexity', c[2]], ['chatgpt', c[3]], ['bing_local', c[4]]].forEach(([engine, cell]) => {
      if (!cell || /^n\/a|not tested/i.test(cell)) return;
      const result = /^CITED/i.test(cell) ? 'cited' : /^NAMED/i.test(cell) ? 'named' : /^(NOT named|ABSENT|not in pack)/i.test(cell) ? 'not_named' : null;
      if (!result) return;
      const pos = (cell.match(/ranked\s+(\d)/i) || cell.match(/NAMED\s+(\d)(?:st|nd|rd|th)/i) || cell.match(/\b(\d)(?:st|nd|rd|th)\b/i) || [])[1];
      out.push({ checked_on, query, engine, method: 'baseline', result, position: pos ? Number(pos) : null, competitors: findCompetitors(c[5] || ''), notes: (c[5] || '').slice(0, 400) });
    });
  }
  return out;
}

async function seed() {
  const dir = path.join(ROOT, 'seo', 'data');
  const reps = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^brightlocal-ai-visibility-.*\.txt$/.test(f)).sort() : [];
  let latest = null;
  for (const f of reps) latest = await importSnapshot(path.join(dir, f));

  const md = fs.readFileSync(path.join(ROOT, 'scripts', 'ai-visibility-log.md'), 'utf8');
  const base = baselineRows(md);
  let added = 0;
  for (const b of base) {
    const have = await q(`SELECT 1 FROM seo_ai_checks WHERE method='baseline' AND checked_on=$1 AND query=$2 AND engine=$3`, [b.checked_on, b.query, b.engine]);
    if (have.length) continue;
    await q(`INSERT INTO seo_ai_checks (checked_on, query, engine, method, result, position, competitors, notes, created_by) VALUES ($1,$2,$3,'baseline',$4,$5,$6,$7,'seed')`,
      [b.checked_on, b.query, b.engine, b.result, b.position, b.competitors, b.notes]);
    added++;
  }
  console.log(`Baseline: ${added} check(s) added (${base.length} in the log)`);

  // The searches to track: your baseline questions, BrightLocal's prompts, then your busiest real searches. Max 20.
  const wanted = [];
  const add = (query, source) => { const k = query.trim().toLowerCase(); if (k && !wanted.some((w) => w.query.toLowerCase() === k)) wanted.push({ query: query.trim(), source }); };
  [...new Set(base.map((b) => b.query))].forEach((x) => add(x, 'baseline'));
  (latest ? latest.prompts.map((p) => p.name) : []).forEach((x) => add(x, 'brightlocal'));
  const gsc = await q(`SELECT query, sum(impressions)::int AS n FROM seo_search_metrics WHERE date > (SELECT max(date) - 60 FROM seo_search_metrics) AND (query ILIKE '%remov%' OR query ILIKE '%man and van%' OR query ILIKE '%man with a van%') GROUP BY query ORDER BY n DESC LIMIT 12`).catch(() => []);
  gsc.forEach((r) => add(r.query, 'gsc'));
  const existing = (await q(`SELECT query FROM seo_ai_queries`)).map((r) => r.query.toLowerCase());
  let n = existing.length, qadded = 0;
  for (const w of wanted) {
    if (existing.includes(w.query.toLowerCase())) continue;
    if (n >= MAX_QUERIES) break;
    await q(`INSERT INTO seo_ai_queries (query, source) VALUES ($1,$2) ON CONFLICT (query) DO NOTHING`, [w.query, w.source]);
    n++; qadded++;
  }
  console.log(`Searches to track: ${qadded} added, ${n} in total (limit ${MAX_QUERIES})`);
  await q(`INSERT INTO seo_activity (actor, action, detail) VALUES ('seed','ai_seeded',$1)`, [`${reps.length} BrightLocal report(s), ${added} baseline checks, ${qadded} searches`]);
}

// ── Automatic checks ────────────────────────────────────────
async function check() {
  const engines = {};
  if (process.env.ANTHROPIC_API_KEY) engines.claude = CLIENTS.claude({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.SEO_MODEL || undefined });
  if (process.env.PERPLEXITY_API_KEY) engines.perplexity = CLIENTS.perplexity({ apiKey: process.env.PERPLEXITY_API_KEY, model: process.env.PERPLEXITY_MODEL || undefined });
  if (process.env.OPENAI_API_KEY) engines.chatgpt = CLIENTS.chatgpt({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || undefined });
  if (!Object.keys(engines).length) throw new Error('No engine has a key (ANTHROPIC_API_KEY, PERPLEXITY_API_KEY or OPENAI_API_KEY).');

  const queries = (await q(`SELECT query FROM seo_ai_queries WHERE active ORDER BY id LIMIT ${MAX_QUERIES}`)).map((r) => r.query);
  if (!queries.length) throw new Error('No searches to check. Run this workflow with "seed" first.');
  const planned = queries.length * Object.keys(engines).length * SAMPLES;
  const month = today.slice(0, 7);
  const usage = (await q(`SELECT value FROM seo_settings WHERE key='ai_check_usage'`))[0];
  const used = usage && usage.value.month === month ? Number(usage.value.calls) : 0;
  if (planned > MAX_CALLS_PER_RUN) throw new Error(`This run would make ${planned} AI calls, over the per-run limit of ${MAX_CALLS_PER_RUN}. Reduce the searches or AI_SAMPLES.`);
  if (used + planned > MONTHLY_CAP) throw new Error(`This run would take the month to ${used + planned} AI calls, over the monthly cap of ${MONTHLY_CAP} (used so far: ${used}).`);

  console.log(`Checking ${queries.length} searches on ${Object.keys(engines).map((e) => ENGINES[e]).join(', ')}, ${SAMPLES} answers each (${planned} calls; ${used} used this month)`);
  const competitorsRow = (await q(`SELECT value FROM seo_settings WHERE key='ai_competitors'`))[0];
  const out = await runChecks({ queries, engines, samples: SAMPLES, competitors: competitorsRow && competitorsRow.value.list ? competitorsRow.value.list : undefined, onProgress: (qq, e) => process.stdout.write('.') });
  console.log('');
  for (const r of out.rows) {
    await q(`INSERT INTO seo_ai_checks (checked_on, query, engine, method, result, position, samples, hits_named, hits_cited, competitors, cited_urls, excerpt, created_by)
             VALUES ($1,$2,$3,'auto',$4,$5,$6,$7,$8,$9,$10,$11,'ai-check')`,
      [today, r.query, r.engine, r.result, r.position, r.samples, r.hits_named, r.hits_cited, r.competitors, r.cited_urls, r.excerpt]);
  }
  await q(`INSERT INTO seo_settings (key, value) VALUES ('ai_check_usage', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [JSON.stringify({ month, calls: used + out.calls })]);

  const summary = {};
  for (const e of Object.keys(engines)) {
    const rows = out.rows.filter((r) => r.engine === e);
    summary[e] = out.errors[e] ? { error: out.errors[e] } : { searches: rows.length, named_or_cited: rows.filter((r) => r.result !== 'not_named').length, cited: rows.filter((r) => r.result === 'cited').length };
    console.log(`${ENGINES[e]}: ${out.errors[e] ? 'FAILED: ' + out.errors[e] : `named or cited in ${summary[e].named_or_cited} of ${rows.length} searches (cited ${summary[e].cited})`}`);
  }
  return { out, summary };
}

let jobId = Number(val('job')) || null;
let exitCode = 0;
try {
  if (flag('seed')) { await seed(); }
  else {
    if (jobId) await q(`UPDATE seo_jobs SET status='running', started_at=now(), attempts=attempts+1 WHERE id=$1`, [jobId]);
    else jobId = (await q(`INSERT INTO seo_jobs (type,status,started_at,attempts,requested_by) VALUES ('ai_check','running',now(),1,$1) RETURNING id`, [process.env.GITHUB_ACTIONS ? 'github-action' : 'cli']))[0].id;
    const { out, summary } = await check();
    const ok = out.rows.length > 0;
    await q(`UPDATE seo_jobs SET status=$2, finished_at=now(), result=$3::jsonb, last_error=$4 WHERE id=$1`, [jobId, ok ? 'succeeded' : 'failed', JSON.stringify({ calls: out.calls, summary }), ok ? null : Object.values(out.errors).join('; ').slice(0, 400)]);
    await q(`INSERT INTO seo_activity (actor, action, detail) VALUES ('ai-check','ai_check_completed',$1)`, [`${out.rows.length} results, ${out.calls} calls`]);
    if (!ok) exitCode = 1;
  }
} catch (e) {
  console.error('AI check failed:', e.message);
  if (jobId && !flag('seed')) await q(`UPDATE seo_jobs SET status='failed', finished_at=now(), last_error=$2 WHERE id=$1`, [jobId, String(e.message).slice(0, 500)]).catch(() => {});
  exitCode = 1;
}
process.exit(exitCode);

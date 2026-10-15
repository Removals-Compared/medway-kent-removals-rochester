// ════════════════════════════════════════════════════════════
//  Proposes audit fixes. It CHANGES NOTHING on the site: it only writes
//  proposals into seo_fixes for you to approve or reject in /admin/seo (Fixes).
//
//    node scripts/seo-fixes-propose.mjs            rule-based proposals + AI wording where a key exists
//    node scripts/seo-fixes-propose.mjs --no-ai    rule-based only
//
//  Needs DATABASE_URL (and ANTHROPIC_API_KEY for the AI wording).
//  Safety rules live in seo/lib/seo-fixes-lib.mjs: blog posts only for titles,
//  descriptions and links; busy pages are never proposed for editing.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { parsePage, toPath } from '../seo/lib/seo-audit-lib.mjs';
import { proposeTitles, proposeSitemap, proposeRelated, descriptionsNeeded, validateTitle, validateDescription, decode, isPost } from '../seo/lib/seo-fixes-lib.mjs';
import { makeClaude, parseJson, DEFAULT_MODEL } from '../seo/lib/seo-draft-lib.mjs';
import { allowedAmountsFrom } from '../seo/lib/seo-quality-lib.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://www.medwaykentremovals.co.uk';
const today = process.env.PROPOSE_DATE || new Date().toISOString().slice(0, 10);
// the time is part of the name so a repeat run on the same day can propose again (the database keeps one row per batch, page, kind and wording)
const batch = process.env.BATCH || `auto-${today}-${new Date().toISOString().slice(11, 16).replace(':', '')}`;
const useAi = !process.argv.includes('--no-ai') && !!process.env.ANTHROPIC_API_KEY;
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }
const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const q = (t, p = []) => sql.query(t, p);
try { await q('SELECT 1 FROM seo_fixes LIMIT 1'); } catch { console.error('The fixes table is missing. Run the "MKR SEO Migrate" workflow first.'); process.exit(2); }

// ── Read the site ──
const listHtml = (dir) => { try { return fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.html') && !f.endsWith('-block.html')).map((f) => path.join(dir, f)); } catch { return []; } };
const pages = [];
for (const f of [...listHtml('.'), ...listHtml('blog/posts')]) {
  const p = '/' + f.replace(/\.html$/, '').replace(/^index$/, '');
  const pagePath = p === '/' ? '/' : p;
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const parsed = parsePage(html, SITE + pagePath);
  pages.push({ path: pagePath, html, parsed, hasRelated: html.includes('<div class="related-posts">') });
}
const inbound = new Map();
for (const pg of pages) for (const t of pg.parsed.contextual_links) { if (!inbound.has(t)) inbound.set(t, new Set()); inbound.get(t).add(pg.path); }
const sitemapXml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const inSitemap = new Set([...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => toPath(m[1])));

// posts still waiting in the approval queue (an approved redraft replaces the whole page): leave them out.
// Rewrites that are already published are ordinary posts again and can be fixed like any other.
const queued = new Set((await q(`SELECT slug FROM seo_articles WHERE status IN ('planned','researching','drafting','quality_check','awaiting_approval','needs_revision','approved','publishing')`)).map((r) => '/blog/posts/' + r.slug));
const posts = pages.filter((p) => isPost(p.path) && !queued.has(p.path));

const proposals = [];
// 1. titles (rule) ...
const titleSet = proposeTitles(posts.map((p) => ({ path: p.path, title: p.parsed.title })));
proposals.push(...titleSet.rule);
// 2. sitemap
proposals.push(...proposeSitemap(pages.map((p) => ({ path: p.path, canonical: p.parsed.canonical ? toPath(p.parsed.canonical) : '', indexable: !/noindex/i.test(p.parsed.robots), inSitemap: inSitemap.has(p.path) })), { today }));
// 3. related links for weakly linked posts
proposals.push(...proposeRelated(posts.map((p) => ({ path: p.path, title: p.parsed.h1 || p.parsed.title, hasRelated: p.hasRelated, links: new Set(p.parsed.contextual_links), inbound: (inbound.get(p.path) || new Set()).size }))));

// 4. AI wording for titles that remain too long and for descriptions that are too long or too short
const plain = (h) => decode(h.replace(/<(script|style|nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const pageOf = (p) => pages.find((x) => x.path === p);
const skipped = [];
if (useAi) {
  const llm = makeClaude({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.SEO_MODEL || DEFAULT_MODEL });
  const allowed = allowedAmountsFrom(fs.readFileSync(path.join(ROOT, 'pricing.md'), 'utf8'));
  const RULES = 'UK English. No em dashes or en dashes. No prices. No awards, accreditations, years in business, review counts, guarantees or superlatives. Use ONLY what the page text says; never invent facts or places. Keep the page\'s main topic words. Plain, natural wording a customer would click.';
  const ask = async (kind, items) => {
    const out = [];
    for (let i = 0; i < items.length; i += 6) {
      const batchItems = items.slice(i, i + 6);
      const spec = kind === 'title'
        ? 'Write a new <title> tag for each page: 20 to 60 characters, no site name at the end. Return JSON {"items":[{"path":string,"title":string}]}'
        : 'Write a new meta description for each page: 100 to 155 characters, one or two short sentences that say what the page covers and why to read it. Return JSON {"items":[{"path":string,"description":string}]}';
      const user = `${spec}\n\n` + batchItems.map((it) => { const pg = pageOf(it.path); return `PATH: ${it.path}\nHEADING: ${pg.parsed.h1}\nCURRENT ${kind === 'title' ? 'TITLE' : 'DESCRIPTION'}: ${it.before}\nPAGE TEXT (start): ${plain(pg.html).slice(0, 1400)}`; }).join('\n\n---\n\n');
      let got = [];
      try { got = parseJson(await llm({ system: `You write search-result snippets for a UK removals company.\n${RULES}\nReply with ONE JSON object and nothing else.`, user, maxTokens: 3000 })).items || []; } catch (e) { skipped.push(`${kind} batch failed: ${e.message}`); }
      for (const it of batchItems) {
        // A page the model skipped in the batch is asked about on its own.
        if (!got.find((x) => x.path === it.path)) {
          const pg1 = pageOf(it.path);
          try {
            const one = parseJson(await llm({ system: `You write search-result snippets for a UK removals company.\n${RULES}\nReply with ONE JSON object and nothing else.`, user: `${spec}\n\nPATH: ${it.path}\nHEADING: ${pg1.parsed.h1}\nCURRENT ${kind === 'title' ? 'TITLE' : 'DESCRIPTION'}: ${it.before}\nPAGE TEXT (start): ${plain(pg1.html).slice(0, 1400)}`, maxTokens: 800 })).items || [];
            got = got.concat(one.filter((x) => x && x.path === it.path));
          } catch (e) { /* stays "no answer" */ }
        }
        const g = got.find((x) => x.path === it.path); let val = g && (kind === 'title' ? g.title : g.description);
        const check = (v) => (!v ? 'no answer' : (kind === 'title' ? validateTitle(v, it.before) : validateDescription(v, it.before, allowed)));
        let bad = check(val);
        // One second try when the wording is only the wrong length: show the model its own answer and the limit.
        if (bad && val && /^must be \d+ to \d+ characters/.test(bad)) {
          const [lo, hi] = bad.match(/\d+/g).slice(0, 2);
          try {
            const again = parseJson(await llm({ system: `You fix the length of search-result snippets for a UK removals company.\n${RULES}\nReply with ONE JSON object and nothing else.`, user: `This ${kind} is ${String(val).trim().length} characters. Rewrite it so it is between ${lo} and ${hi} characters (aim for ${Math.round((Number(lo) + Number(hi)) / 2) + 10}), keeping the meaning and using only facts already in it. Return JSON {"text": string}\n\n${val}`, maxTokens: 400 }));
            if (again && again.text) { val = String(again.text).trim(); bad = check(val); }
          } catch (e) { /* keep the original verdict */ }
        }
        if (bad) { skipped.push(`${it.path} (${kind}): ${bad}`); continue; }
        out.push({ path: it.path, kind: kind === 'title' ? 'title' : 'meta_description', before: it.before, after: String(val).trim(), source: 'ai',
          reason: kind === 'title'
            ? `The title is ${it.before.length} characters, so Google cuts it off. This is a ${String(val).trim().length}-character version on the same topic. The page heading is unchanged.`
            : it.before.length > 160 ? `The description is ${it.before.length} characters, so Google cuts it off. This ${String(val).trim().length}-character version only uses what the page says.` : `The description is only ${it.before.length} characters. This ${String(val).trim().length}-character version says what the page covers, using only what the page says.` });
      }
    }
    return out;
  };
  proposals.push(...await ask('title', titleSet.needAi));
  proposals.push(...await ask('description', descriptionsNeeded(posts.map((p) => ({ path: p.path, meta_description: p.parsed.meta_description })))));
}

// Tidy up: if an earlier run left two open proposals for the same page and kind (AI wording differs run to run),
// keep the first and reject the later ones. Related links are exempt. Touches only status='proposed'.
{
  const open = await q(`SELECT id, path, kind FROM seo_fixes WHERE status='proposed' AND kind <> 'related_link' ORDER BY id`);
  const seen = new Set(); const extra = [];
  for (const r of open) { const k = r.path + '|' + r.kind; if (seen.has(k)) extra.push(r.id); else seen.add(k); }
  if (extra.length) {
    await q(`UPDATE seo_fixes SET status='rejected', note='Alternative wording from a repeat run; the first proposal for this page was kept' WHERE id = ANY($1::bigint[]) AND status='proposed'`, [extra]);
    console.log(`Rejected ${extra.length} repeat alternative proposal(s).`);
  }
}

// ── Save (never duplicating something already proposed, rejected or applied) ──
const counts = {};
for (const f of proposals) {
  // one open proposal per page and kind (AI wording differs run to run, so match on path+kind, not the new text).
  // An applied fix does not count: a page still showing the problem was changed back (for example by a rewrite) and needs it again.
  // A rejected or skipped proposal is not repeated with the same wording.
  // related links are the exception: several different links may be proposed for one page
  const dup = f.kind === 'related_link'
    ? await q(`SELECT 1 FROM seo_fixes WHERE path=$1 AND kind=$2 AND after_text=$3 LIMIT 1`, [f.path, f.kind, f.after])
    : await q(`SELECT 1 FROM seo_fixes WHERE path=$1 AND kind=$2 AND (status IN ('proposed','approved') OR (status IN ('rejected','conflict') AND after_text=$3)) LIMIT 1`, [f.path, f.kind, f.after]);
  if (dup.length) { counts.duplicate = (counts.duplicate || 0) + 1; continue; }
  await q(`INSERT INTO seo_fixes (batch, path, kind, before_text, after_text, reason, source) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [batch, f.path, f.kind, f.before, f.after, f.reason, f.source]);
  counts[f.kind] = (counts[f.kind] || 0) + 1;
}
await q(`INSERT INTO seo_activity (actor, action, detail) VALUES ('fixes','fixes_proposed',$1)`, [JSON.stringify(counts)]);
console.log(`Batch ${batch}: proposals saved (nothing on the site was changed)`, counts);
if (skipped.length) { console.log(`${skipped.length} AI suggestion(s) were rejected by the safety checks:`); skipped.slice(0, 12).forEach((s) => console.log('  - ' + s)); }
if (!useAi) console.log('AI wording was skipped (no ANTHROPIC_API_KEY or --no-ai).');

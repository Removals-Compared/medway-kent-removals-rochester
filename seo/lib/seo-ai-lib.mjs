// ════════════════════════════════════════════════════════════
//  AI search visibility: pure logic (no database). Covers
//   * reading a pasted BrightLocal "Local AI Visibility" page,
//   * reading hand-entered / pasted check results,
//   * deciding whether an AI answer NAMES or CITES the business,
//   * thin clients for Claude (web search), Perplexity and ChatGPT (web search).
//  Nothing here promises citations: it only records what was seen.
// ════════════════════════════════════════════════════════════

export const OUR_DOMAIN = 'medwaykentremovals.co.uk';

export const ENGINES = {
  claude: 'Claude', perplexity: 'Perplexity', chatgpt: 'ChatGPT',
  google_aio: 'Google AI Overviews', google_ai_mode: 'Google AI Mode',
  bing_copilot: 'Bing Copilot', bing_local: 'Bing local pack', gemini: 'Gemini', other: 'Other',
};
export const RESULTS = ['cited', 'named', 'not_named', 'error'];

// Rivals already seen in your own checks and BrightLocal's report. Extend in the tab.
export const DEFAULT_COMPETITORS = [
  'Rubix Removals', 'Fontana Moving', 'SCS Removals', 'Foremans Removals', 'Road Runner Removals', 'Britannia Bearsbys',
  'Kent Movers', 'Bray & Son', 'Bravo UK Removals', 'Philip Marks Removals', 'AnyVan', 'Pyramid Removals', 'My Baggage',
];

// ── Reading a BrightLocal "Local AI Visibility" page (copy the whole page, paste it in) ──
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const isValue = (l) => /^(\d+(?:\.\d+)?%?|—|-|#\d+(?:\.\d+)?)$/.test(l);
const num = (s) => { const m = String(s).match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };

function between(lines, startRe, endRe) {
  const s = lines.findIndex((l) => startRe.test(l));
  if (s < 0) return [];
  let e = lines.length;
  for (let i = s + 1; i < lines.length; i++) if (endRe.test(lines[i])) { e = i; break; }
  return lines.slice(s + 1, e);
}

// rows are "a name line followed by `valueCount` value lines" (or, for sources, a final text line)
function rowsOf(section, headerEnd, valueCount, { lastIsText = false } = {}) {
  const at = section.findIndex((l) => headerEnd.test(l));
  const lines = at >= 0 ? section.slice(at + 1) : section;
  const rows = [];
  for (let i = 0; i < lines.length;) {
    const name = lines[i];
    if (/^Showing \d/.test(name)) break;
    const vals = lines.slice(i + 1, i + 1 + valueCount);
    const okVals = lastIsText
      ? vals.length === valueCount && vals.slice(0, -1).every(isValue)
      : vals.length === valueCount && vals.every(isValue);
    if (!isValue(name) && okVals) { rows.push({ name, vals }); i += 1 + valueCount; } else i++;
  }
  return rows;
}

export function parseBrightLocalReport(text) {
  const raw = String(text).replace(/\r/g, '');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const d = raw.match(/Last updated\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!d || !MONTHS[d[1].toLowerCase()]) throw new Error('This does not look like a BrightLocal Local AI Visibility page (no "Last updated" date).');
  const report_date = `${d[3]}-${String(MONTHS[d[1].toLowerCase()]).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}`;

  const after = (label) => { const i = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase()); return i >= 0 ? lines.slice(i + 1, i + 8).find(isValue) : null; };
  const summary = {
    visibility: num((raw.match(/\(Visibility Score\s+(\d+(?:\.\d+)?),/) || [])[1] ?? after('Local AI Visibility Score')), // the summary sentence is more precise than the rounded headline
    mention_rate: num(after('Mention rate')),
    share_of_voice: num((raw.match(/Share of Voice\s+(\d+(?:\.\d+)?)%/i) || [])[1] ?? after('Share of voice')),
    avg_position: num(after('Avg. position')),
  };
  if (summary.visibility == null) throw new Error('Could not find the visibility score on this page.');

  const platforms = [];
  const p = raw.match(/AI Mode mentioning you (\d+)% of the time vs (\d+)% on ChatGPT and (\d+)% in AI Overviews/i);
  if (p) platforms.push({ name: 'Google AI Mode', mention_rate: +p[1] }, { name: 'ChatGPT', mention_rate: +p[2] }, { name: 'Google AI Overview', mention_rate: +p[3] });

  const secP = between(lines, /^Prompts$/, /^Competitors$/);
  const secC = between(lines, /^Competitors$/, /^AI sources$/);
  const secS = between(lines, /^AI sources$/, /^\u0000$/);
  const prompts = rowsOf(secP, /^Platform breakdown$/, 4).map(({ name, vals }) => ({
    name: name.replace(/\s+(Unbranded|Branded)$/i, ''), branded: /\sBranded$/i.test(name),
    visibility: num(vals[0]), mention_rate: num(vals[1]), share_of_voice: num(vals[2]), avg_position: vals[3] === '—' ? null : num(vals[3]),
  }));
  const competitors = rowsOf(secC, /^Platform breakdown$/, 4).map(({ name, vals }) => ({
    name, visibility: num(vals[0]), mention_rate: num(vals[1]), share_of_voice: num(vals[2]), avg_position: vals[3] === '—' ? null : num(vals[3]),
  }));
  const sources = rowsOf(secS, /^Cited by$/, 3, { lastIsText: true }).map(({ name, vals }) => ({
    name, citations: num(vals[0]), coverage_rate: num(vals[1]), cited_by: vals[2],
  }));
  if (!prompts.length) throw new Error('Found no prompts on this page. Copy the whole page (including the Prompts table) and paste it again.');
  return { report_date, summary, platforms, prompts, competitors, sources };
}

// Flattens a parsed report into rows for seo_ai_bl_rows.
export function reportRows(rep) {
  const r = (kind, name, o = {}) => ({ report_date: rep.report_date, kind, name, visibility: o.visibility ?? null, mention_rate: o.mention_rate ?? null, share_of_voice: o.share_of_voice ?? null, avg_position: o.avg_position ?? null, citations: o.citations ?? null, coverage_rate: o.coverage_rate ?? null, cited_by: o.cited_by ?? null });
  return [
    r('summary', 'all platforms', rep.summary),
    ...rep.platforms.map((p) => r('platform', p.name, p)),
    ...rep.prompts.map((p) => r('prompt', p.name, p)),
    ...rep.competitors.map((c) => r('competitor', c.name, c)),
    ...rep.sources.map((s) => r('source', s.name, s)),
  ];
}

// ── Reading hand-entered / pasted checks: one per line ──
// query | engine | result | position | competitors (; separated) | notes      (comma, tab or pipe separated)
const ENGINE_WORDS = [
  [/ai\s*overviews?|\baio\b/i, 'google_aio'], [/ai\s*mode/i, 'google_ai_mode'], [/bing\s*local|local\s*pack/i, 'bing_local'], [/copilot|bing/i, 'bing_copilot'],
  [/perplexity/i, 'perplexity'], [/chat\s*gpt|openai/i, 'chatgpt'], [/claude/i, 'claude'], [/gemini/i, 'gemini'],
];
export function engineFrom(label) { const l = String(label || '').trim(); const lower = l.toLowerCase(); if (ENGINES[lower]) return lower; for (const [re, id] of ENGINE_WORDS) if (re.test(l)) return id; return null; }
export function resultFrom(label) {
  const l = String(label || '').trim().toLowerCase();
  if (!l) return null;
  if (/^(cited|cite|source|linked)/.test(l)) return 'cited';
  if (/not\s*named|absent|no\b|none|missing|not\s*(?:in|found|mentioned)/.test(l)) return 'not_named';
  if (/^(named|mentioned|yes|recommended|listed)/.test(l)) return 'named';
  return null;
}
export function parseCheckImport(text) {
  const rows = [], errors = [];
  String(text).split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = (line.includes('|') ? line.split('|') : line.includes('\t') ? line.split('\t') : line.split(',')).map((x) => x.trim());
    if (/^query$/i.test(parts[0])) return; // header
    const [query, eng, res, pos, comps, ...rest] = parts;
    const engine = engineFrom(eng), result = resultFrom(res);
    if (!query || query.length < 3) return errors.push({ line: i + 1, message: 'missing the search' });
    if (!engine) return errors.push({ line: i + 1, message: `unknown engine "${eng}"` });
    if (!result) return errors.push({ line: i + 1, message: `unknown result "${res}" (use cited, named or not named)` });
    rows.push({ query, engine, result, position: pos && /^\d+$/.test(pos) ? Number(pos) : null, competitors: comps ? comps.split(/[;/]/).map((x) => x.trim()).filter(Boolean) : [], notes: rest.join(', ') || null });
  });
  return { rows, errors };
}

// ── Did this AI answer name or cite us? ──
const BRAND_RES = [/medway\s*(?:&|and|\+)?\s*kent\s*removals/i, /medwaykentremovals/i];
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return String(u).toLowerCase(); } };
export function detectBrand(text, urls = []) {
  const named = BRAND_RES.some((re) => re.test(text || ''));
  const cited = urls.some((u) => { const h = hostOf(u); return h === OUR_DOMAIN || h.endsWith('.' + OUR_DOMAIN); });
  return { named: named || cited, cited };
}
export function findCompetitors(text, list = DEFAULT_COMPETITORS) {
  const t = String(text || '').toLowerCase();
  return list.filter((c) => t.includes(c.toLowerCase().replace(/\s+(removals?|moving|ltd|limited)$/i, '').trim()) && t.includes(c.toLowerCase().split(/\s+/)[0]));
}
// Position of our first mention inside a numbered or bulleted list in the answer (null if no list).
export function positionOf(text) {
  const items = String(text || '').split(/\n\s*(?:\d+[.)]|[-*•])\s+/).slice(1);
  if (items.length < 2) return null;
  const i = items.findIndex((it) => BRAND_RES.some((re) => re.test(it)));
  return i >= 0 ? i + 1 : null;
}

// ── Reading each engine's reply ──
export function parseClaude(j) {
  const blocks = j.content || [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const cited = [], sources = [];
  for (const b of blocks) {
    if (b.type === 'text') for (const c of b.citations || []) if (c.url) cited.push(c.url);
    if (b.type === 'web_search_tool_result') {
      if (b.content && b.content.type === 'web_search_tool_result_error') throw new Error(`Claude web search error: ${b.content.error_code}`);
      for (const r of Array.isArray(b.content) ? b.content : []) if (r.url) sources.push(r.url);
    }
  }
  return { text, urls: [...new Set(cited)], sources: [...new Set(sources)] };
}
export function parsePerplexity(j) {
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  const urls = j.citations || (j.search_results || []).map((r) => r.url) || [];
  return { text, urls: [...new Set(urls.filter(Boolean))], sources: [] };
}
export function parseOpenAI(j) {
  let text = ''; const urls = [];
  for (const item of j.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part.type === 'output_text') { text += part.text; for (const a of part.annotations || []) if (a.type === 'url_citation' && a.url) urls.push(a.url); }
    }
  }
  return { text, urls: [...new Set(urls)], sources: [] };
}

// ── Clients (fetch is injectable so tests never touch the network) ──
const LOCATION = { type: 'approximate', city: 'Rochester', region: 'England', country: 'GB' };
async function post(url, headers, body, fetchFn, label) {
  const r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${label} ${r.status}: ${(j.error && (j.error.message || j.error)) || j.message || 'request failed'}`);
  return j;
}
export const CLIENTS = {
  claude: ({ apiKey, model = 'claude-sonnet-5-5', fetchFn = fetch }) => async (query) => parseClaude(await post('https://api.anthropic.com/v1/messages',
    { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: 1500, messages: [{ role: 'user', content: query }], tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, user_location: { ...LOCATION, timezone: 'Europe/London' } }] }, fetchFn, 'Claude')),
  perplexity: ({ apiKey, model = 'sonar', fetchFn = fetch }) => async (query) => parsePerplexity(await post('https://api.perplexity.ai/chat/completions',
    { authorization: `Bearer ${apiKey}` }, { model, messages: [{ role: 'user', content: query }] }, fetchFn, 'Perplexity')),
  chatgpt: ({ apiKey, model = 'gpt-4.1', fetchFn = fetch }) => async (query) => parseOpenAI(await post('https://api.openai.com/v1/responses',
    { authorization: `Bearer ${apiKey}` }, { model, input: query, tools: [{ type: 'web_search_preview', user_location: LOCATION }] }, fetchFn, 'OpenAI')),
};

// ── One row per (search, engine): several samples because answers vary run to run ──
export function aggregate(samples, { competitors = DEFAULT_COMPETITORS } = {}) {
  const hitsNamed = samples.filter((s) => s.named).length;
  const hitsCited = samples.filter((s) => s.cited).length;
  const positions = samples.map((s) => s.position).filter((p) => p != null);
  const comp = new Set(); const urls = new Set();
  for (const s of samples) { findCompetitors(s.text, competitors).forEach((c) => comp.add(c)); (s.urls || []).forEach((u) => urls.add(u)); }
  return {
    samples: samples.length, hits_named: hitsNamed, hits_cited: hitsCited,
    result: hitsCited ? 'cited' : hitsNamed ? 'named' : 'not_named',
    position: positions.length ? Math.min(...positions) : null,
    competitors: [...comp], cited_urls: [...urls].slice(0, 12),
    excerpt: String((samples.find((s) => s.named) || samples[0] || {}).text || '').slice(0, 700),
  };
}

// engines: { claude: async (q) => {text,urls}, ... }. A failing engine is dropped after its first error,
// so a bad key never burns the whole budget. Returns { rows, errors, calls }.
export async function runChecks({ queries, engines, samples = 2, competitors = DEFAULT_COMPETITORS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onProgress = () => {} }) {
  const rows = [], errors = {}; let calls = 0;
  for (const query of queries) {
    for (const [id, call] of Object.entries(engines)) {
      if (errors[id]) continue;
      const got = [];
      for (let i = 0; i < samples; i++) {
        try {
          const a = await call(query); calls++;
          const b = detectBrand(a.text, a.urls);
          got.push({ ...b, text: a.text, urls: a.urls, position: b.named ? positionOf(a.text) : null });
        } catch (e) { errors[id] = String(e.message).slice(0, 300); break; }
        await sleep(600);
      }
      if (errors[id]) continue;
      rows.push({ query, engine: id, ...aggregate(got, { competitors }) });
      onProgress(query, id);
    }
  }
  return { rows, errors, calls };
}

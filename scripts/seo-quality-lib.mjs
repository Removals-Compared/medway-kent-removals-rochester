// ════════════════════════════════════════════════════════════
//  Draft quality gate (pure functions).
//  "critical" findings block approval. Two kinds of critical finding can be
//  acknowledged by the owner (a price or a claim they have verified);
//  everything else must be fixed in the text.
// ════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import { jaccard } from './seo-audit-lib.mjs';

export const ACKNOWLEDGEABLE = new Set(['unverified_price', 'unverified_claim']);

const words = (t) => (t.match(/[A-Za-z0-9£][A-Za-z0-9£'’-]*/g) || []);
const stripTags = (h) => h.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
export const keyOf = (code, detail = '') => `${code}:${crypto.createHash('sha1').update(String(detail)).digest('hex').slice(0, 10)}`;

// Em dashes read as machine-written; the site replaces them (see scripts/publish-due.mjs).
export function cleanWriting(html) {
  return html
    .replace(/\s*[—–]\s*/g, (m, off, s) => (/[.!?]\s*$/.test(s.slice(Math.max(0, off - 2), off)) ? ' ' : ', '))
    .replace(/,\s*,/g, ',');
}

// £ amounts as numbers: "£1,150" -> 1150
export function amountsIn(text) {
  return [...text.matchAll(/£\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

export function allowedAmountsFrom(pricingMd, extra = []) {
  return new Set([...amountsIn(pricingMd), ...extra.map(Number)]);
}

const CLAIM_PATTERNS = [
  [/\b(award[- ]winning|award winner|voted (?:best|top))\b/i, 'an award'],
  [/\b(accredited|accreditation|BAR member|British Association of Removers|Which\??\s*Trusted|Trading Standards approved|Checkatrade|TrustPilot|Trustpilot)\b/i, 'an accreditation or trade body'],
  [/\b\d{1,2}\+?\s*(?:years?|yrs)\b[^.]{0,40}\b(experience|trading|in business|of removals)\b/i, 'years of experience'],
  [/\b(?:since|established in|founded in|trading since)\s+(?:19|20)\d{2}\b/i, 'a founding or trading date'],
  [/\b(cheapest|lowest price|price match|price-match|best price guarantee|#1|number one)\b/i, 'a superlative or price guarantee'],
  [/\bDBS[- ]?(?:checked|vetted)?\b|\bfully vetted\b|\bbackground[- ]checked\b/i, 'staff vetting'],
  [/\b(?:our|a)\s+fleet\s+of\s+\d+|\b\d+\s+(?:vans|lorries|trucks)\b|\bteam of \d+\b/i, 'fleet or team size'],
  [/\b4\.\d\s*(?:\/\s*5|stars?|out of 5)\b|\b(?:[6-9]\d|\d{3,})\+?\s*(?:five[- ]star\s+|google\s+)?reviews?\b/i, 'review figures other than 5 stars from 50+ reviews'],
  [/["“][^"”]{25,}["”]\s*[,\-–—]\s*[A-Z][a-z]+(?:\s[A-Z]\.?)?\b/, 'a quoted customer testimonial'],
];

export function checkDraft(draft, ctx = {}) {
  const { title = '', meta_description = '', slug = '', content = '', keyword = '', hasImage = false, claims_to_verify = [] } = draft;
  const allowed = ctx.allowedAmounts || new Set();
  const sitePaths = ctx.sitePaths || null;
  const acknowledged = ctx.acknowledged || new Set();
  const findings = [];
  const add = (code, severity, message, detail = '') => findings.push({ code, severity, message, detail, key: keyOf(code, detail) });

  const text = stripTags(content);
  const w = words(text);
  const wordCount = w.length;

  if (/<script\b|<iframe\b|<object\b|<embed\b|\son[a-z]+\s*=|javascript:/i.test(content)) add('unsafe_markup', 'critical', 'The text contains script, iframe or event-handler markup.');
  if (/<h1[\s>]/i.test(content)) add('h1_in_body', 'critical', 'The body contains an H1. The page template supplies the H1 from the title.');
  if (/\[(?:insert|todo|link|placeholder|image)[^\]]*\]|lorem ipsum|\bTODO\b|as an ai\b|<!--/i.test(content)) add('placeholder_text', 'critical', 'The text contains placeholder or unfinished markers.');

  if (!title.trim()) add('title_missing', 'critical', 'No title.');
  else if (title.length > 65) add('title_long', 'warn', `Title is ${title.length} characters; aim for 60 or fewer.`);
  else if (title.length < 25) add('title_short', 'warn', `Title is only ${title.length} characters.`);
  if (!meta_description.trim()) add('meta_missing', 'critical', 'No meta description.');
  else if (meta_description.length > 160) add('meta_long', 'warn', `Meta description is ${meta_description.length} characters; aim for 155 or fewer.`);
  else if (meta_description.length < 90) add('meta_short', 'warn', `Meta description is only ${meta_description.length} characters.`);

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) add('slug_invalid', 'critical', 'The URL slug must be lowercase letters, numbers and hyphens.', slug);
  else {
    if (slug.length > 80) add('slug_long', 'warn', 'The URL slug is long.');
    if (ctx.existingSlugs && ctx.existingSlugs.has(slug)) add('slug_taken', 'critical', 'A page or post with this URL already exists.', slug);
  }

  if (wordCount < 500) add('too_short', 'critical', `Only ${wordCount} words. A useful article needs at least 500, ideally 900 or more.`);
  else if (wordCount < 900) add('short', 'warn', `${wordCount} words. Aim for 900 or more unless the topic is genuinely small.`);
  if ((content.match(/<h2[\s>]/gi) || []).length < 3) add('few_headings', 'warn', 'Use at least three H2 sections so the article is easy to scan.');

  if (keyword) {
    const k = keyword.toLowerCase().trim();
    const kw = words(k).length;
    const hits = (text.toLowerCase().match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const density = wordCount ? (hits * kw) / wordCount : 0;
    if (!title.toLowerCase().includes(k) && !words(text).slice(0, 150).join(' ').toLowerCase().includes(k)) add('keyword_missing', 'warn', `"${keyword}" is not in the title or the opening paragraph.`);
    if (density > 0.05) add('keyword_stuffing', 'critical', `"${keyword}" makes up ${(density * 100).toFixed(1)}% of the words. That reads as keyword stuffing.`);
    else if (density > 0.03) add('keyword_heavy', 'warn', `"${keyword}" makes up ${(density * 100).toFixed(1)}% of the words; reduce it.`);
  }

  // Prices: every £ amount must come from pricing.md (or be acknowledged by the owner)
  const seen = new Set();
  for (const a of amountsIn(text)) {
    if (allowed.size && !allowed.has(a) && !seen.has(a)) { seen.add(a); add('unverified_price', 'critical', `£${a.toLocaleString('en-GB')} does not appear in pricing.md. Confirm it is true and relevant, or remove it.`, `£${a}`); }
    else if (!allowed.size && !seen.has(a)) { seen.add(a); add('unverified_price', 'critical', `£${a.toLocaleString('en-GB')} cannot be checked because no price list was supplied.`, `£${a}`); }
  }
  for (const [re, what] of CLAIM_PATTERNS) {
    const m = text.match(re);
    if (m) add('unverified_claim', 'critical', `Mentions ${what} ("${m[0].slice(0, 60)}"). Only keep it if it is true and you can prove it.`, `${what}:${m[0].toLowerCase()}`);
  }

  // Links
  const hrefs = [...content.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
  let internal = 0;
  for (const h of hrefs) {
    const isExternal = /^https?:\/\//i.test(h) && !/^https?:\/\/(?:www\.)?medwaykentremovals\.co\.uk/i.test(h);
    if (/^(mailto:|tel:|#)/i.test(h)) continue;
    if (isExternal) { add('external_link', 'info', `Links out to ${h}. Make sure it is a source worth sending readers to.`, h); continue; }
    internal++;
    const p = h.replace(/^https?:\/\/(?:www\.)?medwaykentremovals\.co\.uk/i, '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    if (sitePaths && !sitePaths.has(p) && !/\.(png|jpe?g|webp|svg|pdf)$/i.test(p)) add('broken_internal_link', 'critical', `Links to ${p}, which is not a page on your site.`, p);
  }
  if (internal < 2) add('few_internal_links', 'warn', 'Link to at least two relevant pages on your site (a service page and a related guide).');

  // Near-duplicate of something already on the site
  if (ctx.corpus && ctx.corpus.length) {
    const sh = shingles(w);
    let best = { s: 0, path: '' };
    for (const c of ctx.corpus) { const s = jaccard(sh, c.shingles); if (s > best.s) best = { s, path: c.path }; }
    if (best.s >= 0.5) add('near_duplicate', 'critical', `About ${Math.round(best.s * 100)}% of the wording matches ${best.path}. Rewrite it so it adds something new.`, best.path);
    else if (best.s >= 0.35) add('similar_wording', 'warn', `About ${Math.round(best.s * 100)}% of the wording overlaps with ${best.path}.`, best.path);
  }

  if (/[—–]/.test(content)) add('dashes', 'warn', 'The text contains long dashes, which read as machine-written.');
  if (!hasImage) add('needs_image', 'info', 'No featured image chosen yet.');
  for (const c of claims_to_verify) add('check_this', 'info', String(c).slice(0, 300), String(c));

  // Owner acknowledgements (only for price and claim findings, tied to this exact text)
  for (const f of findings) {
    if (f.severity === 'critical' && ACKNOWLEDGEABLE.has(f.code) && acknowledged.has(f.key)) { f.severity = 'acknowledged'; }
  }

  const critical = findings.filter((f) => f.severity === 'critical');
  const warn = findings.filter((f) => f.severity === 'warn');
  return {
    findings,
    critical_count: critical.length,
    warn_count: warn.length,
    score: Math.max(0, 100 - critical.length * 25 - warn.length * 5),
    stats: { words: wordCount, internal_links: internal },
  };
}

export function shingles(wordsArr, n = 5) {
  const out = new Set();
  const w = wordsArr.map((x) => x.toLowerCase());
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

export function corpusEntry(path, html) {
  return { path, shingles: shingles(words(stripTags(html))) };
}

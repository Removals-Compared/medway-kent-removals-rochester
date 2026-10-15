// ════════════════════════════════════════════════════════════
//  AI drafting pipeline (no database, no network of its own: the caller
//  passes in `llm`, so tests can run it with a stub).
//
//  Three separate steps, as the brief requires:
//    1. research  → intent, outline, which of OUR pages to link, what to verify
//    2. write     → the article, using only the supplied facts
//    3. review    → a second pass that lists claims the facts do not support
//  then the deterministic quality gate (seo-quality-lib.mjs) scores the result.
// ════════════════════════════════════════════════════════════
import { checkDraft, cleanWriting, countWords, MIN_WORDS } from './seo-quality-lib.mjs';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

const slugify = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/g, '');
export { slugify };

// ── Talking to Claude ───────────────────────────────────────
export function makeClaude({ apiKey, model = DEFAULT_MODEL, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  return async function llm({ system, user, maxTokens = 4000 }) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetchFn('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
          signal: AbortSignal.timeout(240000),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
          if (!text) throw new Error('Claude returned no text');
          return text;
        }
        lastErr = new Error(`Claude API ${r.status}: ${(j.error && j.error.message) || 'request failed'}`);
        if (r.status < 500 && r.status !== 429) throw lastErr; // retrying will not help
      } catch (e) {
        lastErr = e;
        if (/Claude API 4\d\d/.test(String(e.message)) && !/429/.test(String(e.message))) throw e;
      }
      await sleep(1500 * (attempt + 1));
    }
    throw lastErr || new Error('Claude request failed');
  };
}

// First complete {...} object in a reply, tolerating code fences and chatter.
export function parseJson(text) {
  const t = String(text).replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) throw new Error('no JSON object in the reply');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error('the JSON object in the reply was cut off');
}

async function askJson(llm, args, validate, label) {
  let err = '';
  for (let i = 0; i < 2; i++) {
    const text = await llm({ ...args, user: args.user + (err ? `\n\nYour previous reply was rejected: ${err}\nReturn ONLY the corrected JSON object.` : '') });
    try { const j = parseJson(text); validate(j); return j; }
    catch (e) { err = e.message; }
  }
  throw new Error(`${label} step failed: ${err}`);
}

const need = (o, k, type) => { if (typeof o[k] !== type || (type === 'string' && !o[k].trim())) throw new Error(`"${k}" must be a non-empty ${type}`); };
const needArr = (o, k) => { if (!Array.isArray(o[k])) throw new Error(`"${k}" must be an array`); };

// ── Prompts ─────────────────────────────────────────────────
const RULES = `Rules that always apply:
- UK English. Plain, practical, honest tone. No hype, no filler, no "in today's fast-paced world".
- Never use em dashes or en dashes. Use commas, full stops or the word "to".
- Use ONLY the facts supplied. Never invent prices, review counts, ratings, years in business, awards, accreditations, staff or fleet numbers, customer names or testimonials, or places served.
- Prices: only use amounts that appear in the supplied price list, exactly as given. If you need a price that is not there, describe it without a number and put it in claims_to_verify.
- Do not claim the business serves a place unless it is in the supplied list of covered places.
- Do not copy wording from the existing pages supplied for reference; add something genuinely new and useful.`;

export function researchPrompt({ facts, pricing, pages, input }) {
  return {
    system: `You are the SEO researcher for a UK removals company. You plan; you do not write the article.\n${RULES}\nReply with ONE JSON object and nothing else.`,
    user: `BUSINESS FACTS (JSON):\n${JSON.stringify(facts)}\n\nPRICE LIST (the only prices that may be used):\n${pricing}\n\nPAGES ON THE SITE (path: title). Choose 3 to 6 of these to link to, using the exact path:\n${pages.map((p) => `${p.path}: ${p.title}`).join('\n')}\n\nPLACES THE SITE HAS A DEDICATED REMOVALS PAGE FOR: ${pages.filter((p) => /^\/removals-/.test(p.path)).map((p) => p.path.replace('/removals-', '')).join(', ')}\n\nTASK: plan a ${input.kind === 'page_rewrite' ? `rewrite of the existing page ${input.target_url}` : 'new blog article'} for the search "${input.keyword}".\nWhy this was chosen (real Search Console evidence): ${JSON.stringify(input.evidence || {})}\nOwner notes: ${input.notes || 'none'}\n\nReturn JSON: {"intent": string (what the searcher wants), "audience": string, "angle": string (what makes this genuinely more useful than what already ranks), "outline": [{"h2": string, "points": [string]}] (5 to 8 sections), "faq": [{"q": string}] (3 to 5), "internal_links": [{"path": string, "anchor": string}], "claims_to_verify": [string] (anything the owner should confirm), "avoid": [string]}`,
    maxTokens: 3000,
  };
}
export function validateResearch(j) {
  need(j, 'intent', 'string'); need(j, 'angle', 'string'); needArr(j, 'outline'); needArr(j, 'faq'); needArr(j, 'internal_links'); needArr(j, 'claims_to_verify');
  if (j.outline.length < 3) throw new Error('"outline" needs at least 3 sections');
}

export function writePrompt({ facts, pricing, brief, input }) {
  return {
    system: `You are a careful copywriter for a UK removals company. You write useful, accurate articles that a local customer would be glad to have read.\n${RULES}\nReply with ONE JSON object and nothing else.`,
    user: `BUSINESS FACTS (JSON):\n${JSON.stringify(facts)}\n\nPRICE LIST (the only prices that may be used):\n${pricing}\n\nBRIEF (follow it):\n${JSON.stringify(brief)}\n\nWrite the ${input.kind === 'page_rewrite' ? 'replacement body for ' + input.target_url : 'article'} for the search "${input.keyword}".\n\nFormat of content_html: an HTML fragment using only <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <a href="/path">. NO <h1> (the template adds it from the title). 1400 to 1800 words (NEVER fewer than 1200: count them). Open by answering the search directly. Include an H2 "Frequently asked questions" with each question as an <h3> and a short factual answer. Link to the internal pages in the brief naturally, using root-relative paths like /house-removals. Finish with a short call to action paragraph using the phone number and contact page from the facts.\n\nReturn JSON: {"title": string (60 characters or fewer, includes the search naturally), "meta_description": string (120 to 155 characters), "slug": string (lowercase, hyphens), "content_html": string, "faqs": [{"q": string, "a": string}], "image_suggestions": [{"description": string, "alt": string}], "claims_to_verify": [string]}`,
    maxTokens: 8000,
  };
}
export function validateDraft(j) {
  need(j, 'title', 'string'); need(j, 'meta_description', 'string'); need(j, 'slug', 'string'); need(j, 'content_html', 'string'); needArr(j, 'faqs'); needArr(j, 'claims_to_verify');
}

export function expandPrompt({ facts, pricing, brief, draft, words, minWords }) {
  return {
    system: `You are a careful copywriter for a UK removals company. You lengthen an article that is too short by adding genuinely useful content, not padding.\n${RULES}\nReply with ONE JSON object and nothing else.`,
    user: `BUSINESS FACTS (JSON):\n${JSON.stringify(facts)}\n\nPRICE LIST (the only prices that may be used):\n${pricing}\n\nBRIEF:\n${JSON.stringify(brief)}\n\nCURRENT ARTICLE (${words} words, which is too short; it must be at least ${minWords}, aim for ${minWords + 250}):\n${draft.content_html}\n\nRewrite the whole article so it is at least ${minWords + 150} words. Keep everything that is good. Add practical depth: extra sections from the brief outline, worked examples, checklists, common mistakes, questions people really ask. No filler, no repetition, no invented facts. Same HTML rules as before (h2, h3, p, ul, ol, li, strong, a with root-relative paths; no h1). Keep the FAQ section and the closing call to action.\n\nReturn JSON: {"content_html": string, "faqs": [{"q": string, "a": string}], "claims_to_verify": [string]}`,
    maxTokens: 9000,
  };
}
export function validateExpand(j) { need(j, 'content_html', 'string'); }

export function reviewPrompt({ facts, pricing, draft }) {
  return {
    system: `You are a strict fact-checker. You compare an article against the supplied facts and list every statement the facts do NOT support. You do not rewrite.\nReply with ONE JSON object and nothing else.`,
    user: `BUSINESS FACTS (JSON):\n${JSON.stringify(facts)}\n\nPRICE LIST:\n${pricing}\n\nARTICLE (HTML):\n${draft.content_html}\n\nList each claim about the business, its prices, reviews, experience, insurance, coverage, staff or vehicles that is not supported by the facts or price list. General moving advice that is not about this business is fine.\nReturn JSON: {"unsupported": [{"claim": string, "why": string}], "verdict": "ok" | "needs_owner_check"}`,
    maxTokens: 2000,
  };
}
export function validateReview(j) { needArr(j, 'unsupported'); }

// ── Orchestration ───────────────────────────────────────────
// ctx: { facts, pricing, pages:[{path,title}], allowedAmounts:Set, sitePaths:Set, existingSlugs:Set, corpus:[...] }
export async function runDraft({ input, ctx, llm, onStep = () => {} }) {
  onStep('researching');
  const brief = await askJson(llm, researchPrompt({ facts: ctx.facts, pricing: ctx.pricing, pages: ctx.pages, input }), validateResearch, 'Research');
  onStep('drafting');
  const written = await askJson(llm, writePrompt({ facts: ctx.facts, pricing: ctx.pricing, brief, input }), validateDraft, 'Writing');
  // Too short? Ask for a fuller version (twice at most). The gate still has the final say.
  const minWords = ctx.minWords ?? MIN_WORDS;
  for (let i = 0; i < 2 && countWords(written.content_html) < minWords; i++) {
    onStep('drafting');
    try {
      const more = await askJson(llm, expandPrompt({ facts: ctx.facts, pricing: ctx.pricing, brief, draft: written, words: countWords(written.content_html), minWords }), validateExpand, 'Expand');
      if (countWords(more.content_html) > countWords(written.content_html)) {
        written.content_html = more.content_html;
        if (Array.isArray(more.faqs) && more.faqs.length) written.faqs = more.faqs;
        if (Array.isArray(more.claims_to_verify)) written.claims_to_verify = [...written.claims_to_verify, ...more.claims_to_verify];
      }
    } catch { break; }
  }
  onStep('quality_check');
  let review = { unsupported: [], verdict: 'ok' };
  try { review = await askJson(llm, reviewPrompt({ facts: ctx.facts, pricing: ctx.pricing, draft: written }), validateReview, 'Review'); }
  catch (e) { review = { unsupported: [{ claim: 'The automatic fact-check could not run', why: e.message }], verdict: 'needs_owner_check' }; }

  const content = cleanWriting(written.content_html.trim());
  const title = cleanWriting(written.title.trim());
  const meta_description = cleanWriting(written.meta_description.trim());
  const slug = input.keep_slug || slugify(written.slug) || slugify(input.keyword);
  const claims = [
    ...brief.claims_to_verify, ...written.claims_to_verify,
    ...review.unsupported.map((u) => `${u.claim} (${u.why})`),
  ].map(String).filter((c, i, a) => c.trim() && a.indexOf(c) === i);

  const draft = { title, meta_description, slug, content, keyword: input.keyword, hasImage: false, claims_to_verify: claims };
  const quality = checkDraft(draft, ctx);
  return {
    revision: {
      title, meta_description, content,
      meta: {
        slug, keyword: input.keyword, kind: input.kind || 'post', target_url: input.target_url || null,
        faqs: written.faqs, image_suggestions: written.image_suggestions || [],
        internal_links: brief.internal_links, intent: brief.intent, angle: brief.angle, claims_to_verify: claims,
        generated: { model: ctx.model || null, review_verdict: review.verdict },
      },
    },
    quality,
    brief,
  };
}

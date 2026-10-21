// ════════════════════════════════════════════════════════════
//  Audit fixes: what to propose (rules) and how to apply an approved change.
//  Pure functions; no database, no network.
//
//  SAFETY RULES, enforced in code:
//   * Titles, descriptions and related links are only ever proposed for BLOG POSTS
//     (low traffic). Busy service, area and hub pages are never touched.
//   * A title change edits the <title> tag (and og:title) only, never the page heading.
//   * Nothing changes a URL, canonical, redirect or noindex setting.
//   * Applying a change first checks the page still says what the proposal started from.
// ════════════════════════════════════════════════════════════
import { claimHits, amountsIn } from './seo-quality-lib.mjs';

export const POST_PREFIX = '/blog/posts/';
export const isPost = (path) => path.startsWith(POST_PREFIX);

export const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Proposals ───────────────────────────────────────────────
const BRAND_TAIL = /\s*\|\s*Medway\s*(?:&|and)?\s*Kent Removals(?:\s+Rochester)?\s*$/i;

export function trimBrand(title) {
  const t = decode(title).trim();
  const out = t.replace(BRAND_TAIL, '').trim();
  return out && out !== t ? out : null;
}

// posts: [{ path, title }] (title = the decoded <title> tag). Returns { rule, needAi }.
export function proposeTitles(posts) {
  const rule = [], needAi = [];
  for (const p of posts) {
    if (!isPost(p.path)) continue;
    const before = decode(p.title).trim();
    if (before.length <= 60) continue;
    const trimmed = trimBrand(before);
    if (trimmed && trimmed.length <= 60 && trimmed.length >= 20) {
      rule.push({ path: p.path, kind: 'title', before, after: trimmed, source: 'rule', reason: `The title is ${before.length} characters, so Google cuts it off. This only removes the site name from the end (${before.length} to ${trimmed.length} characters). The page heading is unchanged.` });
    } else needAi.push({ path: p.path, before });
  }
  return { rule, needAi };
}

export function validateTitle(after, before) {
  const t = String(after || '').trim();
  if (t.length < 20 || t.length > 60) return `must be 20 to 60 characters (got ${t.length})`;
  if (t === before) return 'is the same as the current title';
  if (/[\u2014\u2013]/.test(t)) return 'contains a long dash';
  if (/£/.test(t)) return 'contains a price';
  if (claimHits(t).length) return `makes a claim (${claimHits(t)[0]})`;
  return null;
}

export function validateDescription(after, before, allowedAmounts = new Set()) {
  const t = String(after || '').trim();
  if (t.length < 100 || t.length > 155) return `must be 100 to 155 characters (got ${t.length})`;
  if (t === before) return 'is the same as the current description';
  if (/[\u2014\u2013]/.test(t)) return 'contains a long dash';
  if (claimHits(t).length) return `makes a claim (${claimHits(t)[0]})`;
  const bad = amountsIn(t).find((a) => !allowedAmounts.has(a));
  if (bad !== undefined) return `contains a price (£${bad}) that is not in pricing.md`;
  return null;
}

// posts: [{ path, meta_description }]. Long (>160) or short (<70) descriptions need a rewrite.
export function descriptionsNeeded(posts) {
  return posts.filter((p) => isPost(p.path) && p.meta_description && (p.meta_description.length > 160 || p.meta_description.length < 70))
    .map((p) => ({ path: p.path, before: decode(p.meta_description).trim() }));
}

const STOP = new Set(['the', 'and', 'for', 'to', 'in', 'of', 'a', 'how', 'what', 'your', 'you', 'kent', 'medway', 'removal', 'removals', 'company', 'house', 'move', 'moving', 'guide', 'best', 'with', 'when', 'why', 'is', 'it', 'do', 'on', 'or', 'we', 'new']);
const tokensOf = (slug) => new Set(slug.replace(/^.*\//, '').split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t)));

// posts: [{ path, title, hasRelated, links:Set<path>, inbound:number }]
// For each weakly linked post, pick up to two related posts (which already have a "related articles"
// block) to link to it. Each source post gains at most two links.
export function proposeRelated(posts, { weakMax = 1, perSource = 2, perTarget = 2 } = {}) {
  const added = new Map();
  const out = [];
  const weak = posts.filter((p) => isPost(p.path) && p.inbound <= weakMax).sort((a, b) => a.inbound - b.inbound);
  for (const target of weak) {
    const tt = tokensOf(target.path);
    const cands = posts
      .filter((s) => s.path !== target.path && isPost(s.path) && s.hasRelated && !s.links.has(target.path) && (added.get(s.path) || 0) < perSource)
      .map((s) => { const st = tokensOf(s.path); let n = 0; for (const t of tt) if (st.has(t)) n++; return { s, n }; })
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.s.path.localeCompare(b.s.path));
    for (const { s, n } of cands.slice(0, perTarget)) {
      added.set(s.path, (added.get(s.path) || 0) + 1);
      const text = target.title.length > 70 ? target.title.slice(0, 70).replace(/\s+\S*$/, '') : target.title;
      out.push({
        path: s.path, kind: 'related_link', before: null, source: 'rule',
        after: `<a href="${target.path}" class="related-link">${esc(text)}</a>`,
        reason: `"${text}" is linked from only ${target.inbound} other page${target.inbound === 1 ? '' : 's'}. This adds one more link to it from a related article (${n} shared topic word${n === 1 ? '' : 's'}), inside its existing "related articles" box.`,
      });
    }
  }
  return out;
}

// pages: [{ path, canonical (path or ''), indexable, inSitemap }]
export function proposeSitemap(pages, { today }) {
  const out = [];
  for (const p of pages) {
    if (p.inSitemap && p.canonical && p.canonical !== p.path) {
      out.push({ path: p.path, kind: 'sitemap_remove', before: null, after: '', source: 'rule',
        reason: `${p.path} tells Google its real version is ${p.canonical}, so it should not also be listed in the sitemap. Google already follows the canonical; this just tidies the list.` });
    }
    // a page whose canonical is another page is left out of the sitemap on purpose
    if (!p.inSitemap && p.indexable && p.path !== '/thank-you' && (!p.canonical || p.canonical === p.path)) {
      out.push({ path: p.path, kind: 'sitemap_add', before: null, after: '', source: 'rule',
        reason: `${p.path} can be indexed but is missing from the sitemap. Adding it helps Google find it.`, lastmod: today });
    }
  }
  return out;
}

// ── Applying an approved change ─────────────────────────────
const fail = (why) => ({ ok: false, why });

export function applyTitle(html, before, after) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return fail('the page has no title tag');
  if (decode(m[1]).trim() !== before.trim()) return fail('the page title has changed since this was proposed');
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${esc(after)}</title>`);
  out = out.replace(/(<meta property="og:title" content=")([^"]*)(")/i, (m0, a, c, b) => (decode(c).trim() === before.trim() ? a + esc(after) + b : m0));
  return { ok: true, html: out };
}

export function applyDescription(html, before, after) {
  const m = html.match(/<meta name="description" content="([^"]*)"/i);
  if (!m) return fail('the page has no meta description');
  if (decode(m[1]).trim() !== before.trim()) return fail('the page description has changed since this was proposed');
  let out = html.replace(/(<meta name="description" content=")[^"]*(")/i, (m0, a, b) => a + esc(after) + b);
  out = out.replace(/(<meta property="og:description" content=")([^"]*)(")/i, (m0, a, c, b) => (decode(c).trim() === before.trim() ? a + esc(after) + b : m0));
  const oldJ = JSON.stringify(before).slice(1, -1), newJ = JSON.stringify(after).slice(1, -1);
  out = out.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/gi, (m0, a, body, c) => a + body.split(`"${oldJ}"`).join(`"${newJ}"`) + c);
  return { ok: true, html: out };
}

export function applyRelatedLink(html, anchor) {
  const href = (anchor.match(/href="([^"]+)"/) || [])[1];
  const m = html.match(/<div class="related-posts">[\s\S]*?<\/div>/);
  if (!m) return fail('the page has no "related articles" box');
  if (m[0].includes(`href="${href}"`)) return { ok: true, html, already: true };
  const block = m[0].replace(/<\/div>$/, anchor + '</div>');
  return { ok: true, html: html.replace(m[0], () => block) };
}

export function removeSitemapEntry(xml, path, site) {
  const loc = `${site}${path === '/' ? '/' : path}`;
  const re = new RegExp(`\\s*<url>\\s*<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>[\\s\\S]*?</url>`);
  if (!re.test(xml)) return fail(`${path} is no longer in the sitemap`);
  return { ok: true, html: xml.replace(re, '') };
}

export function addSitemapEntry(xml, path, site, lastmod) {
  const loc = `${site}${path}`;
  if (xml.includes(`<loc>${loc}</loc>`)) return { ok: true, html: xml, already: true };
  const entry = `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>yearly</changefreq>\n    <priority>0.3</priority>\n  </url>\n`;
  if (!xml.includes('</urlset>')) return fail('the sitemap has no closing tag');
  return { ok: true, html: xml.replace('</urlset>', entry + '</urlset>') };
}

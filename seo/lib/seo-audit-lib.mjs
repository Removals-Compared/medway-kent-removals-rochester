// ════════════════════════════════════════════════════════════
//  SEO audit rules (pure functions, no network, no database).
//  Used by scripts/seo-audit.mjs and covered by tests/seo-audit.test.mjs.
// ════════════════════════════════════════════════════════════

export const SITE = 'https://www.medwaykentremovals.co.uk';

// Real figures the site may claim (see memory/pricing.md): 5 stars, 50+ Google reviews.
export const REVIEW_CLAIM = { rating: 5, minCount: 50 };

const SERVICE_PATHS = new Set([
  '/house-removals', '/packing-services', '/office-removals',
  '/man-and-van', '/storage', '/long-distance-removals',
]);
const HUB_PATHS = new Set([
  '/services', '/areas', '/blog', '/faq', '/removal-costs-kent',
  '/best-removal-companies-medway', '/about', '/contact',
]);

export function toPath(url) {
  const u = String(url).replace(/^https?:\/\/[^/]+/i, '').split('#')[0].split('?')[0];
  if (!u || u === '/') return '/';
  return u.replace(/\/+$/, '') || '/';
}

export function classify(path) {
  if (path === '/') return 'home';
  if (SERVICE_PATHS.has(path)) return 'service';
  if (/^\/removals-[a-z-]+$/.test(path)) return 'town';
  if (path.startsWith('/blog/posts/')) return 'post';
  if (HUB_PATHS.has(path)) return 'hub';
  return 'other';
}

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

// Turn an href into a site-relative path, or null if external / not a page.
export function internalPath(href, fromPath = '/') {
  if (!href) return null;
  href = href.trim();
  if (/^(mailto:|tel:|sms:|javascript:|data:|#)/i.test(href)) return null;
  let p;
  if (/^https?:\/\//i.test(href)) {
    const host = href.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    if (host !== 'www.medwaykentremovals.co.uk' && host !== 'medwaykentremovals.co.uk') return null;
    p = toPath(href);
  } else if (href.startsWith('//')) {
    return null;
  } else if (href.startsWith('/')) {
    p = toPath(href);
  } else {
    const base = fromPath.endsWith('/') ? fromPath : fromPath.replace(/[^/]*$/, '');
    p = toPath(new URL(href, 'https://x.invalid' + base).pathname);
  }
  if (/\.(css|js|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|pdf|xml|txt|md|json|webmanifest|mp4|mov)$/i.test(p)) return null;
  if (p.startsWith('/api/') || p === '/admin' || p.startsWith('/admin/')) return null;
  return p;
}

export function parsePage(html, url) {
  const path = toPath(url);
  const grab = (re, g = 1) => { const m = html.match(re); return m ? decode(m[g]).trim() : ''; };
  const title = grab(/<title[^>]*>([\s\S]*?)<\/title>/i);
  // The value ends at the SAME kind of quote it started with, so an apostrophe inside "Kent's" does not cut it short.
  const meta = grab(/<meta[^>]+name=["']description["'][^>]*content=(["'])([\s\S]*?)\1/i, 2)
    || grab(/<meta[^>]+content=(["'])([\s\S]*?)\1[^>]*name=["']description["']/i, 2);
  const canonical = grab(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  const robots = grab(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["']/i);
  const h1s = [...html.matchAll(/<h1[\s>][\s\S]*?<\/h1>/gi)].map((m) => decode(m[0].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());

  // Visible body text and contextual links exclude chrome (nav, header, footer).
  const body = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const text = decode(body.replace(/<[^>]+>/g, ' '));
  const words = (text.match(/[A-Za-z0-9£][A-Za-z0-9£'’-]*/g) || []);

  const links = new Set();
  for (const m of body.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
    const p = internalPath(m[1], path);
    if (p && p !== path) links.add(p);
  }
  const allLinks = new Set();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"']+)["']/gi)) {
    const p = internalPath(m[1], path);
    if (p && p !== path) allLinks.add(p);
  }

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const missingAlt = imgs.filter((t) => !/\balt=["'][^"']*\S[^"']*["']/i.test(t) && !/\balt=["']["']/i.test(t)).length;

  const schemaTypes = new Set();
  let jsonldErrors = 0;
  const ratings = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      (function walk(n) {
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') {
          const t = n['@type'];
          (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => schemaTypes.add(x));
          if (t === 'AggregateRating') ratings.push({ ratingValue: Number(n.ratingValue), reviewCount: Number(n.reviewCount) });
          Object.values(n).forEach(walk);
        }
      })(j);
    } catch { jsonldErrors++; }
  }

  return {
    url, path, page_type: classify(path),
    title, meta_description: meta, canonical, robots,
    h1: h1s[0] || '', h1_count: h1s.length,
    word_count: words.length,
    images: imgs.length, images_missing_alt: missingAlt,
    links_out: allLinks.size,
    contextual_links: [...links],
    all_links: [...allLinks],
    schema_types: [...schemaTypes].sort(),
    jsonld_errors: jsonldErrors,
    ratings,
    shingles: shingleSet(words),
  };
}

function shingleSet(words, n = 5) {
  const out = new Set();
  const w = words.map((x) => x.toLowerCase());
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  const [s, l] = a.size < b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── Rules ───────────────────────────────────────────────────
// pages: parsed pages (status 200 html only). ctx: { status: {path:code},
// sitemap: [{url,path}], robotsTxt, redirects: {path: location}, site }
export function analyse(pages, ctx) {
  const issues = [];
  const add = (url, type, severity, detail, key = '') => issues.push({ url, type, severity, detail, issue_key: key });
  const inSitemap = new Set(ctx.sitemap.map((s) => s.path));
  const indexable = (p) => !/noindex/i.test(p.robots);

  // inbound contextual links
  const inbound = new Map(pages.map((p) => [p.path, new Set()]));
  for (const p of pages) for (const t of p.contextual_links) if (inbound.has(t)) inbound.get(t).add(p.path);
  for (const p of pages) p.links_in = inbound.get(p.path).size;

  for (const p of pages) {
    const u = p.url;
    if (!p.title) add(u, 'title_missing', 'error', 'No <title>.');
    else {
      if (p.title.length > 70) add(u, 'title_long', 'warn', `Title is ${p.title.length} characters; Google usually cuts off around 60.`);
      else if (p.title.length > 60) add(u, 'title_long', 'info', `Title is ${p.title.length} characters; may be cut off in results.`);
      if (p.title.length < 20) add(u, 'title_short', 'info', `Title is only ${p.title.length} characters.`);
    }
    if (!p.meta_description) add(u, 'meta_missing', 'error', 'No meta description.');
    else {
      if (p.meta_description.length > 175) add(u, 'meta_long', 'warn', `Description is ${p.meta_description.length} characters; Google usually shows about 155.`);
      else if (p.meta_description.length > 160) add(u, 'meta_long', 'info', `Description is ${p.meta_description.length} characters.`);
      if (p.meta_description.length < 70) add(u, 'meta_short', 'warn', `Description is only ${p.meta_description.length} characters.`);
    }
    if (!p.canonical) add(u, 'canonical_missing', 'warn', 'No canonical link.');
    else if (toPath(p.canonical) !== p.path || (/^https?:/i.test(p.canonical) && !p.canonical.startsWith(ctx.site))) {
      add(u, 'canonical_mismatch', 'warn', `Canonical points to ${p.canonical}.`);
    }
    if (!indexable(p)) {
      if (inSitemap.has(p.path)) add(u, 'noindex_in_sitemap', 'error', 'Page is noindex but listed in the sitemap.');
    }
    if (p.h1_count !== 1) add(u, 'h1_count', 'warn', `Page has ${p.h1_count} H1 headings (expected 1).`);

    const min = { post: 700, town: 1000, service: 1000, hub: 300, home: 300 }[p.page_type];
    if (min && p.word_count < min) {
      add(u, 'thin_content', p.word_count < min / 2 ? 'error' : 'warn',
        `${p.word_count} words of body text (this kind of page should have at least ${min}).`);
    }
    if (p.images_missing_alt) add(u, 'img_alt_missing', 'warn', `${p.images_missing_alt} image(s) have no alt text.`);
    if (p.jsonld_errors) add(u, 'jsonld_invalid', 'error', `${p.jsonld_errors} structured-data block(s) are not valid JSON.`);
    for (const r of p.ratings) {
      if (r.ratingValue !== REVIEW_CLAIM.rating || !(r.reviewCount >= REVIEW_CLAIM.minCount)) {
        add(u, 'review_claim', 'error', `Structured data claims ${r.ratingValue} stars from ${r.reviewCount} reviews; the confirmed figure is ${REVIEW_CLAIM.rating} stars, ${REVIEW_CLAIM.minCount}+ reviews.`, `${r.ratingValue}/${r.reviewCount}`);
      }
    }
    if (p.links_in <= 1 && p.path !== '/' && indexable(p)) {
      add(u, 'weak_internal_links', 'info', `Only ${p.links_in} other page(s) link to this one in their body text.`);
    }
    // a page whose canonical is another page belongs outside the sitemap, so it is not asked to be in it
    const selfCanonical = !p.canonical || toPath(p.canonical) === p.path;
    if (indexable(p) && selfCanonical && !inSitemap.has(p.path)) add(u, 'not_in_sitemap', 'warn', 'Indexable page is missing from sitemap.xml.');

    for (const t of p.contextual_links) {
      const code = ctx.status[t];
      if (code === 404 || code === 410 || code >= 500) add(u, 'broken_link', 'error', `Links to ${t}, which returns ${code}.`, t);
      else if (code >= 300 && code < 400) add(u, 'internal_redirect', 'info', `Links to ${t}, which redirects to ${ctx.redirects[t] || 'another URL'}.`, t);
    }
  }

  // duplicates
  for (const [field, type, label] of [['title', 'dup_title', 'title'], ['meta_description', 'dup_description', 'description']]) {
    const seen = new Map();
    for (const p of pages) {
      if (!p[field]) continue;
      const k = p[field].toLowerCase();
      seen.set(k, [...(seen.get(k) || []), p]);
    }
    for (const group of seen.values()) {
      if (group.length > 1) for (const p of group) add(p.url, type, 'warn', `Same ${label} as ${group.filter((x) => x !== p).map((x) => x.path).join(', ')}.`);
    }
  }

  // near-duplicate wording between pages of the same kind
  for (const kind of ['town', 'post']) {
    const group = pages.filter((p) => p.page_type === kind && p.shingles.size > 50);
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const s = jaccard(group[i].shingles, group[j].shingles);
      if (s >= 0.4) {
        const pct = Math.round(s * 100);
        add(group[i].url, 'near_duplicate', 'info', `About ${pct}% of the wording overlaps with ${group[j].path}. Make sure each page has its own local detail.`, group[j].path);
        add(group[j].url, 'near_duplicate', 'info', `About ${pct}% of the wording overlaps with ${group[i].path}. Make sure each page has its own local detail.`, group[i].path);
      }
    }
  }

  // sitemap
  for (const s of ctx.sitemap) {
    const code = ctx.status[s.path];
    if (s.nonHtml) add(s.url, 'sitemap_nonhtml', 'info', 'Not a web page, but listed in the sitemap. Search engines expect pages only.');
    else if (code && code !== 200) add(s.url, 'sitemap_dead', 'error', `Listed in the sitemap but returns ${code}.`);
  }
  if (!/^\s*Sitemap:\s*https?:\/\//im.test(ctx.robotsTxt || '')) add(ctx.site + '/robots.txt', 'robots_no_sitemap', 'warn', 'robots.txt does not point to the sitemap.');
  if (/^\s*Disallow:\s*\/\s*$/im.test(ctx.robotsTxt || '')) add(ctx.site + '/robots.txt', 'robots_blocks_all', 'error', 'robots.txt blocks the whole site.');

  return issues;
}

export function summarise(pages, issues) {
  const bySeverity = { error: 0, warn: 0, info: 0 };
  const byType = {};
  for (const i of issues) {
    bySeverity[i.severity]++;
    byType[i.type] = (byType[i.type] || 0) + 1;
  }
  const byPageType = {};
  for (const p of pages) byPageType[p.page_type] = (byPageType[p.page_type] || 0) + 1;
  return { pages: pages.length, issues: issues.length, by_severity: bySeverity, by_type: byType, by_page_type: byPageType };
}

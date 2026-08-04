// ════════════════════════════════════════════════════════════
//  Blog publisher + housekeeper.
//  Run daily by .github/workflows/publish-scheduled-posts.yml:
//    1. Copies any blog/scheduled/YYYY-MM-DD-*.html due today or
//       earlier into blog/posts/ (skipping ones already there).
//    2. Cleans the writing in every post and scheduled file:
//       em dashes are replaced with plain punctuation.
//    3. Makes sure every published post has a card on blog.html
//       and an entry in sitemap.xml.
//  Idempotent: safe to run any number of times.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const POSTS = path.join(ROOT, 'blog', 'posts');
const SCHEDULED = path.join(ROOT, 'blog', 'scheduled');
const BLOG_INDEX = path.join(ROOT, 'blog.html');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const SITE = 'https://www.medwaykentremovals.co.uk';

const today = process.env.PUBLISH_DATE || new Date().toISOString().slice(0, 10);
let changed = [];

// ── Writing cleanup ──────────────────────────────────────────
// Em dashes read as machine-written; replace them with normal
// punctuation. Headings and titles get a colon, running text a comma.
// Hyphens and digit ranges (7-19, ME1-ME10) are left alone.
function cleanWriting(html) {
  const fixTitle = (s) => s
    .replace(/\s*[—―]\s*/g, ': ')
    .replace(/\s+–\s+/g, ': ');
  const fixProse = (s) => s
    .replace(/\s*[—―]\s*/g, ', ')
    .replace(/\s+–\s+/g, ', ');

  // Titles, headings and meta descriptions first.
  html = html.replace(/(<title>)([\s\S]*?)(<\/title>)/gi, (m, a, t, b) => a + fixTitle(t) + b);
  html = html.replace(/(<h[1-3][^>]*>)([\s\S]*?)(<\/h[1-3]>)/gi, (m, a, t, b) => a + fixTitle(t) + b);
  html = html.replace(/(<meta[^>]*(?:description|og:title|og:description)[^>]*content=")([^"]*)(")/gi,
    (m, a, t, b) => a + fixTitle(t) + b);

  // Everything else.
  html = fixProse(html);

  // Tidy artefacts the swap can leave behind.
  html = html.replace(/,\s*,/g, ',').replace(/:\s*:/g, ':').replace(/,\s*\./g, '.');
  return html;
}

function cleanFileInPlace(file) {
  const before = fs.readFileSync(file, 'utf8');
  const after = cleanWriting(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed.push('cleaned ' + path.relative(ROOT, file));
  }
}

// ── Post metadata for the index card ─────────────────────────
function extractMeta(file) {
  const html = fs.readFileSync(file, 'utf8');
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.split('|')[0].trim()
    || path.basename(file, '.html').replace(/-/g, ' ');
  const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1]
    || 'Practical moving advice from the Medway and Kent Removals team.';
  const words = (html.replace(/<[^>]+>/g, ' ').match(/\S+/g) || []).length;
  const mins = Math.max(3, Math.round(words / 220));
  return { title, desc: desc.slice(0, 180), mins };
}

const CATS = [
  { cat: 'cost-guides', label: 'Cost Guide', emoji: '&#128176;', bg: '#14532d', test: /cost|price|quote|cheap|budget|money|deposit/i },
  { cat: 'checklists', label: 'Checklist', emoji: '&#9989;', bg: '#2d1b69', test: /checklist|what-to-do|prepare|update-address/i },
  { cat: 'packing', label: 'Packing', emoji: '&#128230;', bg: '#7c2d12', test: /pack|fragile|boxes|declutter/i },
  { cat: 'area-guides', label: 'Area Guide', emoji: '&#128506;', bg: '#0c4a6e', test: /moving-to-|moving-house-in-|areas-|-guide$|neighbourhood/i },
];
function catFor(slug) {
  for (const c of CATS) if (c.test.test(slug)) return c;
  return { cat: 'moving-tips', label: 'Moving Tips', emoji: '&#128654;', bg: '#0d1f3c' };
}

function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function makeCard(slug, meta, dateIso) {
  const c = catFor(slug);
  return `          <article class="blog-card" data-cat="${c.cat}">
            <div class="bc-img" style="background:${c.bg}">${c.emoji}<div class="bc-cat">${c.label}</div></div>
            <div class="bc-body">
              <div class="bc-meta"><span>&#128197; ${fmtDate(dateIso)}</span><span>&#128336; ${meta.mins} min read</span></div>
              <h3>${meta.title}</h3>
              <p>${meta.desc}</p>
              <a href="/blog/posts/${slug}" class="read-more">Read article &#8594;</a>
            </div>
          </article>
`;
}

function ensureIndexed(slug, dateIso) {
  let idx = fs.readFileSync(BLOG_INDEX, 'utf8');
  if (idx.includes(`blog/posts/${slug}`)) return;
  const meta = extractMeta(path.join(POSTS, slug + '.html'));
  const anchor = '<div class="blog-grid" id="blog-grid">';
  const at = idx.indexOf(anchor);
  if (at === -1) { console.error('blog-grid anchor not found; card not added for ' + slug); return; }
  const insertAt = at + anchor.length;
  idx = idx.slice(0, insertAt) + '\n' + makeCard(slug, meta, dateIso) + idx.slice(insertAt);
  fs.writeFileSync(BLOG_INDEX, idx);
  changed.push('indexed ' + slug);
}

function ensureSitemap(slug, dateIso) {
  let sm = fs.readFileSync(SITEMAP, 'utf8');
  if (sm.includes(`${SITE}/blog/posts/${slug}`)) return;
  const entry = `  <url>
    <loc>${SITE}/blog/posts/${slug}</loc>
    <lastmod>${dateIso}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
`;
  sm = sm.replace('</urlset>', entry + '</urlset>');
  fs.writeFileSync(SITEMAP, sm);
  changed.push('sitemapped ' + slug);
}

// When did a post go live? Its scheduled filename knows; otherwise today.
function publishDateFor(slug) {
  const hit = fs.readdirSync(SCHEDULED).find((f) => f.endsWith('-' + slug + '.html') || f === slug + '.html');
  const m = hit && hit.match(/^(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : today;
}

// ── 1. Publish due scheduled posts ───────────────────────────
for (const f of fs.readdirSync(SCHEDULED).sort()) {
  const m = f.match(/^(\d{4}-\d{2}-\d{2})-(.+\.html)$/);
  if (!m || m[1] > today) continue;
  const dest = path.join(POSTS, m[2]);
  if (fs.existsSync(dest)) continue;
  fs.writeFileSync(dest, cleanWriting(fs.readFileSync(path.join(SCHEDULED, f), 'utf8')));
  changed.push('published ' + m[2] + ' (scheduled ' + m[1] + ')');
}

// ── 2. Clean the writing everywhere ──────────────────────────
for (const f of fs.readdirSync(POSTS)) if (f.endsWith('.html')) cleanFileInPlace(path.join(POSTS, f));
for (const f of fs.readdirSync(SCHEDULED)) if (f.endsWith('.html')) cleanFileInPlace(path.join(SCHEDULED, f));

// ── 3. Index + sitemap for every published post ──────────────
for (const f of fs.readdirSync(POSTS).sort()) {
  if (!f.endsWith('.html')) continue;
  const slug = f.replace(/\.html$/, '');
  const d = publishDateFor(slug);
  ensureIndexed(slug, d);
  ensureSitemap(slug, d);
}

console.log(changed.length ? changed.join('\n') : 'nothing to do');
console.log(`SUMMARY: ${changed.length} change(s)`);

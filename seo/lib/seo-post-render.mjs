// ════════════════════════════════════════════════════════════
//  Renders an approved article into a full blog page using the site's own
//  standard post design (seo/templates/post.html, taken from a live post).
//  Pure: no database, no network.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import { cleanWriting, countWords } from './seo-quality-lib.mjs';

export const SITE = 'https://www.medwaykentremovals.co.uk';
export const BRAND_SUFFIX = ' | Medway &amp; Kent Removals';
const TEMPLATE = fs.readFileSync(new URL('../templates/post.html', import.meta.url), 'utf8');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const fmtDate = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const shortTitle = (t) => (t.length <= 60 ? t : t.slice(0, 60).replace(/\s+\S*$/, ''));
const ldSafe = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

export function jsonLd({ title, meta_description, slug, faqs = [], date, modified, keyword }) {
  const url = `${SITE}/blog/posts/${slug}`;
  const post = {
    '@type': 'BlogPosting', headline: title, description: meta_description,
    author: { '@type': 'Person', name: 'Amos Osho', jobTitle: 'Founder', url: `${SITE}/about`, worksFor: { '@type': 'Organization', name: 'Medway and Kent Removals' } },
    publisher: { '@type': 'Organization', name: 'Medway & Kent Removals', url: SITE },
    datePublished: date, dateModified: modified || date, url, mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    ...(keyword ? { keywords: keyword } : {}),
  };
  const good = faqs.filter((f) => f && f.q && f.a);
  if (!good.length) return { '@context': 'https://schema.org', ...post };
  return { '@context': 'https://schema.org', '@graph': [post, { '@type': 'FAQPage', mainEntity: good.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }] };
}

// article: { title, meta_description, slug, content, faqs?, keyword?, category? }
// opts: { date: 'YYYY-MM-DD' (first published), modified?, related?: [{path,title}] }
export function renderPost(article, opts) {
  const { title, meta_description, slug, content } = article;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '')) throw new Error(`Invalid slug "${slug}"`);
  if (!title || !meta_description || !content) throw new Error('Title, description and text are required to render a page');
  const date = opts.date, modified = opts.modified || opts.date;
  const body = cleanWriting(content.trim());
  const related = (opts.related || []).slice(0, 4);
  const relatedHtml = related.length
    ? `<div class="related-posts"><h3>You might also find useful</h3>${related.map((r) => `<a href="${esc(r.path)}" class="related-link">${esc(r.title)}</a>`).join('')}</div>`
    : '';
  const t = cleanWriting(title);
  const map = {
    TITLE_TAG: esc(t) + BRAND_SUFFIX,
    DESC: esc(cleanWriting(meta_description)),
    URL: `${SITE}/blog/posts/${slug}`,
    JSONLD: ldSafe(jsonLd({ title: t, meta_description: cleanWriting(meta_description), slug, faqs: article.faqs || [], date, modified, keyword: article.keyword })),
    CRUMB: esc(shortTitle(t)),
    TAG: esc(article.category || 'Moving Advice'),
    H1: esc(t),
    DATE: fmtDate(date),
    MINS: String(Math.max(1, Math.round(countWords(body) / 200))),
    BODY: body,
    RELATED: relatedHtml,
    YEAR: String(new Date(modified + 'T00:00:00Z').getUTCFullYear()),
  };
  let html = TEMPLATE;
  for (const [k, v] of Object.entries(map)) html = html.split(`{{${k}}}`).join(v);
  if (/\{\{[A-Z0-9_]+\}\}/.test(html)) throw new Error('Template placeholder left unfilled');
  return html;
}

// The "Published" date of an existing page (ISO), so an update keeps its original date.
// Pages carry it in different forms: "2026-09-22", "2026-09-22" with spaces, or "3 Jun 2025".
export function publishedDateOf(html) {
  const iso = String(html).match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const txt = String(html).match(/"datePublished"\s*:\s*"(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})"/) || String(html).match(/Published\s+(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (txt) { const m = MONTHS.findIndex((x) => x.toLowerCase() === txt[2].toLowerCase()); if (m >= 0) return `${txt[3]}-${String(m + 1).padStart(2, '0')}-${String(txt[1]).padStart(2, '0')}`; }
  return null;
}

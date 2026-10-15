// ════════════════════════════════════════════════════════════
//  Turns an APPROVED revision into the text of a scheduled post file, and
//  checks whether a file already equals an approved revision. Pure functions.
// ════════════════════════════════════════════════════════════
import { cleanWriting } from './seo-quality-lib.mjs';

const TITLE_SUFFIX = ' | Medway Kent Removals';
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const norm = (s) => cleanWriting(decode(s)).replace(/\s+/g, ' ').trim();

export function articleInner(html) {
  const m = String(html).match(/<article\b[^>]*>([\s\S]*)<\/article>/i);
  return m ? m[1] : null;
}

export function renderInner(rev) {
  const meta = rev.meta || {};
  return `\n<h1>${esc(rev.title)}</h1>\n${meta.blog_meta_html || ''}\n${rev.content}\n`;
}

export function matchesRevision(fileHtml, rev) {
  const inner = articleInner(fileHtml);
  return inner !== null && norm(inner) === norm(renderInner(rev));
}

// Rewrites the article body, <title>, meta description, social tags and the
// BlogPosting structured data of an existing scheduled file. Nothing else is touched.
export function renderFile(fileHtml, rev) {
  let html = String(fileHtml);
  if (articleInner(html) === null) throw new Error('The file has no <article> to replace');
  html = html.replace(/(<article\b[^>]*>)[\s\S]*(<\/article>)/i, (_, open, close) => open + renderInner(rev) + close);
  const title = rev.title + TITLE_SUFFIX;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  const d = esc(rev.meta_description || '');
  html = html.replace(/(<meta\s+name=["']description["']\s+content=["'])[\s\S]*?(["'])/i, `$1${d}$2`);
  html = html.replace(/(<meta\s+property=["']og:title["']\s+content=["'])[\s\S]*?(["'])/i, `$1${esc(title)}$2`);
  html = html.replace(/(<meta\s+property=["']og:description["']\s+content=["'])[\s\S]*?(["'])/i, `$1${d}$2`);
  html = html.replace(/(<meta\s+name=["']twitter:title["']\s+content=["'])[\s\S]*?(["'])/i, `$1${esc(title)}$2`);
  html = html.replace(/(<meta\s+name=["']twitter:description["']\s+content=["'])[\s\S]*?(["'])/i, `$1${d}$2`);
  html = html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/gi, (m, a, json, c) => {
    try {
      const j = JSON.parse(json);
      const fix = (n) => { if (n && n['@type'] === 'BlogPosting') { n.headline = rev.title; if (rev.meta_description) n.description = rev.meta_description; } return n; };
      return a + JSON.stringify(Array.isArray(j) ? j.map(fix) : fix(j)) + c;
    } catch { return m; }
  });
  return html;
}

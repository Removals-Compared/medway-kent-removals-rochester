// Reads one of the old auto-publishing queue files (blog/scheduled/YYYY-MM-DD-slug.html)
// into the shape the approval queue stores. Pure: no files, no database.
export function parseQueuedPost(html, filename) {
  const m = String(filename).match(/^(\d{4}-\d{2}-\d{2})-(.+)\.html$/);
  if (!m) throw new Error(`Not a queue file name: ${filename}`);
  const [, date, slug] = m;
  const grab = (re) => { const x = html.match(re); return x ? x[1].trim() : ''; };
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const title = decode(grab(/<title[^>]*>([\s\S]*?)<\/title>/i)).replace(/\s*\|\s*Medway,?\s*(?:&|and)?\s*Kent Removals\s*$/i, '').trim();
  const meta_description = decode(grab(/<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i));
  const art = html.match(/<article\b[^>]*>([\s\S]*)<\/article>/i);
  if (!art) throw new Error(`No <article> in ${filename}`);
  let inner = art[1].trim();
  const h1 = (inner.match(/^<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || title;
  inner = inner.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '');
  const blogMeta = (inner.match(/^<p class="blog-meta">[\s\S]*?<\/p>/i) || [''])[0];
  inner = inner.replace(/^<p class="blog-meta">[\s\S]*?<\/p>\s*/i, '');
  return { date, slug, title: decode(h1.replace(/<[^>]+>/g, '')).trim() || title, meta_description, content: inner.trim(), blog_meta_html: blogMeta, source_file: filename };
}

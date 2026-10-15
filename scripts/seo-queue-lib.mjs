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

// A LIVE post in the old bare format (blog/posts/<slug>.html): same shape as a queue file,
// but the slug comes from the file name and the date from the structured data.
export function parseBarePost(html, slug) {
  const art = String(html).match(/<article class="blog-post"[^>]*>([\s\S]*)<\/article>/i);
  if (!art) throw new Error(`${slug} is not in the bare post format`);
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const grab = (re) => { const m = html.match(re); return m ? m[1].trim() : ''; };
  let inner = art[1].trim();
  const h1 = (inner.match(/^<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  inner = inner.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '');
  const blogMeta = (inner.match(/^<p class="blog-meta">[\s\S]*?<\/p>/i) || [''])[0];
  inner = inner.replace(/^<p class="blog-meta">[\s\S]*?<\/p>\s*/i, '');
  const titleTag = decode(grab(/<title[^>]*>([\s\S]*?)<\/title>/i)).replace(/\s*\|[^|]*$/, '').trim();
  return {
    slug, title: decode(h1.replace(/<[^>]+>/g, '')).trim() || titleTag,
    meta_description: decode(grab(/<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i)),
    content: inner.trim(), blog_meta_html: blogMeta,
    date: (html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/) || [])[1] || null,
  };
}

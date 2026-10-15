// ════════════════════════════════════════════════════════════
//  Featured images for blog articles. The picture is written into the article
//  text itself (the first element), so whatever the owner approves is exactly
//  what is published, through either publishing route. Pure functions.
// ════════════════════════════════════════════════════════════
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const figureHtml = ({ file, alt, width, height }) =>
  `<figure class="post-figure" style="margin:0 0 28px"><img src="${esc(file)}" alt="${esc(alt)}" width="${width}" height="${height}" decoding="async" fetchpriority="high" style="width:100%;height:auto;border-radius:12px;display:block"></figure>`;

export const hasFigure = (content, file) => String(content).includes(`src="${file}"`);

export function withFigure(content, entry) {
  if (hasFigure(content, entry.file)) return String(content);
  return figureHtml(entry) + '\n' + String(content).trimStart();
}

// The first image in an article body that lives in /images/blog/ (used for og:image and structured data).
export function firstBlogImage(content) {
  const m = String(content).match(/<img\b[^>]*\bsrc="(\/images\/blog\/[^"]+)"/i);
  return m ? m[1] : null;
}

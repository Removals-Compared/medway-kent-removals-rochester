// Adds a Klarna-pink "Instant quote & pay" button right after each primary
// "Get a Free Quote" call to action in the page content (not the header, the
// mobile menu or the footer). Idempotent: a CTA that already has the button
// next to it is skipped. Run: node scripts/add-instant-quote-button.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'admin', 'print', 'quotes', 'drop-lists', 'seo', 'tests', 'api', 'scripts', 'images', 'fonts']);
const SKIP_FILES = new Set(['instant-quote.html', 'booking-confirmed.html', 'thank-you.html', 'header-block.html', 'footer-block.html', 'hero-block.html']);
const dry = process.argv.includes('--dry');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out); }
    else if (e.name.endsWith('.html') && !SKIP_FILES.has(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const attr = (a, n) => (a.match(new RegExp(`\\b${n}="([^"]*)"`, 'i')) || [])[1];

export function addButtons(html) {
  let added = 0;
  const out = html.replace(ANCHOR, (whole, attrs, inner, offset, full) => {
    const href = attr(attrs, 'href') || '';
    const cls = attr(attrs, 'class') || '';
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!/^\/contact/.test(href)) return whole;
    if (!/(^|\s)(btn-primary|hero-v2-btn-primary)(\s|$)/.test(cls)) return whole;
    if (/nav-cta|mob-nav-link|footer-cta/.test(cls)) return whole;
    if (!/quote/i.test(text)) return whole;
    // already followed by the button?
    if (/^\s*<a\b[^>]*btn-klarna/i.test(full.slice(offset + whole.length, offset + whole.length + 300))) return whole;
    const style = attr(attrs, 'style');
    const hero = /hero-v2-btn-primary/.test(cls);
    const newCls = hero ? 'hero-v2-btn-primary hero-v2-btn-klarna' : 'btn btn-klarna';
    added += 1;
    return `${whole}<a href="/instant-quote?src=cta" class="${newCls}"${style ? ` style="${style}"` : ''}>Instant quote &amp; pay <span class="btn-klarna-k">Klarna</span></a>`;
  });
  return { out, added };
}

if (process.argv[1] && process.argv[1].endsWith('add-instant-quote-button.mjs')) {
  let files = 0, buttons = 0;
  for (const f of walk(ROOT)) {
    const html = fs.readFileSync(f, 'utf8');
    const { out, added } = addButtons(html);
    if (added) { files += 1; buttons += added; if (!dry) fs.writeFileSync(f, out); }
  }
  console.log(`${dry ? '[dry run] ' : ''}${buttons} buttons added across ${files} pages`);
}

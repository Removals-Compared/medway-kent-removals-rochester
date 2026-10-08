// ════════════════════════════════════════════════════════════
//  IndexNow: tells Bing (and other IndexNow engines) the moment
//  pages change, instead of waiting for a crawl. On push, the
//  GitHub Action passes the changed files; a manual run submits
//  every URL in the sitemap.
// ════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';

const HOST = 'www.medwaykentremovals.co.uk';
const KEY = '9f7c844181c489377fcd1b5b2afa99ba';
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));

function toUrl(file) {
  if (!file.endsWith('.html')) return null;
  if (file.startsWith('admin/') || file.includes('-block.')) return null;
  if (file === 'index.html') return `https://${HOST}/`;
  return `https://${HOST}/` + file.replace(/\.html$/, '');
}

let urls = [];
const changed = (process.env.CHANGED_FILES || '').split('\n').map((s) => s.trim()).filter(Boolean);
if (changed.length) {
  urls = changed.map(toUrl).filter(Boolean);
} else {
  const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}
urls = [...new Set(urls)].slice(0, 10000);
if (!urls.length) { console.log('No URLs to submit.'); process.exit(0); }

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: urls,
  }),
});
console.log(`Submitted ${urls.length} URLs to IndexNow: HTTP ${res.status}`);
if (res.status >= 300) { console.log(await res.text()); process.exit(1); }

// ════════════════════════════════════════════════════════════
//  Applies the fixes you APPROVED to the files in this checkout. It never
//  pushes anything itself: the workflow puts the result on a preview branch for
//  you to look at before it can reach the live site.
//
//    node scripts/seo-fixes-apply.mjs --edit     change files; record which fixes were applied
//    node scripts/seo-fixes-apply.mjs --mark     (after a successful push) mark them applied
//
//  Each change first checks the page still says what the proposal started from;
//  if not, it is skipped and marked "conflict" instead of overwriting anything.
//  Only blog posts can have titles, descriptions or links changed.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { applyTitle, applyDescription, applyRelatedLink, removeSitemapEntry, addSitemapEntry, isPost } from '../seo/lib/seo-fixes-lib.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://www.medwaykentremovals.co.uk';
const STATE = path.join(ROOT, '.seo-fixes-applied.json');
const mode = process.argv.includes('--mark') ? 'mark' : 'edit';
if (!process.env.DATABASE_URL) { console.log('No DATABASE_URL: nothing to apply.'); process.exit(0); }
const { neon } = await import('@neondatabase/serverless');
const q = (t, p = []) => neon(process.env.DATABASE_URL).query(t, p);

if (mode === 'mark') {
  if (!fs.existsSync(STATE)) { console.log('Nothing was applied, nothing to mark.'); process.exit(0); }
  const ids = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  if (ids.length) await q(`UPDATE seo_fixes SET status='applied', applied_at=now(), applied_branch=$2 WHERE id = ANY($1::bigint[]) AND status='approved'`, [ids, process.env.BRANCH || null]);
  await q(`INSERT INTO seo_activity (actor, action, detail) VALUES ('fixes','fixes_applied',$1)`, [`${ids.length} change(s) on branch ${process.env.BRANCH || '?'}`]);
  fs.unlinkSync(STATE);
  console.log(`${ids.length} fix(es) marked as applied on ${process.env.BRANCH || 'the branch'}.`);
  process.exit(0);
}

const rows = await q(`SELECT id, path, kind, before_text, after_text FROM seo_fixes WHERE status='approved' ORDER BY id`);
const fileFor = (p) => (p === '/' ? 'index.html' : p.slice(1) + '.html');
const cache = new Map(), changed = new Set();
const read = (f) => { if (!cache.has(f)) cache.set(f, fs.readFileSync(path.join(ROOT, f), 'utf8')); return cache.get(f); };
const ids = []; let conflicts = 0;
const conflict = async (r, why) => { conflicts++; console.log(`SKIPPED ${r.kind} ${r.path}: ${why}`); await q(`UPDATE seo_fixes SET status='conflict', note=$2 WHERE id=$1`, [r.id, why.slice(0, 300)]); };

for (const r of rows) {
  try {
    if (['title', 'meta_description', 'related_link'].includes(r.kind) && !isPost(r.path)) { await conflict(r, 'only blog posts can be edited by this tool'); continue; }
    let file, res;
    if (r.kind === 'sitemap_remove') { file = 'sitemap.xml'; res = removeSitemapEntry(read(file), r.path, SITE); }
    else if (r.kind === 'sitemap_add') { file = 'sitemap.xml'; res = addSitemapEntry(read(file), r.path, SITE, new Date().toISOString().slice(0, 10)); }
    else {
      file = isPost(r.path) ? path.join('blog', 'posts', r.path.slice('/blog/posts/'.length) + '.html') : fileFor(r.path);
      if (!fs.existsSync(path.join(ROOT, file))) { await conflict(r, 'the page no longer exists'); continue; }
      const html = read(file);
      res = r.kind === 'title' ? applyTitle(html, r.before_text, r.after_text) : r.kind === 'meta_description' ? applyDescription(html, r.before_text, r.after_text) : applyRelatedLink(html, r.after_text);
    }
    if (!res.ok) { await conflict(r, res.why); continue; }
    if (res.html !== read(file)) { cache.set(file, res.html); changed.add(file); }
    ids.push(Number(r.id));
  } catch (e) { await conflict(r, String(e.message)); }
}
for (const f of changed) fs.writeFileSync(path.join(ROOT, f), cache.get(f));
fs.writeFileSync(STATE, JSON.stringify(ids));
console.log(`${ids.length} approved change(s) applied to ${changed.size} file(s); ${conflicts} skipped.`);

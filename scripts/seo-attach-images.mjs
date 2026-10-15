// ════════════════════════════════════════════════════════════
//  Adds each article's featured image (seo/data/blog-images.json) as a NEW
//  version of the article, so you read and approve the picture together with the
//  text. Nothing is published or approved here.
//
//  * Only articles that are awaiting approval or need changes are touched.
//  * An article already approved, publishing, published or archived is skipped
//    (changing it would withdraw its approval).
//  * Articles that already carry their picture are skipped, so it is safe to re-run.
//  * Every picture file must already be on the site (images/blog/).
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { withFigure, hasFigure } from '../seo/lib/seo-images-lib.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
if (!process.env.DATABASE_URL) { console.log('DATABASE_URL is not set.'); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'seo', 'data', 'blog-images.json'), 'utf8')).images;
const { neon } = await import('@neondatabase/serverless');
const q = (t, p) => neon(process.env.DATABASE_URL).query(t, p);
const { saveRevision } = await import('../api/admin/_seo.mjs');

let added = 0, already = 0, skipped = 0, missing = 0;
for (const [slug, entry] of Object.entries(manifest)) {
  const rows = await q(
    `SELECT a.id, a.status, r.title, r.meta_description, r.content
       FROM seo_articles a JOIN seo_article_revisions r ON r.id = a.current_revision_id WHERE a.slug = $1`, [slug]);
  const a = rows[0];
  if (!a) { console.log(`- ${slug}: no such article, skipped`); missing++; continue; }
  if (!fs.existsSync(path.join(ROOT, entry.file.replace(/^\//, '')))) { console.log(`- ${slug}: picture file ${entry.file} is not in the repository, skipped`); missing++; continue; }
  if (!['awaiting_approval', 'needs_revision'].includes(a.status)) { console.log(`- ${slug}: is ${a.status.replace(/_/g, ' ')}, left alone`); skipped++; continue; }
  if (hasFigure(a.content, entry.file)) { console.log(`- ${slug}: already has its picture`); already++; continue; }
  const r = await saveRevision(a.id, { title: a.title, meta_description: a.meta_description, content: withFigure(a.content, entry), image: entry }, 'image-attach');
  console.log(`+ ${slug}: picture added (new version, ${r.status || 'awaiting approval'})`);
  added++;
}
console.log(`Done: ${added} article(s) got a picture, ${already} already had one, ${skipped} left alone, ${missing} skipped (missing).`);
console.log('Nothing was approved or published. Review the new versions in the admin (Content tab).');

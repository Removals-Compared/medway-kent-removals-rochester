// ════════════════════════════════════════════════════════════
//  Writes APPROVED, changed versions of queued posts into their scheduled
//  files, so publish-due.mjs can publish exactly what you approved.
//  Runs before publish-due.mjs in .github/workflows/publish-scheduled-posts.yml.
//
//  Only articles with a valid approval of their current version are written.
//  A post that is already live (in blog/posts) is never touched.
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { renderFile, matchesRevision } from './seo-sync-lib.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
if (!process.env.DATABASE_URL) { console.log('No DATABASE_URL: nothing to sync (and nothing will publish).'); process.exit(0); }
const { neon } = await import('@neondatabase/serverless');
const q = (t, p) => neon(process.env.DATABASE_URL).query(t, p);

let rows;
try {
  rows = await q(
    `SELECT a.id, a.slug, r.title, r.meta_description, r.content, r.meta, r.content_hash
       FROM seo_articles a JOIN seo_article_revisions r ON r.id = a.current_revision_id
      WHERE a.source = 'scheduled_queue' AND a.status IN ('approved','publishing')
        AND EXISTS (SELECT 1 FROM seo_approvals p WHERE p.revision_id = r.id AND p.decision = 'approve' AND p.content_hash = r.content_hash)`, []);
} catch (e) { console.log('Approval queue unreachable, nothing synced: ' + String(e.message).slice(0, 80)); process.exit(0); }

let n = 0;
for (const r of rows) {
  const file = r.meta && r.meta.source_file;
  if (!file) continue;
  const scheduled = path.join(ROOT, 'blog', 'scheduled', file);
  const live = path.join(ROOT, 'blog', 'posts', file.replace(/^\d{4}-\d{2}-\d{2}-/, ''));
  if (!fs.existsSync(scheduled) || fs.existsSync(live)) continue;
  const html = fs.readFileSync(scheduled, 'utf8');
  if (matchesRevision(html, r)) continue;
  fs.writeFileSync(scheduled, renderFile(html, r));
  n++;
  console.log(`synced ${file} to the approved version`);
}
console.log(n ? `${n} scheduled file(s) updated to match approvals` : 'scheduled files already match approvals');

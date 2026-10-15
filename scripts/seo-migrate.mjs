// ════════════════════════════════════════════════════════════
//  Applies the idempotent schema files in admin/ (SEO-SCHEMA-*.sql) to the
//  database in DATABASE_URL. Statements only (no $$ function bodies), run one
//  at a time. Safe to run repeatedly. Run by .github/workflows/seo-migrate.yml.
//
//    node scripts/seo-migrate.mjs                 apply every admin/SEO-SCHEMA-*.sql
//    node scripts/seo-migrate.mjs admin/SEO-SCHEMA-AI.sql
// ════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2); }
const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

export function statements(text) {
  if (/\$\$/.test(text)) throw new Error('This file uses $$ function bodies; run it in the Neon SQL editor instead.');
  return text.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
}

const files = process.argv[2] ? [process.argv[2]] : fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => /^SEO-SCHEMA-.+\.sql$/.test(f)).sort().map((f) => path.join('admin', f));
for (const f of files) {
  const list = statements(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const s of list) await sql.query(s, []);
  console.log(`${f}: ${list.length} statements applied`);
}

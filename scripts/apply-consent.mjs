// Adds the cookie-consent code (Google Consent Mode defaults, gated ads pixel, banner script)
// to every public page that loads tracking. Idempotent. Run:  npm run apply-consent
// The daily publisher runs the same step for blog posts, so new posts are covered automatically.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyConsent } from '../seo/lib/seo-consent-lib.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const files = execFileSync('git', ['ls-files', '*.html'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter((f) => !/^(admin|print|node_modules)\//.test(f));
let changed = 0, failed = 0;
for (const f of files) {
  const before = fs.readFileSync(path.join(ROOT, f), 'utf8');
  try {
    const after = applyConsent(before);
    if (after !== before) { fs.writeFileSync(path.join(ROOT, f), after); changed++; }
  } catch (e) { console.log(`FAILED ${f}: ${e.message}`); failed++; }
}
console.log(`${changed} page(s) updated, ${files.length - changed - failed} already fine or without tracking, ${failed} failed.`);
process.exit(failed ? 1 : 0);

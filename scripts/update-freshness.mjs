// ════════════════════════════════════════════════════════════
//  Refreshes the visible "Page last updated ..." footer stamps.
//  Runs weekly via GitHub Actions but only rewrites the dates
//  once the newest stamp is 21 days old, giving an effective
//  three-week refresh cycle. Touches the stamps only; dated
//  claims like "prices checked" are deliberately left alone,
//  because a date like that should only move when a human
//  actually checks.
// ════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const STAMP_RE = /Page last updated \d{1,2} [A-Z][a-z]+ \d{4}/g;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const REFRESH_DAYS = 21;

function parseStamp(text) {
  const m = text.match(/Page last updated (\d{1,2}) ([A-Z][a-z]+) (\d{4})/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]);
  if (month < 0) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
}

function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const files = htmlFiles(ROOT);
const blocksPath = path.join(ROOT, 'scripts/.svc-template-blocks.json');

// How old is the freshest stamp on the site?
let newest = null;
for (const f of files) {
  const d = parseStamp(fs.readFileSync(f, 'utf8'));
  if (d && (!newest || d > newest)) newest = d;
}
if (!newest) {
  console.log('No stamps found; nothing to do.');
  process.exit(0);
}
const ageDays = Math.floor((Date.now() - newest.getTime()) / 86400000);
console.log(`Newest stamp: ${newest.toISOString().slice(0, 10)} (${ageDays} days old)`);
if (ageDays < REFRESH_DAYS) {
  console.log(`Younger than ${REFRESH_DAYS} days; no refresh needed.`);
  process.exit(0);
}

const now = new Date();
const todayStamp = `Page last updated ${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
let changed = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  if (!STAMP_RE.test(s)) continue;
  fs.writeFileSync(f, s.replace(STAMP_RE, todayStamp));
  changed++;
}
if (fs.existsSync(blocksPath)) {
  const s = fs.readFileSync(blocksPath, 'utf8');
  if (STAMP_RE.test(s)) {
    fs.writeFileSync(blocksPath, s.replace(STAMP_RE, todayStamp));
    changed++;
  }
}
console.log(`Refreshed ${changed} files to "${todayStamp}".`);

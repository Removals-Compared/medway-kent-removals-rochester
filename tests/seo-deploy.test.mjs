// Guards against the 2026-10-15 outage: the SEO function imported files from
// scripts/, which .vercelignore keeps off Vercel, so it crashed on start.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const ignored = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const isIgnored = (rel) => ignored.some((p) => { const d = p.replace(/\/$/, ''); return rel === d || rel.startsWith(d + '/'); });

function closure(entry) {
  const seen = new Set(), todo = [entry];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const spec = m[1] || m[2];
      todo.push(path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, f)), spec)));
    }
  }
  return [...seen];
}

test('every file the SEO function loads is deployed to Vercel', () => {
  const files = closure('api/admin/seo.mjs');
  assert.ok(files.length >= 6, 'found the import chain: ' + files.join(', '));
  assert.ok(files.some((f) => f.startsWith('seo/lib/')), 'shared libraries live in seo/lib');
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
    assert.equal(isIgnored(f), false, `${f} is excluded by .vercelignore, so the live function would crash`);
  }
});

test('the facts the quality check reads at run time are bundled with the function', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const inc = v.functions['api/admin/seo.mjs'].includeFiles;
  assert.ok(inc.includes('pricing.md') && inc.includes('seo/business-facts.json'));
  for (const f of ['pricing.md', 'seo/business-facts.json']) { assert.ok(fs.existsSync(path.join(ROOT, f))); assert.equal(isIgnored(f), false, `${f} must not be ignored`); }
});

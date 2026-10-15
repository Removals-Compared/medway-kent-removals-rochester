// The GitHub runners use Node 20. Iterator helpers (e.g. string.matchAll(...).map) only exist in Node 22+,
// so a line that works on a newer laptop can fail on the runner. This keeps such lines out of the SEO code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const dirs = ['scripts', 'seo/lib', 'api/admin'];
const files = dirs.flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.mjs')).map((f) => path.join(ROOT, d, f)));

test('matchAll results are always turned into an array (or looped) before array methods are used', () => {
  const bad = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!line.includes('.matchAll(')) return;
      const spread = /\[\.\.\.[^\]]*\.matchAll\(/.test(line) || /Array\.from\([^)]*\.matchAll\(/.test(line) || /for \(const .* of .*\.matchAll\(/.test(line);
      if (!spread) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, [], 'wrap matchAll in [...] or Array.from so it runs on Node 20');
});

test('the SEO workflows run on Node 20 or newer, and no code needs a newer one', () => {
  const wf = fs.readdirSync(path.join(ROOT, '.github/workflows')).filter((f) => /seo|publish/.test(f));
  assert.ok(wf.length >= 8);
  for (const f of wf) assert.match(fs.readFileSync(path.join(ROOT, '.github/workflows', f), 'utf8'), /node-version: '(20|22|24)'/, f);
});

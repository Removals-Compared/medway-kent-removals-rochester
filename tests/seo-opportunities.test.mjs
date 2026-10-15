import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpportunities, typicalCtr } from '../scripts/seo-opportunities-lib.mjs';

const P = (path) => 'https://www.medwaykentremovals.co.uk' + path;
const row = (query, path, clicks, impressions, position) => ({ query, page: P(path), clicks, impressions, position });
const run = (rows, extra = {}) => buildOpportunities({ rows, ...extra });
const types = (o) => o.map((x) => x.type);

test('typical click rate falls as position worsens', () => {
  assert.ok(typicalCtr(1) > typicalCtr(3) && typicalCtr(3) > typicalCtr(10));
  assert.equal(typicalCtr(0.4), typicalCtr(1));
  assert.equal(typicalCtr(40), typicalCtr(10));
});

test('striking distance: positions 8-20 with enough views, carries its evidence', () => {
  const o = run([row('removals chatham', '/removals-chatham', 1, 120, 11.4), row('tiny', '/x', 0, 5, 12), row('top', '/y', 40, 300, 2), row('deep', '/z', 0, 200, 35)]);
  const hits = o.filter((x) => x.type === 'striking_distance');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].query, 'removals chatham');
  assert.deepEqual(hits[0].evidence, { impressions: 120, clicks: 1, position: 11.4, ctr_pct: 0.8 });
  assert.ok(hits[0].potential_clicks > 0);
});

test('low click rate: only flagged when well under the typical rate for that position', () => {
  const bad = run([row('man and van medway', '/man-and-van', 2, 400, 3)]);   // 0.5% at position 3
  assert.ok(types(bad).includes('low_ctr'));
  const fine = run([row('man and van medway', '/man-and-van', 44, 400, 3)]); // 11% at position 3
  assert.ok(!types(fine).includes('low_ctr'));
  const small = run([row('x', '/x', 0, 10, 2)]);                              // too few views to judge
  assert.ok(!types(small).includes('low_ctr'));
});

test('cannibalisation: two of your pages sharing one search', () => {
  const o = run([row('storage rochester', '/storage', 3, 80, 9), row('storage rochester', '/removals-rochester', 1, 40, 14), row('only one', '/a', 1, 30, 5), row('only one', '/b', 0, 2, 40)]);
  const c = o.filter((x) => x.type === 'cannibalisation');
  assert.equal(c.length, 1);
  assert.equal(c[0].query, 'storage rochester');
  assert.equal(c[0].evidence.pages.length, 2);
  assert.match(c[0].action, /\/storage/);
});

test('declining page: needs a real earlier level and a real drop', () => {
  const pageTotals = {
    cur: [{ page: P('/a'), clicks: 5 }, { page: P('/b'), clicks: 9 }, { page: P('/c'), clicks: 1 }],
    prev: [{ page: P('/a'), clicks: 20 }, { page: P('/b'), clicks: 10 }, { page: P('/c'), clicks: 3 }],
  };
  const d = run([], { pageTotals }).filter((x) => x.type === 'declining_page');
  assert.equal(d.length, 1);
  assert.equal(d[0].page, P('/a'));
  assert.equal(d[0].evidence.change_pct, -75);
  assert.match(d[0].action, /not why/);
});

test('place gap: names a town with no removals page, and never claims coverage', () => {
  const sitePages = [{ path: '/removals-chatham', page_type: 'town' }, { path: '/removals-herne-bay', page_type: 'town' }];
  const rows = [row('removals broadstairs', '/', 0, 40, 30), row('removals chatham', '/removals-chatham', 4, 90, 5), row('removals herne bay', '/removals-herne-bay', 2, 60, 6), row('removals near me', '/', 0, 80, 50)];
  const g = run(rows, { sitePages }).filter((x) => x.type === 'place_gap');
  assert.deepEqual(g.map((x) => x.evidence.place), ['broadstairs']);
  assert.match(g[0].action, /Confirm you really cover/);
  assert.match(g[0].action, /Do not publish a page that only swaps the place name/);
});

test('dismissed searches are left out', () => {
  const rows = [row('removals chatham', '/removals-chatham', 1, 120, 11)];
  assert.equal(run(rows, { ignored: new Set(['removals chatham']) }).length, 0);
});

test('results are ranked, highest value first, and every one has evidence and an action', () => {
  const o = run([row('a', '/a', 0, 500, 12), row('b', '/b', 0, 50, 12), row('c', '/c', 0, 200, 12)]);
  assert.deepEqual(o.map((x) => x.query), ['a', 'c', 'b']);
  o.forEach((x) => { assert.ok(x.evidence && x.action && x.title); });
});

test('no data, no opportunities (nothing is invented)', () => {
  assert.deepEqual(run([]), []);
});

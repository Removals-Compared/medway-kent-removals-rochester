// ════════════════════════════════════════════════════════════
//  Opportunity rules over real Search Console data (pure functions).
//  Nothing here invents numbers: every opportunity carries the figures it
//  was based on. "potential_clicks" is a rough estimate from typical click
//  rates by position, not a forecast.
// ════════════════════════════════════════════════════════════

export const DEFAULTS = {
  strikingMinImpr: 20,      // impressions in the window
  strikingFrom: 8,
  strikingTo: 20,
  lowCtrMinImpr: 50,
  lowCtrRatio: 0.5,         // flag when CTR is under half the typical rate
  declineMinPrevClicks: 8,
  declinePct: 0.3,
  cannibalMinImpr: 10,
  cannibalShare: 0.25,
  gapMinImpr: 10,
};

// Rough typical click-through rate by Google position (a rule of thumb).
const TYPICAL_CTR = { 1: 0.28, 2: 0.15, 3: 0.10, 4: 0.07, 5: 0.05, 6: 0.04, 7: 0.03, 8: 0.025, 9: 0.02, 10: 0.018 };
export const typicalCtr = (pos) => TYPICAL_CTR[Math.max(1, Math.min(10, Math.round(pos)))];

// Towns and villages around Medway and Kent. A search that names one of these
// where there is no matching page on the site is a possible gap. It is NOT a
// statement that the business covers the place: that must be confirmed first.
export const KENT_PLACES = [
  'ashford', 'aylesford', 'bearsted', 'broadstairs', 'canterbury', 'chatham', 'cliffe', 'cranbrook',
  'dartford', 'deal', 'dover', 'edenbridge', 'faversham', 'folkestone', 'gillingham', 'gravesend', 'greenhithe',
  'hawkhurst', 'hempstead', 'herne bay', 'hoo', 'hythe', 'kemsley', 'larkfield', 'lenham', 'lordswood', 'maidstone',
  'margate', 'minster', 'new romney', 'northfleet', 'paddock wood', 'rainham', 'ramsgate', 'rochester', 'sandwich',
  'sevenoaks', 'sheerness', 'sittingbourne', 'snodland', 'strood', 'swanley', 'tenterden', 'tonbridge',
  'tunbridge wells', 'walderslade', 'west malling', 'westerham', 'whitstable', 'wrotham',
];

const slug = (s) => s.replace(/\s+/g, '-');
const pathOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/, '') || '/';
const round1 = (n) => Math.round(n * 10) / 10;
const pct = (n) => Math.round(n * 1000) / 10;

function placeIn(query) {
  const q = ` ${query.toLowerCase()} `;
  return KENT_PLACES.find((p) => q.includes(` ${p} `)) || null;
}

// rows: [{query, page, clicks, impressions, position}] for the current window
// pageTotals: {cur: [{page, clicks}], prev: [{page, clicks}]}
// sitePages: [{url, path, page_type, title}]
// ignored: Set of lowercase queries the owner dismissed
export function buildOpportunities({ rows, pageTotals = { cur: [], prev: [] }, sitePages = [], ignored = new Set() }, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg };
  const out = [];
  const skip = (q) => ignored.has(q.toLowerCase());

  for (const r of rows) {
    if (skip(r.query)) continue;
    const ctr = r.impressions ? r.clicks / r.impressions : 0;

    if (r.position >= c.strikingFrom && r.position <= c.strikingTo && r.impressions >= c.strikingMinImpr) {
      const gain = Math.max(0, r.impressions * (0.05 - ctr));
      out.push({
        type: 'striking_distance', query: r.query, page: r.page, score: gain,
        potential_clicks: Math.round(gain),
        evidence: { impressions: r.impressions, clicks: r.clicks, position: round1(r.position), ctr_pct: pct(ctr) },
        title: `"${r.query}" is just off page one`,
        action: `This page is at about position ${round1(r.position)} for "${r.query}". Make the title, main heading and one section answer that search directly, and link to it from related pages.`,
      });
    }

    if (r.position <= 10 && r.impressions >= c.lowCtrMinImpr) {
      const typ = typicalCtr(r.position);
      if (ctr < typ * c.lowCtrRatio) {
        const gain = r.impressions * (typ * 0.75 - ctr);
        out.push({
          type: 'low_ctr', query: r.query, page: r.page, score: Math.max(0, gain),
          potential_clicks: Math.max(0, Math.round(gain)),
          evidence: { impressions: r.impressions, clicks: r.clicks, position: round1(r.position), ctr_pct: pct(ctr), typical_ctr_pct: pct(typ) },
          title: `"${r.query}" is seen but rarely clicked`,
          action: `People see this page at about position ${round1(r.position)} but only ${pct(ctr)}% click (a typical rate there is roughly ${pct(typ)}%). Rewrite the title and meta description so they match the search and give a reason to click.`,
        });
      }
    }
  }

  // Cannibalisation: one query, two of your pages each getting a real share
  const byQuery = new Map();
  for (const r of rows) byQuery.set(r.query, [...(byQuery.get(r.query) || []), r]);
  for (const [query, list] of byQuery) {
    if (skip(query) || list.length < 2) continue;
    const total = list.reduce((a, r) => a + r.impressions, 0);
    const sorted = [...list].sort((a, b) => b.impressions - a.impressions);
    const [first, second] = sorted;
    if (second.impressions >= c.cannibalMinImpr && second.impressions / total >= c.cannibalShare) {
      out.push({
        type: 'cannibalisation', query, page: first.page, other_page: second.page, score: second.impressions,
        evidence: { impressions: total, pages: sorted.slice(0, 3).map((r) => ({ page: pathOf(r.page), impressions: r.impressions, position: round1(r.position) })) },
        title: `Two pages compete for "${query}"`,
        action: `${pathOf(first.page)} and ${pathOf(second.page)} both appear for this search. Decide which one should win, make the other clearly about something different (or link it to the winner), and avoid near-duplicate wording.`,
      });
    }
  }

  // Declining pages
  const prev = new Map(pageTotals.prev.map((p) => [p.page, p.clicks]));
  for (const p of pageTotals.cur) {
    const before = prev.get(p.page) || 0;
    if (before >= c.declineMinPrevClicks && p.clicks <= before * (1 - c.declinePct)) {
      out.push({
        type: 'declining_page', query: '', page: p.page, score: before - p.clicks,
        evidence: { clicks_now: p.clicks, clicks_before: before, change_pct: pct((p.clicks - before) / before) },
        title: `${pathOf(p.page)} is getting fewer clicks`,
        action: `Clicks fell from ${before} to ${p.clicks} compared with the previous period. Check whether it still matches what people search, whether a competitor moved above it, and whether it needs refreshing. This shows what changed, not why.`,
      });
    }
  }

  // Possible gap: a search that names a place the site has no dedicated page for
  const havePlace = new Set();
  for (const sp of sitePages) {
    const m = String(sp.path || '').match(/^\/removals-([a-z-]+)$/);
    if (m) havePlace.add(m[1]);
  }
  for (const [query, list] of byQuery) {
    if (skip(query)) continue;
    const place = placeIn(query);
    if (!place || havePlace.has(slug(place))) continue;
    const impressions = list.reduce((a, r) => a + r.impressions, 0);
    if (impressions < c.gapMinImpr) continue;
    const best = [...list].sort((a, b) => a.position - b.position)[0];
    out.push({
      type: 'place_gap', query, page: best.page, score: impressions,
      evidence: { impressions, place, best_position: round1(best.position), best_page: pathOf(best.page) },
      title: `Searches name ${place[0].toUpperCase() + place.slice(1)}, which has no page of its own`,
      action: `Confirm you really cover ${place} first. If you do, a useful page with real local detail (access, parking, property types) could rank. Do not publish a page that only swaps the place name.`,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

export const TYPE_LABELS = {
  striking_distance: 'Close to page one',
  low_ctr: 'Seen but not clicked',
  cannibalisation: 'Pages compete',
  declining_page: 'Losing clicks',
  place_gap: 'Possible gap',
};

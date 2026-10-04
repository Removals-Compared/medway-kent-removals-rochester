#!/usr/bin/env node
// Sold-STC drop list: pulls Sold STC / Under offer listings from Rightmove for the
// Medway + Maidstone districts, works out which are fresh, and orders them into
// delivery runs starting and ending at the yard (ME2 2ZE).
//
//   node scripts/sold-stc/drop-list.mjs            # weekly run
//   node scripts/sold-stc/drop-list.mjs --days 42  # first-run freshness window
//   node scripts/sold-stc/drop-list.mjs --cached   # rebuild from today's snapshot
//
// Output (gitignored, never deployed): drop-lists/<date>/drop-list.html + .csv,
// plus drop-lists/snapshots/<date>.json used to spot listings that flipped to
// STC since the previous run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'drop-lists');
const BASE = { name: 'Yard — Knight Templar Way, ME2 2ZE', lat: 51.384353, lng: 0.484489 };

// Rightmove OUTCODE location identifiers
const OUTCODES = {
  ME2: 1619, ME1: 1608, ME3: 1621, ME4: 1622, ME7: 1625,
  ME8: 1626, ME5: 1623, ME14: 1613, ME15: 1614,
};
const TYPES = 'bungalow,detached,flat,semi-detached,terraced';
const SKIP_SUBTYPES = /land|plot|garage|parking|commercial/i;
const AREAS = {
  'Strood & Hoo': ['ME2', 'ME3'],
  'Rochester': ['ME1'],
  'Chatham & Walderslade': ['ME4', 'ME5'],
  'Gillingham & Rainham': ['ME7', 'ME8'],
  'Maidstone': ['ME14', 'ME15'],
};
const RUN_SIZE = 30;       // max stops per delivery run
const MAX_MILES = 20;      // pins further than this from the yard are agent errors
const LINK_STOPS = 9;      // waypoints per Google Maps link (Maps caps at ~10)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const args = process.argv.slice(2);
const DAYS = Number(args[args.indexOf('--days') + 1]) || 42;
const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(id, index, extra = '') {
  const url = `https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=OUTCODE%5E${id}` +
    `&includeSSTC=true&sortType=6&propertyTypes=${encodeURIComponent(TYPES)}&index=${index}${extra}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-GB' } });
    if (res.ok) {
      const m = (await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (m) return JSON.parse(m[1]).props.pageProps.searchResults;
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error(`Rightmove fetch failed: ${url}`);
}

// Rightmove stops paging at ~1,000 results, so big districts are split by price.
async function fetchBand(id, extra) {
  const first = await page(id, 0, extra);
  const out = [...first.properties];
  const total = Number(first.resultCount.replace(/,/g, ''));
  for (let i = 24; i < Math.min(total, 1008); i += 24) {
    await sleep(350);
    const r = await page(id, i, extra);
    if (!r.properties.length) break;
    out.push(...r.properties);
  }
  return { out, total };
}

async function fetchOutcode(code, id) {
  const { out, total } = await fetchBand(id, '');
  if (total <= 1000) return out;
  const bands = ['&maxPrice=250000', '&minPrice=250000&maxPrice=400000', '&minPrice=400000'];
  const all = [];
  for (const b of bands) all.push(...(await fetchBand(id, b)).out);
  return all;
}

const miles = (a, b) => {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// Nearest-neighbour tour from the yard, tidied with 2-opt.
function order(points, start) {
  const left = [...points], tour = [];
  let cur = start;
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (miles(cur, left[i]) < miles(cur, left[bi])) bi = i;
    cur = left.splice(bi, 1)[0];
    tour.push(cur);
  }
  const path_ = [start, ...tour, start];
  for (let improved = true; improved;) {
    improved = false;
    for (let i = 1; i < path_.length - 2; i++) {
      for (let k = i + 1; k < path_.length - 1; k++) {
        const d = miles(path_[i - 1], path_[k]) + miles(path_[i], path_[k + 1]) -
                  miles(path_[i - 1], path_[i]) - miles(path_[k], path_[k + 1]);
        if (d < -1e-9) { path_.splice(i, k - i + 1, ...path_.slice(i, k + 1).reverse()); improved = true; }
      }
    }
  }
  return path_.slice(1, -1);
}

async function roadRoute(coords) {
  try {
    const q = coords.map((c) => `${c.lng},${c.lat}`).join(';');
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${q}?overview=full&geometries=geojson`);
    const j = await r.json();
    if (j.code !== 'Ok') return null;
    return {
      miles: j.routes[0].distance / 1609.34,
      minutes: j.routes[0].duration / 60,
      legs: j.routes[0].legs.map((l) => l.distance / 1609.34),
      line: j.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    };
  } catch { return null; }
}

const mapsLink = (stops, from, to) =>
  'https://www.google.com/maps/dir/?api=1&travelmode=driving' +
  `&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}` +
  `&waypoints=${stops.map((s) => `${s.lat},${s.lng}`).join('%7C')}`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;

// ---------------------------------------------------------------------------

fs.mkdirSync(path.join(OUT, 'snapshots'), { recursive: true });
const prevFile = fs.readdirSync(path.join(OUT, 'snapshots')).filter((f) => f < `${today}.json`).sort().pop();
const prev = prevFile ? JSON.parse(fs.readFileSync(path.join(OUT, 'snapshots', prevFile), 'utf8')) : null;
const prevStc = new Set(prev ? prev.filter((p) => p.status).map((p) => p.id) : []);

// --cached re-uses today's snapshot instead of hitting Rightmove again.
const todayFile = path.join(OUT, 'snapshots', `${today}.json`);
const cached = args.includes('--cached') && fs.existsSync(todayFile);
const seen = new Map(cached ? JSON.parse(fs.readFileSync(todayFile, 'utf8')).map((p) => [p.id, p]) : []);
for (const [code, id] of cached ? [] : Object.entries(OUTCODES)) {
  process.stdout.write(`${code} … `);
  const props = await fetchOutcode(code, id);
  for (const p of props) {
    if (seen.has(p.id)) continue;
    seen.set(p.id, {
      id: p.id, district: code,
      status: p.displayStatus || '',
      address: p.displayAddress,
      lat: p.location?.latitude, lng: p.location?.longitude,
      beds: p.bedrooms, type: p.propertySubType,
      price: p.price?.displayPrices?.[0]?.displayPrice,
      agent: p.customer?.branchDisplayName, agentTel: p.customer?.contactTelephone,
      development: !!p.customer?.development, auction: !!p.auction,
      listed: p.firstVisibleDate?.slice(0, 10),
      lastChange: p.listingUpdate?.listingUpdateDate?.slice(0, 10),
      lastChangeWhy: p.listingUpdate?.listingUpdateReason,
      photo: p.images?.[0]?.srcUrl || p.propertyImages?.mainImageSrc,
      url: `https://www.rightmove.co.uk/properties/${p.id}`,
    });
  }
  console.log(`${props.length} listings, ${props.filter((p) => p.displayStatus).length} STC/under offer`);
}

const snapshot = [...seen.values()];
fs.writeFileSync(path.join(OUT, 'snapshots', `${today}.json`), JSON.stringify(snapshot));

const cutoff = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
const candidates = snapshot.filter((p) =>
  p.status && p.lat && !p.development && !p.auction && !SKIP_SUBTYPES.test(p.type || ''));

for (const p of candidates) {
  // A listing that was listed or re-priced on date X and is now STC went STC after X.
  p.stcAfter = [p.listed, p.lastChange].filter(Boolean).sort().pop();
  p.isNew = prev ? !prevStc.has(p.id) : false;
}
const fresh = prev
  ? candidates.filter((p) => p.isNew)
  : candidates.filter((p) => p.stcAfter >= cutoff);
const badPins = fresh.filter((p) => miles(BASE, p) > MAX_MILES);
const drops = fresh.filter((p) => !badPins.includes(p));
const backlog = candidates.filter((p) => !fresh.includes(p));

// Split an area into k compact groups (k-means on lat/lng, lng scaled for latitude).
function split(points, k) {
  if (k <= 1) return [points];
  const xy = (p) => [p.lat, p.lng * Math.cos(p.lat * Math.PI / 180)];
  const sorted = [...points].sort((a, b) => a.lng - b.lng);
  let cents = Array.from({ length: k }, (_, i) => xy(sorted[Math.floor((i + 0.5) * sorted.length / k)]));
  let groups;
  for (let it = 0; it < 30; it++) {
    groups = cents.map(() => []);
    for (const p of points) {
      const [a, b] = xy(p);
      let bi = 0, bd = Infinity;
      cents.forEach(([x, y], i) => { const d = (a - x) ** 2 + (b - y) ** 2; if (d < bd) { bd = d; bi = i; } });
      groups[bi].push(p);
    }
    cents = groups.map((g, i) => g.length ? [g.reduce((t, p) => t + xy(p)[0], 0) / g.length, g.reduce((t, p) => t + xy(p)[1], 0) / g.length] : cents[i]);
  }
  return groups.filter((g) => g.length);
}

const runs = [];
for (const [area, codes] of Object.entries(AREAS)) {
  const pts = drops.filter((p) => codes.includes(p.district));
  if (!pts.length) continue;
  for (const g of split(pts, Math.ceil(pts.length / RUN_SIZE))) {
    const run = order(g, BASE);
    run.area = area;
    runs.push(run);
  }
}
const tour = runs.flat();

for (const [ri, run] of runs.entries()) {
  run.forEach((s, i) => { s.run = ri + 1; s.stop = i + 1; s.area = run.area; });
  const road = await roadRoute([BASE, ...run, BASE]);
  run.road = road;
  run.forEach((s, i) => {
    s.legMiles = road ? road.legs[i] : miles(i ? run[i - 1] : BASE, s) * 1.3;
  });
  run.totalMiles = road ? road.miles : run.reduce((t, s) => t + s.legMiles, 0) + miles(run.at(-1), BASE) * 1.3;
  run.minutes = road ? road.minutes : null;
  run.links = [];
  for (let i = 0; i < run.length; i += LINK_STOPS) {
    const chunk = run.slice(i, i + LINK_STOPS);
    const from = i ? run[i - 1] : BASE;
    const isLast = i + LINK_STOPS >= run.length;
    run.links.push({
      label: `Stops ${chunk[0].stop}–${chunk.at(-1).stop}${isLast ? ' → yard' : ''}`,
      href: mapsLink(isLast ? chunk : chunk.slice(0, -1), from, isLast ? BASE : chunk.at(-1)),
    });
  }
  await sleep(500);
}

// ---------------------------------------------------------------------------

const dir = path.join(OUT, today);
fs.mkdirSync(dir, { recursive: true });

const cols = ['run', 'area', 'stop', 'district', 'status', 'address', 'beds', 'type', 'price', 'stcAfter', 'listed', 'legMiles', 'agent', 'agentTel', 'lat', 'lng', 'url'];
fs.writeFileSync(path.join(dir, 'drop-list.csv'),
  [cols.join(','), ...tour.map((s) => cols.map((c) => csvCell(c === 'legMiles' ? s[c]?.toFixed(1) : s[c])).join(','))].join('\n'));

const totalMiles = runs.reduce((t, r) => t + r.totalMiles, 0);
const byDistrict = Object.keys(OUTCODES).map((d) => [d, drops.filter((p) => p.district === d).length]);
const colours = ['#1d4ed8', '#b91c1c', '#047857', '#7c3aed', '#c2410c', '#0e7490', '#a16207', '#be185d', '#4d7c0f', '#9333ea', '#0f766e', '#dc2626'];
const mapData = runs.map((r, i) => ({
  colour: colours[i % colours.length],
  line: r.road?.line || [[BASE.lat, BASE.lng], ...r.map((s) => [s.lat, s.lng]), [BASE.lat, BASE.lng]],
  stops: r.map((s) => ({ lat: s.lat, lng: s.lng, n: s.stop, run: s.run, a: s.address })),
}));

const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sold STC drop list ${today}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
:root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);background:var(--bg)}
header{padding:20px 16px 8px;max-width:1200px;margin:auto}h1{margin:0 0 4px;font-size:22px}
.sub{color:var(--muted)}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.stat{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 14px}.stat b{display:block;font-size:20px}
#map{height:62vh;max-width:1200px;margin:0 auto;border-radius:12px;border:1px solid var(--line)}
main{max-width:1200px;margin:auto;padding:0 16px 40px}
.run{background:#fff;border:1px solid var(--line);border-radius:12px;margin:18px 0;overflow:hidden}
.run h2{margin:0;padding:12px 14px;font-size:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line)}
.dot{width:12px;height:12px;border-radius:50%;display:inline-block}
.links{padding:8px 14px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line)}
.links a{background:var(--ink);color:#fff;text-decoration:none;padding:6px 10px;border-radius:8px;font-size:13px}
table{width:100%;border-collapse:collapse}td,th{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600}td img{width:96px;height:64px;object-fit:cover;border-radius:6px}
.tag{font-size:11px;padding:2px 6px;border-radius:6px;background:#dcfce7;color:#166534}.tag.uo{background:#fef9c3;color:#854d0e}
.done td{opacity:.4;text-decoration:line-through}.small{font-size:12px;color:var(--muted)}a{color:#1d4ed8}
@media(max-width:700px){td:nth-child(3),th:nth-child(3),td:nth-child(6),th:nth-child(6){display:none}}
@media print{#map,.links{display:none}.run{break-inside:avoid-page}}
</style></head><body>
<header><h1>Sold STC drop list — ${today}</h1>
<div class="sub">${prev ? `New to Sold STC / Under offer since ${prevFile.replace('.json', '')}` : `First run: listings listed or re-priced in the last ${DAYS} days that are now Sold STC / Under offer`}. Routes start and finish at the yard (ME2 2ZE). Tick a row once delivered.</div>
<div class="stats"><div class="stat"><b>${drops.length}</b>doors</div><div class="stat"><b>${runs.length}</b>runs</div>
<div class="stat"><b>${totalMiles.toFixed(0)} mi</b>total driving</div>
${byDistrict.filter(([, n]) => n).map(([d, n]) => `<div class="stat"><b>${n}</b>${d}</div>`).join('')}</div></header>
<div id="map"></div>
<main>
${runs.map((r, ri) => `<section class="run"><h2><span class="dot" style="background:${mapData[ri].colour}"></span>Run ${ri + 1} — ${esc(r.area)}
<span class="small">${r.length} doors · ${r.totalMiles.toFixed(1)} mi${r.minutes ? ` · ~${Math.round(r.minutes)} min driving` : ' (est.)'} · ${[...new Set(r.map((s) => s.district))].join(', ')}</span></h2>
<div class="links">${r.links.map((l) => `<a href="${l.href}" target="_blank" rel="noopener">${esc(l.label)} in Google Maps</a>`).join('')}</div>
<table><thead><tr><th></th><th>#</th><th>Photo</th><th>Address</th><th>From prev.</th><th>Details</th><th>Check</th></tr></thead><tbody>
${r.map((s) => `<tr data-id="${s.id}"><td><input type="checkbox" aria-label="Delivered"></td><td><b>${s.stop}</b></td>
<td>${s.photo ? `<img src="${esc(s.photo)}" alt="" loading="lazy">` : ''}</td>
<td><b>${esc(s.address)}</b><br><span class="tag${s.status === 'Under offer' ? ' uo' : ''}">${esc(s.status)}</span> <span class="small">since ≥ ${s.stcAfter}</span></td>
<td>${s.legMiles.toFixed(1)} mi</td>
<td class="small">${s.beds || '?'} bed ${esc(s.type || '')}<br>${esc(s.price)}<br>${esc(s.agent)}</td>
<td class="small"><a href="${s.url}" target="_blank" rel="noopener">Listing photos</a><br>
<a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lng}" target="_blank" rel="noopener">Street View</a></td></tr>`).join('')}
</tbody></table></section>`).join('')}
${badPins.length ? `<section class="run"><h2>Check location (${badPins.length})</h2><table><tbody>${badPins.map((s) => `<tr><td><b>${esc(s.address)}</b><br><span class="small">The agent's map pin is outside Medway, so this one isn't routed. Find the house from the listing photos.</span></td><td class="small"><a href="${s.url}" target="_blank" rel="noopener">Listing</a></td></tr>`).join('')}</tbody></table></section>` : ''}
<p class="small">${backlog.length} older Sold STC / Under offer listings are in the snapshot but left off this list (likely too close to completion). Pin positions come from the agent's listing and are usually exact but sometimes street-level: compare the listing photos against Street View to confirm the door.</p>
</main>
<script>
const BASE=${JSON.stringify(BASE)}, RUNS=${JSON.stringify(mapData)};
const map=L.map('map');L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
const b=L.latLngBounds([[BASE.lat,BASE.lng]]);
L.marker([BASE.lat,BASE.lng]).addTo(map).bindPopup(BASE.name);
RUNS.forEach((r,i)=>{L.polyline(r.line,{color:r.colour,weight:3,opacity:.7}).addTo(map);
 r.stops.forEach(s=>{b.extend([s.lat,s.lng]);L.marker([s.lat,s.lng],{icon:L.divIcon({className:'',iconSize:[22,22],
 html:'<div style="background:'+r.colour+';color:#fff;border-radius:50%;width:22px;height:22px;font:600 11px/22px system-ui;text-align:center;border:2px solid #fff">'+s.n+'</div>'})})
 .addTo(map).bindPopup('Run '+s.run+' · stop '+s.n+'<br>'+s.a)})});
map.fitBounds(b,{padding:[20,20]});
const KEY='mkr-drops-${today}';let done={};try{done=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{}
document.querySelectorAll('tr[data-id]').forEach(tr=>{const cb=tr.querySelector('input');const id=tr.dataset.id;
 if(done[id]){cb.checked=true;tr.classList.add('done')}
 cb.addEventListener('change',()=>{done[id]=cb.checked;tr.classList.toggle('done',cb.checked);try{localStorage.setItem(KEY,JSON.stringify(done))}catch{}})});
</script></body></html>`;
fs.writeFileSync(path.join(dir, 'drop-list.html'), html);

console.log(`\n${drops.length} doors in ${runs.length} runs, ${totalMiles.toFixed(0)} mi total`);
console.log(`→ ${path.relative(ROOT, path.join(dir, 'drop-list.html'))}`);

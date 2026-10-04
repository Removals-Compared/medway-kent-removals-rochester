// ════════════════════════════════════════════════════════════
//  Sold-STC leaflet drops — weekly refresh.
//  1. Rightmove: every listing in the Medway + Maidstone districts
//     (search pages carry the data as __NEXT_DATA__ JSON).
//  2. Zoopla: Zoopla blocks automated requests, so Zoopla-only homes come
//     from the instant-alert emails Zoopla sends to support@ (IMAP, needs
//     SUPPORT_IMAP_USER + SUPPORT_IMAP_PASS — a Google app password).
//  3. Merge: a Zoopla listing that matches a Rightmove one (same district,
//     street, beds, price within 3%) is folded into it, not duplicated.
//  4. STC date: when a listing we'd already seen as available turns up as
//     Sold STC, the run date is its STC date (exact to the week). For one
//     already STC the first time we see it, we use its listed / re-priced
//     date — it went STC after that.
// ════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const T = 'marketing_listings';
const RUNS = 'marketing_runs';

export const OUTCODES = {
  ME1: 1608, ME2: 1619, ME3: 1621, ME4: 1622, ME5: 1623,
  ME7: 1625, ME8: 1626, ME14: 1613, ME15: 1614,
};
export const AREAS = {
  ME2: 'Strood & Hoo', ME3: 'Strood & Hoo',
  ME1: 'Rochester',
  ME4: 'Chatham & Walderslade', ME5: 'Chatham & Walderslade',
  ME7: 'Gillingham & Rainham', ME8: 'Gillingham & Rainham',
  ME14: 'Maidstone', ME15: 'Maidstone',
};
export const YARD = { lat: 51.384353, lng: 0.484489 }; // Knight Templar Way, ME2 2ZE
const SKIP_SUBTYPES = /land|plot|garage|parking|commercial/i;
const MAX_MILES = 20; // pins further than this from the yard are agent errors
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (v) => (!v ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const priceNum = (s) => { const n = Number(String(s || '').replace(/[^\d]/g, '')); return n || null; };

export function miles(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// "12 Monkwood Close, Rochester, Kent, ME1" → "monkwood close"
// "Flat 3, Monkwood Cl, Rochester" → "monkwood close"
const ABBR = { st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', cl: 'close', cres: 'crescent', dr: 'drive', ln: 'lane', gdns: 'gardens', ct: 'court', pl: 'place', sq: 'square', tce: 'terrace', gr: 'grove' };
export function streetKey(address) {
  for (const part of String(address || '').toLowerCase().split(',')) {
    const key = part
      .replace(/\b(flat|apartment|apt|unit|plot|house)\s*[\w-]*/g, '')
      .replace(/\d+[a-z]?\b/g, '')
      .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').map((w) => ABBR[w] || w).join(' ');
    if (key.length > 2) return key;
  }
  return '';
}

// ── Supabase ───────────────────────────────────────────────
function h(extra = {}) {
  return { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}
const rest = (path) => `${SUPABASE_URL}/rest/v1/${path}`;

async function existingRows() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(rest(`${T}?select=id,status,stc_seen_on,stc_estimate,source,zoopla_id,zoopla_url,first_seen`), {
      headers: h({ Range: `${from}-${from + 999}`, 'Range-Unit': 'items' }),
    });
    if (!r.ok) throw new Error(`marketing read ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return new Map(out.map((r) => [r.id, r]));
}

async function upsert(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const r = await fetch(rest(`${T}?on_conflict=id`), {
      method: 'POST',
      headers: h({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!r.ok) throw new Error(`marketing upsert ${r.status}: ${await r.text()}`);
  }
}

export async function listDrops({ days = 56 } = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const runR = await fetch(rest(`${RUNS}?select=*&order=ran_at.desc&limit=1`), { headers: h() });
  const lastRun = runR.ok ? (await runR.json())[0] || null : null;
  // Only listings still live on the most recent run (completed sales drop off).
  const liveSince = lastRun ? new Date(new Date(lastRun.ran_at).getTime() - 36e5 * 6).toISOString() : since;
  const q = new URLSearchParams({
    select: 'id,source,status,address,district,area,lat,lng,beds,prop_type,price,agent,photo,rightmove_url,zoopla_url,stc_seen_on,stc_estimate,stc_date,done,done_at,done_by',
    status: 'neq.',
    stc_date: `gte.${since}`,
    // Zoopla-only homes arrive once (by alert email), so they stay for the window.
    or: `(source.eq.zoopla,last_seen.gte."${liveSince}")`,
    order: 'stc_date.desc,area.asc',
    limit: '2000',
  });
  const r = await fetch(rest(`${T}?${q}`), { headers: h() });
  if (!r.ok) throw new Error(`marketing list ${r.status}: ${await r.text()}`);
  return { drops: await r.json(), lastRun };
}

export async function setDone(id, done, by) {
  const r = await fetch(rest(`${T}?id=eq.${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: h({ Prefer: 'return=representation' }),
    body: JSON.stringify(done
      ? { done: true, done_at: new Date().toISOString(), done_by: by || '' }
      : { done: false, done_at: null, done_by: null }),
  });
  if (!r.ok) throw new Error(`marketing done ${r.status}: ${await r.text()}`);
  return (await r.json())[0] || null;
}

// ── Rightmove ──────────────────────────────────────────────
async function rmPage(id, index, extra = '') {
  const url = `https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=OUTCODE%5E${id}` +
    `&includeSSTC=true&sortType=6&index=${index}${extra}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-GB' } });
      if (res.ok) {
        const m = (await res.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (m) return JSON.parse(m[1]).props.pageProps.searchResults;
      }
    } catch {}
    await sleep(1500 * (attempt + 1));
  }
  throw new Error(`Rightmove fetch failed (${id} @ ${index})`);
}

async function rmBand(id, extra) {
  const first = await rmPage(id, 0, extra);
  const total = Number(String(first.resultCount).replace(/,/g, ''));
  const idx = [];
  for (let i = 24; i < Math.min(total, 1008); i += 24) idx.push(i);
  const out = [...first.properties];
  for (let i = 0; i < idx.length; i += 4) {
    const pages = await Promise.all(idx.slice(i, i + 4).map((n) => rmPage(id, n, extra)));
    pages.forEach((p) => out.push(...p.properties));
    await sleep(250);
  }
  return { out, total };
}

async function rmOutcode(id) {
  const { out, total } = await rmBand(id, '');
  if (total <= 1000) return out;
  // Rightmove stops paging at ~1,000 results, so split big districts by price.
  const all = [];
  for (const b of ['&maxPrice=250000', '&minPrice=250000&maxPrice=400000', '&minPrice=400000']) {
    all.push(...(await rmBand(id, b)).out);
  }
  return all;
}

export async function fetchRightmove() {
  const seen = new Map();
  // Three districts at a time, four pages each: quick without hammering Rightmove.
  const entries = Object.entries(OUTCODES), results = [];
  for (let i = 0; i < entries.length; i += 3) {
    results.push(...await Promise.all(entries.slice(i, i + 3).map(async ([code, id]) => [code, await rmOutcode(id)])));
  }
  for (const [code, props] of results) {
    for (const p of props) {
      if (seen.has(p.id) || p.channel === 'COMMERCIAL_BUY') continue;
      if (p.customer?.development || p.auction || SKIP_SUBTYPES.test(p.propertySubType || '')) continue;
      seen.set(p.id, {
        id: `rm-${p.id}`, source: 'rightmove', rightmove_id: String(p.id),
        status: p.displayStatus || '',
        address: p.displayAddress, district: code, area: AREAS[code],
        lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null,
        beds: p.bedrooms ?? null, prop_type: p.propertySubType || null,
        price: p.price?.displayPrices?.[0]?.displayPrice || null,
        price_num: p.price?.amount || null,
        agent: p.customer?.branchDisplayName || null,
        photo: p.images?.[0]?.srcUrl || null,
        rightmove_url: `https://www.rightmove.co.uk/properties/${p.id}`,
        listed_on: day(p.firstVisibleDate),
        last_change: day(p.listingUpdate?.listingUpdateDate),
      });
    }
  }
  return [...seen.values()];
}

// ── Zoopla (alert emails in the support@ inbox) ────────────
// Each alert lists homes as blocks of text; we pull out every
// /for-sale/details/<id> link and read the price, beds and address
// printed alongside it.
export function parseZooplaEmail(text, receivedAt) {
  const out = [];
  const re = /zoopla\.co\.uk\/(?:new-homes\/)?(?:for-sale\/)?details\/(\d+)/g;
  // A listing's link usually appears several times (photo, title, button);
  // its block runs from the end of the previous listing's last link to its own last link.
  const last = new Map();
  for (const m of String(text).matchAll(re)) { last.delete(m[1]); last.set(m[1], { start: m.index, end: m.index + m[0].length }); }
  const firstSeen = new Map();
  for (const m of String(text).matchAll(re)) if (!firstSeen.has(m[1])) firstSeen.set(m[1], m.index);
  const ids = [...last.keys()].sort((a, b) => last.get(a).end - last.get(b).end);
  let from = 0;
  for (const zid of ids) {
    const to = last.get(zid).end;
    const block = text.slice(Math.min(from, firstSeen.get(zid)), to);
    from = to;
    const price = (block.match(/£\s?[\d,]{5,}/) || [])[0] || null;
    const beds = Number((block.match(/(\d+)\s*bed/i) || [])[1]) || null;
    const addr = (block.match(/[A-Z0-9][^\n£<>|]{3,80}?\bME\d{1,2}\b(?:\s?\d[A-Z]{2})?/) || [])[0] || null;
    const district = addr ? (addr.match(/\b(ME\d{1,2})\b/) || [])[1] : null;
    const status = /under offer/i.test(block) ? 'Under offer' : /sold stc|sold subject/i.test(block) ? 'Sold STC' : '';
    if (!addr || !district || !OUTCODES[district]) continue;
    out.push({
      zoopla_id: zid, address: addr.replace(/\s+/g, ' ').trim(), district, beds, status,
      price, price_num: priceNum(price), received: day(receivedAt),
      zoopla_url: `https://www.zoopla.co.uk/for-sale/details/${zid}/`,
    });
  }
  return out;
}

async function fetchZooplaAlerts(sinceDays = 8) {
  const user = process.env.SUPPORT_IMAP_USER, pass = process.env.SUPPORT_IMAP_PASS;
  if (!user || !pass) return { listings: [], note: 'Zoopla: inbox not connected' };
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  const listings = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('[Gmail]/All Mail');
    try {
      const since = new Date(Date.now() - sinceDays * 864e5);
      const uids = await client.search({ since, from: 'zoopla' });
      for await (const msg of client.fetch(uids, { source: true, internalDate: true })) {
        const mail = await simpleParser(msg.source);
        const body = mail.text || String(mail.html || '').replace(/<[^>]+>/g, '\n').replace(/&pound;/g, '£').replace(/&amp;/g, '&');
        listings.push(...parseZooplaEmail(body, msg.internalDate));
      }
    } finally { lock.release(); }
  } finally { await client.logout(); }
  return { listings, note: '' };
}

async function geocode(address) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(address)}`,
      { headers: { 'user-agent': 'MKR-admin/1.0 (support@medwaykentremovals.co.uk)' } });
    const j = await r.json();
    return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  } catch { return null; }
}

function findTwin(z, rmRows) {
  const key = streetKey(z.address);
  if (!key) return null;
  return rmRows.find((r) =>
    r.district === z.district && streetKey(r.address) === key &&
    (!z.beds || !r.beds || z.beds === r.beds) &&
    (!z.price_num || !r.price_num || Math.abs(z.price_num - r.price_num) / r.price_num <= 0.03)) || null;
}

// ── The weekly run ─────────────────────────────────────────
export async function refresh() {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const [prev, rm, zp] = await Promise.all([existingRows(), fetchRightmove(), fetchZooplaAlerts()]);

  // Fold Zoopla alerts into their Rightmove twins; keep the rest as Zoopla-only.
  let merged = 0;
  const zOnly = [];
  for (const z of zp.listings) {
    const twin = findTwin(z, rm);
    if (twin) {
      merged++;
      twin.source = 'both'; twin.zoopla_id = z.zoopla_id; twin.zoopla_url = z.zoopla_url;
    } else zOnly.push(z);
  }
  // Remember Zoopla links found on earlier runs.
  for (const r of rm) {
    const p = prev.get(r.id);
    if (!r.zoopla_id && p?.zoopla_id) { r.source = 'both'; r.zoopla_id = p.zoopla_id; r.zoopla_url = p.zoopla_url; }
  }
  for (const z of zOnly) {
    if (prev.has(`zp-${z.zoopla_id}`) && prev.get(`zp-${z.zoopla_id}`).status === z.status) continue;
    const pos = await geocode(z.address);
    await sleep(1100); // Nominatim: max 1 request a second
    rm.push({
      id: `zp-${z.zoopla_id}`, source: 'zoopla', zoopla_id: z.zoopla_id, zoopla_url: z.zoopla_url,
      status: z.status, address: z.address, district: z.district, area: AREAS[z.district],
      lat: pos?.lat ?? null, lng: pos?.lng ?? null, beds: z.beds, price: z.price, price_num: z.price_num,
      listed_on: z.received, last_change: z.received,
    });
  }

  let newStc = 0;
  const rows = rm.map((r) => {
    const p = prev.get(r.id);
    const isStc = !!r.status;
    let stc_seen_on = p?.stc_seen_on || null;
    let stc_estimate = p?.stc_estimate || null;
    if (isStc && p && !p.status && !stc_seen_on) { stc_seen_on = today; newStc++; }
    if (isStc && !p) stc_estimate = [r.listed_on, r.last_change].filter(Boolean).sort().pop() || today;
    if (!isStc) { stc_seen_on = null; stc_estimate = null; } // back on the market
    const badPin = r.lat == null || miles(YARD, r) > MAX_MILES;
    return {
      ...r,
      lat: badPin ? null : r.lat, lng: badPin ? null : r.lng,
      zoopla_id: r.zoopla_id || null, zoopla_url: r.zoopla_url || null, rightmove_id: r.rightmove_id || null,
      rightmove_url: r.rightmove_url || null, agent: r.agent || null, photo: r.photo || null, prop_type: r.prop_type || null,
      stc_seen_on, stc_estimate, stc_date: stc_seen_on || stc_estimate,
      last_seen: now, first_seen: p?.first_seen || now,
    };
  });

  await upsert(rows);
  const summary = {
    listings: rows.length,
    stc: rows.filter((r) => r.status).length,
    new_stc: newStc,
    zoopla: zp.listings.length,
    merged,
    note: [prev.size ? '' : 'First run: STC dates are estimates', zp.note].filter(Boolean).join(' · '),
  };
  await fetch(rest(RUNS), { method: 'POST', headers: h({ Prefer: 'return=minimal' }), body: JSON.stringify(summary) });
  return summary;
}

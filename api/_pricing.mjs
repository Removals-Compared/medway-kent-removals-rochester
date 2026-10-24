// ════════════════════════════════════════════════════════════
//  Instant quote pricing. The server is the only source of truth: the
//  browser sends the answers, never a price. The leading underscore keeps
//  this file from being deployed as its own serverless function.
//
//  Studio £500, 1 bed £750, 2 bed £1,200, 3 bed £1,650, 4 bed £2,000, 5 bed £2,550,
//  +£150 per started
//  hour of drive time (first 30 minutes free), second and further vans
//  +£750 each. Packing is booked separately after a survey.
// ════════════════════════════════════════════════════════════
export const PRICES = {
  // base price by bedrooms (0 = studio)
  base: { 0: 500, 1: 750, 2: 1200, 3: 1650, 4: 2000, 5: 2550 },
  perHour: 150, freeMinutes: 30,
  extraVan: 750,
  depositRate: 0.10,
  klarnaMax: 2000,          // Klarna limit for UK pay-over-time options in GBP (Stripe docs); above this Klarna won't show
  longJourneyHours: 5,      // this many hours or more: fixed quote by phone
};

const PC = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
export const isPostcode = (s) => PC.test(String(s || '').trim());
export const tidyPostcode = (s) => {
  const p = String(s || '').toUpperCase().replace(/\s+/g, '');
  return p.slice(0, -3) + ' ' + p.slice(-3);
};

// Drive time between two postcodes: postcodes.io (geocode) + OSRM (route).
// Both are free public services, fine for a preview. For production set
// ROUTING_URL to a paid or self-hosted OSRM-compatible endpoint.
export async function journeyMinutes(from, to) {
  const geo = async (pc) => {
    const r = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc.replace(/\s+/g, '')),
      { signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    if (!j.result) throw new Error('postcode not found: ' + pc);
    return j.result;
  };
  const [a, b] = await Promise.all([geo(from), geo(to)]);
  const base = process.env.ROUTING_URL || 'https://router.project-osrm.org';
  const r = await fetch(`${base}/route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=false`,
    { signal: AbortSignal.timeout(8000) });
  const j = await r.json();
  if (!j.routes || !j.routes[0]) throw new Error('no route');
  return Math.round(j.routes[0].duration / 60);
}

export const hoursCharged = (mins) => (mins <= PRICES.freeMinutes ? 0 : Math.ceil(mins / 60));

// size: 0 = studio, 1..5 bedrooms. vans: 1..4. Returns whole pounds.
export function priceFor({ size, vans, hours }) {
  return PRICES.base[size] + PRICES.perHour * hours + PRICES.extraVan * (vans - 1);
}

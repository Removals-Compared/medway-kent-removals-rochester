// GET /api/address-lookup?postcode=SW1A1AA
// Proxies a UK postcode -> address lookup using the Ordnance Survey Places API,
// keeping the API key server-side. Returns { postcode, addresses: [string] }.
// If OS_PLACES_KEY is not set the endpoint returns 501 so the caller can fall
// back to manual entry.

function titleCase(s) {
  return s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

// Turn an OS DPA or LPI address record into a clean display string.
function formatAddress(d) {
  const raw = (d.ADDRESS || "").trim();
  if (!raw) return null;
  // LPI datasets include "STREET RECORD" pseudo-entries that are not real addresses.
  if (/\bSTREET RECORD\b/i.test(raw)) return null;
  // DPA records use POSTCODE; LPI records use POSTCODE_LOCATOR.
  const pc = (d.POSTCODE || d.POSTCODE_LOCATOR || "").toUpperCase().trim();
  const parts = raw.split(/,\s*/).filter(Boolean);
  // The OS ADDRESS string ends with the postcode; drop it, then re-add uppercased.
  if (pc && parts.length) {
    const last = parts[parts.length - 1].toUpperCase().replace(/\s/g, "");
    if (last === pc.replace(/\s/g, "")) parts.pop();
  }
  const nice = parts.map(titleCase).join(", ");
  return pc ? `${nice}, ${pc}` : nice;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.OS_PLACES_KEY;
  if (!key) {
    return res.status(501).json({ error: "Address lookup not configured" });
  }

  const raw = String(req.query.postcode || "").trim().toUpperCase();
  const pc = raw.replace(/\s+/g, "");
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) {
    return res.status(400).json({ error: "Enter a valid UK postcode" });
  }
  const fmtPc = `${pc.slice(0, -3)} ${pc.slice(-3)}`;

  try {
    // Query both datasets: DPA gives clean postal addresses, LPI fills the gaps
    // for commercial or edge-case postcodes with no DPA record.
    const url = "https://api.os.uk/search/places/v1/postcode"
      + `?postcode=${encodeURIComponent(fmtPc)}`
      + "&dataset=DPA,LPI&maxresults=100"
      + `&key=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    if (r.status === 400) {
      // OS returns 400 for a postcode with no matches
      return res.status(200).json({ postcode: fmtPc, addresses: [] });
    }
    if (!r.ok) {
      console.error("OS Places lookup failed", r.status);
      return res.status(502).json({ error: "Address lookup unavailable" });
    }
    const j = await r.json();
    const results = j.results || [];
    const uprns = new Set();
    const out = [];
    // First pass: DPA (cleaner formatting). Second pass: LPI for any property
    // (by UPRN) not already covered by a DPA record.
    for (const pass of ["DPA", "LPI"]) {
      for (const rec of results) {
        const d = rec[pass];
        if (!d) continue;
        if (d.UPRN && uprns.has(d.UPRN)) continue;
        const a = formatAddress(d);
        if (!a) continue;
        if (d.UPRN) uprns.add(d.UPRN);
        out.push(a);
      }
    }
    // de-duplicate display strings while preserving order
    const seen = new Set();
    const unique = out.filter((a) => (seen.has(a) ? false : seen.add(a)));
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).json({ postcode: fmtPc, addresses: unique });
  } catch (err) {
    console.error("address-lookup error", err);
    return res.status(502).json({ error: "Address lookup unavailable" });
  }
}

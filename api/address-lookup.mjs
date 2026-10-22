// GET /api/address-lookup?postcode=SW1A1AA
// Proxies a UK postcode -> address lookup using the Ideal Postcodes API,
// keeping the API key server-side. Returns { postcode, addresses: [string] }.
// If IDEAL_POSTCODES_KEY is not set the endpoint returns 501 so the caller
// can fall back to manual entry.

function formatAddress(d) {
  const parts = [d.line_1, d.line_2, d.line_3, d.post_town]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  const pc = (d.postcode || "").trim();
  const joined = parts.join(", ");
  return pc ? (joined ? `${joined}, ${pc}` : pc) : joined;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.IDEAL_POSTCODES_KEY;
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
    const url = "https://api.ideal-postcodes.co.uk/v1/postcodes/"
      + encodeURIComponent(pc)
      + `?api_key=${encodeURIComponent(key)}`;
    const r = await fetch(url);
    if (r.status === 404) {
      return res.status(200).json({ postcode: fmtPc, addresses: [] });
    }
    if (r.status === 402) {
      console.error("Ideal Postcodes credit exhausted");
      return res.status(502).json({ error: "Address lookup credit exhausted" });
    }
    if (r.status === 401 || r.status === 403) {
      console.error("Ideal Postcodes auth failed", r.status);
      return res.status(502).json({ error: "Address lookup auth failed" });
    }
    if (!r.ok) {
      console.error("Ideal Postcodes lookup failed", r.status);
      return res.status(502).json({ error: "Address lookup unavailable" });
    }
    const j = await r.json();
    const results = (j && j.result) || [];
    const seen = new Set();
    const out = [];
    for (const d of results) {
      const a = formatAddress(d);
      if (!a || seen.has(a)) continue;
      seen.add(a);
      out.push(a);
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).json({ postcode: fmtPc, addresses: out });
  } catch (err) {
    console.error("address-lookup error", err);
    return res.status(502).json({ error: "Address lookup unavailable" });
  }
}

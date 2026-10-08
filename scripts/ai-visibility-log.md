# AI visibility log — Medway & Kent Removals

Monthly check: run each query on Perplexity, ChatGPT and Google AI Overview, record whether MKR is named or cited, and who else is.

## Baseline: 15 September 2026

| # | Query | Perplexity | ChatGPT | Bing local | Notes |
|---|-------|-----------|---------|-----------|-------|
| 1 | best removal company in Medway | NAMED, ranked 1st, "practical choice" | NOT named | not in pack | ChatGPT picked Rubix (211 Google reviews), SCS (158), Foremans (99) from the local pack |
| 2 | 3 bed house removal cost in Kent | CITED (medwaykentremovals.co, packing cost figures) | NAMED 1st of local firms, site cited as source | n/a | Cost content is earning citations on both platforms |
| 3 | best removal company Rochester Kent | NAMED 2nd (after Fontana Moving), 5.0 rating and phone number quoted | not tested | n/a | Perplexity quoted the 5.0 Google rating |
| 4 | man and van Medway single item pickup | NAMED 1st, "from £45" quoted, site cited twice | not tested | n/a | A competitor's entry even carried MKR's phone and domain |
| 5 | best removal company medway (Bing) | n/a | n/a | ABSENT | Bing local pack shows Road Runner, Rubix, Foremans. Domain IS indexed on Bing (brand query returns homepage), so the gap is the missing Bing Places listing |

Google AI Overviews: not checkable by automation (bot check). Spot-check manually in a normal browser each month.

## Scoreboard

- Perplexity: cited or named in 4 of 4 queries, ranked first in 2
- ChatGPT: named in 1 of 2; lost the "best in Medway" pick on review volume
- Bing/Copilot: invisible locally until a Bing Places listing exists

## Competitors seen in AI answers this month

Rubix Removals (211 reviews), Fontana Moving, SCS Removals & Storage (158), Foremans Removals (99), Road Runner Removals, Britannia Bearsbys, Kent Movers, Bray & Son, Bravo UK Removals, Philip Marks Removals.

## Actions arising (baseline)

1. Review volume decides the ChatGPT "best in Medway" pick: Rubix 211 vs MKR 50. Keep the review request flywheel running on every completed job.
2. Create a Bing Places listing (bingplaces.com, can import straight from Google Business Profile). Unlocks the Bing local pack and Copilot. Owner action.
3. Claim a real Checkatrade profile. Checkatrade results were quoted in ChatGPT and Perplexity answers repeatedly; MKR's schema currently links a Checkatrade search page, not a profile. Owner action.
4. Verify the "800+ moves since 2020" claim Perplexity attributes to MKR (likely from a directory profile) and keep such claims consistent everywhere.

## Content actions shipped 1 October 2026 (from the BrightLocal 22/100 report)

- student removals prompt (was 0): new /student-removals service page, in nav, sitemap and llms.txt
- removals company in TN28 prompt (was 0): new /removals-new-romney location page covering TN28/TN29 and Romney Marsh
- moving from kent prompt (was 0): /long-distance-removals retitled and reworked around "Moving from Kent", new FAQ
- cost prompts: /removal-costs-kent pillar page with price tables, Article + FAQPage schema; old cost blog post canonicals to it
- Remaining owner actions: Google reviews volume (Rubix benchmark 211), Checkatrade profile (the number 2 AI source), Bing Places listing, GBP activity
- Next check: re-run BrightLocal "Update data" in early November and compare prompt scores

## Bing and infrastructure progress, 8 October 2026

- Bing Places listing verified and Pending publish (ETA 7 to 12 days), synced from the Google Business Profile: name, phone, hours, description, 15 photos, services and 8 service areas including Kent, UK. Address hidden by design (service area business). Once live, this closes the Bing local pack gap and lets Copilot surface MKR.
- Known Bing Places bug: the locked, Google-synced phone field fails Bing's own validation, which blocks saving the two remaining cosmetic fields (email, Movers additional category). Retry after publish or via a fresh Sync; revisit at the 5 November check.
- Bing Webmaster Tools: site verified, sitemap resubmitted 8 October (101 URLs, processing). Google Search Console: sitemap resubmitted 8 October (102 URLs, Success).
- IndexNow wired in: key file hosted on the domain, all 102 URLs submitted (HTTP 202), and a GitHub Action now pings changed pages to Bing on every deploy.
- Email deliverability closed out: root SPF and DMARC with reporting live at Namecheap, mail-tester score 9.5/10 for admin quote emails. Flip DMARC to p=quarantine around 5 November if reports are clean.

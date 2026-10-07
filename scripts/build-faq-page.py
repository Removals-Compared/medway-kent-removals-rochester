#!/usr/bin/env python3
"""Builds /faq.html from contact.html chrome (head, nav, footer) + the groups below.
Edit FAQ_GROUPS and rerun: python3 scripts/build-faq-page.py"""
import re, json, html

SITE = 'https://www.medwaykentremovals.co.uk'
FAQ_GROUPS = [
 ('Booking, payment and cancellation', [
  ('What is your cancellation or rescheduling policy?',
   'Cancellation is free. If you cancel, your deposit is refunded in full. If your plans change, for example a delayed completion, we will move your booking to a new date at no extra charge wherever we have availability, and work with you to find the nearest suitable date if we do not. Just call us on 01634 971005 as soon as you know.'),
  ('What payment methods do you accept, and when is the balance due?',
   'We accept all major credit and debit cards, bank transfer, cash and cryptocurrency. A deposit of 10% of the quote secures your date and the remaining 90% is paid on the day of the move. We never ask for full payment upfront. There is no VAT on top, so the price quoted is the price you pay.'),
  ('Do you offer a free quote, a home visit or a video survey?',
   'Yes, all quotes are free with no obligation. Most moves are quoted accurately from the online form or a phone call, and for bigger or more complex jobs we can do a free site visit or a video walk-through on WhatsApp. Our quotes are fixed prices, itemised, and we respond to every enquiry within 60 minutes, seven days a week.'),
  ('Can you move me at short notice or on the same day?',
   'Yes, same-day moves are available, subject to crew and van availability that day. Call 01634 971005 or message us on WhatsApp on 07359 917380 and we will tell you straight away whether we can do it and what it will cost. The earlier in the day you call, the better our chances.'),
  ('What is the cheapest day or time of year to move?',
   'Midweek moves (Tuesday to Thursday), mid-month dates and the quieter months from November to March are usually the best value. Fridays, the end of the month and the school summer holidays are the busiest and book up first, so book 4 to 6 weeks ahead for those dates.'),
  ('Do you move on bank holidays, and do you do end of tenancy moves for house shares and HMOs?',
   'We are happy to work bank holidays and weekends by arrangement, and we move house shares, student lets and landlord or HMO tenants, including end of tenancy moves with tight key deadlines. Tell us the handover time when you request your quote.'),
 ]),
 ('Moving day', [
  ('How many movers and what size van will I need?',
   'Every house removal includes a maxi loader Luton van and professional movers, with the crew sized to the job. Every move has a minimum of two professional movers, and we never send one person to a house move. Beyond that we apportion the crew to the size of the job: a 1 to 2 bedroom home is a Luton van with two movers, a 3 bedroom home usually adds a third mover, and a 4 to 5 bedroom home gets a larger crew and sometimes a second trip or vehicle. We confirm the exact crew and van in your fixed quote.'),
  ('How long will my move take?',
   'For a local move, a 2 bedroom home typically takes around 3 to 5 hours from first load to final unload, a 3 bedroom home 5 to 7 hours, and a 4 to 5 bedroom home a full day. Access, stairs, parking distance and the drive between addresses all affect timing, and we allow for them when we quote. Long distance moves add the journey time.'),
  ('What time will the crew arrive?',
   'We agree your arrival time when you book and confirm it with a call the evening before. If completion keys are not released until later in the day we simply plan around it. Your crew will always call if there is any delay.'),
  ('Do I need to be there on the day?',
   'Someone needs to be at the collection address to show the crew around and hand over keys, and at the destination to direct furniture to the right rooms. If you cannot be at both, a friend, family member or your agent can stand in. Tell us in advance and we will arrange the handover with them.'),
  ('What do you do if something gets damaged, and how do I claim?',
   'We are fully insured: every move carries goods in transit insurance at full replacement value plus public liability insurance. If anything is damaged, tell your crew or call us as soon as you notice, with photos if you can. We will take you through the claim and it is dealt with directly by us, so you are not chasing a third party. Proof of insurance is available on request.'),
 ]),
 ('What we can and cannot move', [
  ('Do you move pianos, safes, gym equipment, pool tables and other heavy items?',
   'Yes. Upright pianos, safes, gym equipment, pool tables and similar heavy or awkward items are handled by experienced crew with the right equipment. They are priced individually, so mention them when you request your quote. Grand pianos and very heavy safes may need a quick look at access first, and we will tell you if so.'),
  ('Can you move plants, a fridge freezer or a washing machine?',
   'Yes to appliances and yes to most house plants. Fridges and freezers should be emptied and defrosted at least 24 hours before the move and washing machines drained, which our crew can disconnect on the day. Plants travel best in the cab or upright in the van and very large or delicate ones need to be agreed in advance. Pets should travel with you, not in the van.'),
  ('Do you disconnect and reconnect washing machines and other appliances?',
   'Yes. Our crew can disconnect and reconnect washing machines and similar appliances as part of the move. We do not carry out major plumbing, gas or electrical work, so anything that needs a qualified tradesperson, such as a gas cooker or a new plumbed-in fitting, should be handled by a plumber or electrician.'),
  ('What can you not move?',
   'For safety and insurance reasons we cannot carry gas bottles, petrol, paint thinners and other flammable or hazardous liquids, aerosols in quantity, garden chemicals, firearms without correct arrangements, perishable food or anything alive. Plan to use them up, give them away or dispose of them responsibly before moving day.'),
 ]),
 ('Our team and special circumstances', [
  ('Are you a registered company, and are your staff vetted or DBS checked?',
   'Yes. Medway and Kent Removals is registered at Companies House (company number 17190871) and based at Knight Templar Way, Rochester ME2 2ZE. All of our crew are DBS checked and trained in professional manual handling before they work in your home, and we carry full goods in transit and public liability insurance.'),
  ('Do you help with bereavement, probate and elderly downsizing moves?',
   'Yes, and we take particular care with them. We move the contents of a loved one\'s home, help families split items between relatives and move older customers into smaller homes, sheltered housing or care. Our crew are patient, unhurried and DBS checked, and we work to timings that suit the family. Call us for a calm, no-pressure conversation.'),
  ('Do you clear rubbish or help me declutter before the move?',
   'The best way to cut the cost of a move is to move less, so sort and donate or dispose of what you do not need 4 to 6 weeks beforehand and tell us the reduced volume when you request your quote. Ask us about anything you would like taken away on the day and we will confirm what we can do and quote for it clearly beforehand.'),
 ]),
]

def strip(s): return re.sub(r'<[^>]+>', '', s)

src = open('contact.html', encoding='utf-8').read()
nav_end = src.index('<div style="background:linear-gradient(180deg,var(--cream),var(--paper))')
foot_start = src.index('<footer id="site-footer"')
foot_end = src.index('</footer>') + len('</footer>')
tail_start = foot_end
tail_end = src.index('<section>', foot_end)  # contact page checklist sections follow the footer
tail = src[tail_end:]
tail = tail[tail.index('<!-- wa-float'):]
tail = tail[:tail.index('<script>')] + '</body></html>\n'  # drop contact-form stepper script
head = src[:nav_end]

title = 'Removals FAQ: Costs, Payment, Cancellation, Insurance | Medway &amp; Kent Removals'
desc = 'Answers to the questions customers ask most: payment and cancellation, same-day moves, crew and van size, move timings, pianos, insurance and DBS checked staff. Rochester, Kent.'
canon = SITE + '/faq'
head = re.sub(r'<title>.*?</title>', f'<title>{title}</title>', head, flags=re.S)
head = re.sub(r'<meta name="description" content=".*?">', f'<meta name="description" content="{desc}">', head, count=1)
head = re.sub(r'<link rel="canonical" href=".*?">', f'<link rel="canonical" href="{canon}">', head)
head = re.sub(r'<meta property="og:title" content=".*?">', f'<meta property="og:title" content="{title}">', head)
head = re.sub(r'<meta property="og:description" content=".*?">', f'<meta property="og:description" content="{desc}">', head)
head = re.sub(r'<meta property="og:url" content=".*?">', f'<meta property="og:url" content="{canon}">', head)
schema = {"@context": "https://schema.org", "@graph": [
  {"@type": "BreadcrumbList", "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
    {"@type": "ListItem", "position": 2, "name": "FAQ", "item": canon}]},
  {"@type": "FAQPage", "mainEntity": [
    {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}}
    for _, items in FAQ_GROUPS for q, a in items]}]}
head = re.sub(r'<script type="application/ld\+json">.*?</script>',
              lambda m: '<script type="application/ld+json">' + json.dumps(schema, ensure_ascii=False) + '</script>',
              head, count=1, flags=re.S)

hero = f'''<div style="background:linear-gradient(180deg,var(--cream),var(--paper));border-bottom:1px solid var(--border);padding:56px 0 48px">
  <div class="container">
    <nav aria-label="Breadcrumb" style="margin-bottom:16px"><ol style="list-style:none;display:flex;gap:8px;font-size:13px;color:var(--muted)"><li><a href="/" style="color:var(--muted)">Home</a></li><li style="color:var(--lighter)">&#8250;</li><li style="color:var(--navy)">FAQ</li></ol></nav>
    <span class="label">Frequently asked questions</span>
    <h1 style="font-size:clamp(32px,4vw,50px);color:var(--navy);letter-spacing:0;max-width:780px;margin-bottom:14px">Removals questions, answered straight</h1>
    <p style="color:var(--muted);font-size:17px;max-width:700px;line-height:1.75">Payment, cancellation, same-day moves, van and crew size, timings, heavy items and insurance. If your question is not here, call 01634 971005 or message us on WhatsApp and we will answer within the hour.</p>
  </div>
</div>
'''
sections = ''
for i, (gname, items) in enumerate(FAQ_GROUPS):
    cls = ' class="cream"' if i % 2 == 0 else ''
    rows = ''.join(
        f'<div class="faq-item"><button class="faq-q" onclick="toggleFaq(this)">{html.escape(q, quote=False)}<span class="faq-arrow">+</span></button><div class="faq-a">{html.escape(a, quote=False)}</div></div>\n      '
        for q, a in items)
    sections += f'''<section{cls}>
  <div class="container">
    <h2 class="section-title">{gname}</h2>
    <div class="faq-list">
      {rows}</div>
  </div>
</section>
'''
cta = '''<section>
  <div class="container" style="text-align:center">
    <h2 class="section-title">Ready for a fixed price?</h2>
    <p style="font-size:16px;color:var(--muted);line-height:1.8;max-width:620px;margin:0 auto 22px">Free, no-obligation, itemised quotes. Free cancellation with your deposit refunded in full.</p>
    <a class="btn btn-primary" href="/contact">Get a free quote</a>
  </div>
</section>
'''
footer = src[foot_start:foot_end]
footer = footer.replace('<li><a href="/contact">Contact Us</a></li>', '<li><a href="/contact">Contact Us</a></li><li><a href="/faq">FAQs</a></li>')
out = head + hero + sections + cta + footer + '<script src="/script.js"></script>\n' + tail
open('faq.html', 'w', encoding='utf-8').write(out)
print('questions:', sum(len(i) for _, i in FAQ_GROUPS), 'bytes:', len(out))

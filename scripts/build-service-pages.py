#!/usr/bin/env python3
"""Assemble dedicated service pages from the shared site chrome + per-service
content modules in scripts/svc-content/. Run from the repo root:
    python3 scripts/build-service-pages.py
"""
import json, re, sys, os, importlib.util

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLOCKS = json.load(open(os.path.join(ROOT, 'scripts/.svc-template-blocks.json')))
CONTENT_DIR = os.path.join(ROOT, 'scripts/svc-content')

SERVICES = [
    ('house-removals',        'House Removals'),
    ('packing-services',      'Packing Services'),
    ('office-removals',       'Office Removals'),
    ('man-and-van',           'Man and Van'),
    ('storage',               'Storage'),
    ('long-distance-removals','Long Distance Removals'),
]

FONTS_GTAG = '''<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,600&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,600&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap" rel="stylesheet"></noscript>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-2FXN3VMLGT"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-2FXN3VMLGT');
</script>
<link rel="preload" href="/style.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="/style.css"></noscript>'''

STATS = '''<div class="stats-bar">
  <div class="stats-inner">
    <div class="stat"><div class="stat-num">800+</div><div class="stat-label">Moves Completed</div></div>
    <div class="stat"><div class="stat-num">100%</div><div class="stat-label">Fully Insured</div></div>
    <div class="stat"><div class="stat-num">5.0&#9733;</div><div class="stat-label">Google Rating</div></div>
    <div class="stat"><div class="stat-num">60 mins</div><div class="stat-label">Quote Response</div></div>
  </div>
</div>'''

def load_page(slug):
    path = os.path.join(CONTENT_DIR, slug.replace('-', '_') + '.py')
    spec = importlib.util.spec_from_file_location(slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.PAGE

def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

def strip_tags(html):
    return re.sub(r'<[^>]+>', ' ', html)

def word_count(page):
    text = ' '.join([strip_tags(page['intro']), strip_tags(page['body'])] +
                    [strip_tags(q) + ' ' + strip_tags(a) for q, a in page['faqs']])
    return len(text.split())

def schema(page, name):
    url = f"https://www.medwaykentremovals.co.uk/{page['slug']}"
    g = {"@context": "https://schema.org", "@graph": [
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.medwaykentremovals.co.uk/"},
            {"@type": "ListItem", "position": 2, "name": "Services", "item": "https://www.medwaykentremovals.co.uk/services"},
            {"@type": "ListItem", "position": 3, "name": name, "item": url}]},
        {"@type": "Service", "name": page['schema_name'], "serviceType": page['schema_name'],
         "description": page['schema_desc'], "url": url,
         "provider": {"@id": "https://www.medwaykentremovals.co.uk/#movingcompany"},
         "areaServed": [{"@type": "AdministrativeArea", "name": "Kent"}, {"@type": "City", "name": "Rochester"}, {"@type": "City", "name": "Medway"}]},
        {"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": strip_tags(q).strip(),
             "acceptedAnswer": {"@type": "Answer", "text": strip_tags(a).strip()}} for q, a in page['faqs']]},
    ]}
    return '<script type="application/ld+json">' + json.dumps(g, ensure_ascii=False) + '</script>'

def sidebar(page, name):
    others = ''.join(f'<li><a href="/{s}">{n}</a></li>' for s, n in SERVICES if s != page['slug'])
    return f'''<aside class="loc-sidebar">
        <div class="side-card">
          <h3>Free {name.lower()} quote</h3>
          <p style="font-size:13px;color:var(--muted);margin-bottom:16px;line-height:1.6">Friday and end-of-month dates fill 4 to 6 weeks ahead. Fully insured, fixed-price, quote in 60 minutes.</p>
          <a href="/contact?service={page['svc_param']}" class="btn btn-primary" style="width:100%;justify-content:center;font-size:14px;margin-bottom:10px">Get a Free Quote</a>
          <a href="tel:01634971005" style="display:block;text-align:center;font-size:14px;color:var(--accent);font-weight:700">&#128222; 01634 971005</a><a href="tel:07359917380" style="display:block;text-align:center;font-size:14px;color:var(--accent);font-weight:700">&#128241; 07359 917380</a>
          <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
            <div style="font-size:12px;color:var(--muted);line-height:1.9">
              <div>&#128197; Mon to Fri: 7am to 7pm</div>
              <div>&#128197; Saturday: 8am to 5pm</div>
              <div>&#128197; Sunday: 9am to 2pm</div>
            </div>
          </div>
        </div>
        <div class="side-card">
          <h3>&#128737; Fully insured</h3>
          <p style="font-size:13px;color:var(--muted);line-height:1.65">Every job is covered by comprehensive goods-in-transit and public liability insurance. Proof of cover available on request.</p>
        </div>
        <div class="side-card"><h3>Our other services</h3><ul>{others}<li><a href="/services">All services overview</a></li></ul></div>
        <div class="side-card"><h3>Popular areas we cover</h3><ul>
          <li><a href="/removals-rochester">Removals Rochester</a></li>
          <li><a href="/removals-chatham">Removals Chatham</a></li>
          <li><a href="/removals-gillingham">Removals Gillingham</a></li>
          <li><a href="/removals-maidstone">Removals Maidstone</a></li>
          <li><a href="/areas">View all Kent areas</a></li></ul></div>
      </aside>'''

def build(slug, name):
    page = load_page(slug)
    wc = word_count(page)
    assert wc >= 2400, f"{slug}: only {wc} words (need 2400+)"
    url = f"https://www.medwaykentremovals.co.uk/{slug}"
    faq_html = ''.join(
        f'<div class="faq-item"><button class="faq-q" onclick="toggleFaq(this)">{q}<span class="faq-arrow">+</span></button><div class="faq-a">{a}</div></div>'
        for q, a in page['faqs'])
    img_src, img_alt = page['img']
    head = f'''{BLOCKS['head_top']}<title>{page['title']}</title>
<meta name="description" content="{esc(page['desc'])}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="{url}">
<link rel="icon" type="image/png" sizes="32x32" href="/images/favicon.png">
<meta name="theme-color" content="#16294a">
<meta property="og:type" content="website">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{esc(page['title'])}">
<meta property="og:description" content="{esc(page['desc'])}">
<meta property="og:image" content="https://www.medwaykentremovals.co.uk{img_src}">
<meta name="twitter:card" content="summary_large_image">
{schema(page, name)}
{FONTS_GTAG}
{BLOCKS['style']}
</head><body>
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-WQHT5D2L"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
'''
    hero = f'''<div class="loc-hero">
  <div class="container">
    <nav aria-label="Breadcrumb" style="margin-bottom:16px"><ol style="list-style:none;display:flex;gap:8px;font-size:13px;color:var(--muted)">
      <li><a href="/" style="color:var(--muted)">Home</a></li><li style="color:var(--lighter)">&#8250;</li>
      <li><a href="/services" style="color:var(--muted)">Services</a></li><li style="color:var(--lighter)">&#8250;</li>
      <li style="color:var(--navy)">{name}</li></ol></nav>
    <span class="label">{page['label']}</span>
    <h1>{page['h1']}</h1>
    <p>{page['intro']}</p>
    <div class="loc-urgency" style="background:var(--accent-pale);border-left:3px solid var(--accent);padding:11px 16px;margin:24px 0 0;border-radius:6px;font-size:13.5px;color:var(--text);max-width:620px;line-height:1.55">
      <strong style="color:var(--accent)">&#128197; {page['urgency']}</strong> Get a fixed-price quote within 60 minutes.
    </div>
    <div class="loc-hero-actions">
      <a href="/contact?service={page['svc_param']}" class="btn btn-primary">{page['cta_btn']}</a>
      <a href="tel:01634971005" class="btn btn-secondary">&#128222; 01634 971005</a><a href="tel:07359917380" class="btn btn-secondary">&#128241; 07359 917380</a>
    </div>
    <div class="loc-trust">
      <div class="lt-item"><span>&#128737;</span><div><strong>Fully Insured:</strong> Goods in transit and public liability</div></div>
      <div class="lt-item"><span>&#128183;</span><div><strong>Fixed Prices:</strong> No hidden charges, ever</div></div>
      <div class="lt-item"><span>&#11088;</span><div><strong>5 Stars:</strong> 50+ Google reviews</div></div>
      <div class="lt-item"><span>&#128205;</span><div><strong>Rochester Based:</strong> Serving all of Kent since 2020</div></div>
    </div>
  </div>
</div>'''
    figure = f'''<figure style="margin:28px 0"><img src="{img_src}" alt="{esc(img_alt)}" loading="lazy" decoding="async" style="width:100%;height:auto;border-radius:14px;box-shadow:var(--sh)"><figcaption style="font-size:13px;color:var(--muted);margin-top:10px;font-style:italic">{esc(page['img_caption'])}</figcaption></figure>'''
    body = page['body'].replace('<!--FIGURE-->', figure)
    main = f'''<section style="padding:64px 0">
  <div class="container">
    <div class="loc-layout">
      <div class="loc-body">
{body}
        <h2>{page['faq_title']}</h2>
        <p class="faq-intro">{page['faq_intro']}</p>
        <div class="faq-list loc-faq">{faq_html}</div>
      </div>
      {sidebar(page, name)}
    </div>
  </div>
</section>

<div class="cta-band">
  <div class="container">
    <h2>{page['cta_h']}</h2>
    <p>{page['cta_p']}</p>
    <div class="cta-actions">
      <a href="/contact?service={page['svc_param']}" class="btn btn-primary">Get Your Free Quote</a>
      <a href="tel:01634971005" class="btn btn-secondary">&#128222; Call 01634 971005</a>
    </div>
  </div>
</div>
'''
    html = head + BLOCKS['nav'] + hero + '\n' + STATS + '\n' + main + BLOCKS['foot']
    out = os.path.join(ROOT, slug + '.html')
    open(out, 'w').write(html)
    return wc

if __name__ == '__main__':
    for slug, name in SERVICES:
        wc = build(slug, name)
        print(f"{slug}.html written — {wc} words")

#!/usr/bin/env python3
"""
fix_pages.py
============

Surgical patcher. Touches ONLY what's listed below. Idempotent.

  Fix 1: Removes the "Google rating ... 4.9 out of 5" row from about.html
  Fix 2: Removes the "47 " prefix from "47 Knight Templar Way" wherever it appears
         in any HTML file in the repo
  Fix 5: Adds the new (homepage-style) header to about.html and services.html
         (replaces existing <nav id="site-nav"> + <div id="mobile-overlay">
         and injects the supporting CSS + JS)
  Fix 6: Hardens nav CSS site-wide so the strip is taller, links bold, and
         "Areas We Cover" stays on a single line. Applied to ALL .html files
         in the repo that contain <nav id="site-nav"> so the look stays
         consistent.
  Fix 7: Adds desktop-only email click-to-copy script to ALL .html files in
         the repo. Mobile mailto: behaviour is left alone.

Run from the repo root:

    cd ~/Documents/medway-kent-removals-rochester
    python3 fix_pages.py
"""
import os
import re
import sys
import glob

# ─────────── master area list (matches generator) ───────────
ALL_AREAS = [
    ('rochester','Rochester'),('strood','Strood'),('chatham','Chatham'),
    ('gillingham','Gillingham'),('hempstead','Hempstead'),('walderslade','Walderslade'),
    ('lordswood','Lordswood'),('hoo','Hoo'),('cliffe','Cliffe'),
    ('gravesend','Gravesend'),('dartford','Dartford'),('sevenoaks','Sevenoaks'),
    ('tonbridge','Tonbridge'),('tunbridge-wells','Tunbridge Wells'),
    ('maidstone','Maidstone'),('sittingbourne','Sittingbourne'),('ashford','Ashford'),
    ('faversham','Faversham'),('whitstable','Whitstable'),('herne-bay','Herne Bay'),
    ('canterbury','Canterbury'),('margate','Margate'),('ramsgate','Ramsgate'),
    ('folkestone','Folkestone'),('dover','Dover'),('deal','Deal'),
]


# ─────────── new header markup (matches index.html) ───────────

def build_new_header():
    drop_links = '\n'.join(
        f'          <li><a href="/removals-{slug}">Removals {name}</a></li>'
        for slug, name in ALL_AREAS
    )
    mobile_links = '\n'.join(
        f'  <a class="mob-nav-link" href="/removals-{slug}" style="font-size:14px;padding-left:24px">&#8627; Removals {name}</a>'
        for slug, name in ALL_AREAS
    )

    return f'''<nav id="site-nav" role="navigation" aria-label="Main navigation">
  <div class="nav-inner">
    <a class="nav-logo" href="/" aria-label="Medway and Kent Removals Home">
      <img src="/images/mkr-logo-on-dark.webp" alt="" width="48" height="48" fetchpriority="high" decoding="async">
      <span class="nav-logo-text">Medway &amp; Kent <span>Removals</span></span>
    </a>

    <ul class="nav-links" role="list">
      <li><a href="/">Home</a></li>
      <li>
        <a href="/services">Services
          <svg class="chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" style="width:14px;height:14px;flex-shrink:0">
            <path d="M2 4l5 5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </a>
        <div class="dropdown" role="menu">
          <div class="dropdown-inner">
            <a href="/services#house" role="menuitem"><span class="dico">&#127968;</span>House Removals</a>
            <a href="/services#office" role="menuitem"><span class="dico">&#127970;</span>Office Removals</a>
            <a href="/services#packing" role="menuitem"><span class="dico">&#128230;</span>Packing Services</a>
            <a href="/services#manvan" role="menuitem"><span class="dico">&#128654;</span>Man &amp; Van</a>
            <a href="/services#storage" role="menuitem"><span class="dico">&#128274;</span>Storage</a>
            <a href="/services#longdist" role="menuitem"><span class="dico">&#128506;</span>Long Distance</a>
          </div>
        </div>
      </li>
      <li class="nav-dropdown" id="areas-dropdown">
        <button class="nav-dropdown-btn" type="button" aria-haspopup="true" aria-expanded="false">Areas We Cover</button>
        <ul class="nav-dropdown-menu">
{drop_links}
          <li class="dd-divider"></li>
          <li><a href="/areas" class="dd-all">View all 26 areas &rarr;</a></li>
        </ul>
      </li>
      <li><a href="/about">About Us</a></li>
      <li><a href="/contact">Contact</a></li>
    </ul>

    <div class="nav-actions">
      <a class="nav-phone" href="tel:01634971005" aria-label="Call Medway and Kent Removals on 01634 971005">
        <span class="nav-phone-icon" aria-hidden="true">&#128222;</span>
        <span>01634 971005</span>
      </a>
      <a class="nav-cta" href="/contact">Get a Free Quote</a>
    </div>

    <button class="mob-toggle" type="button" aria-label="Open menu" aria-controls="mobile-overlay" onclick="toggleMobile()">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>

<div id="mobile-overlay" role="dialog" aria-modal="true">
  <button class="mob-close" onclick="toggleMobile()" aria-label="Close menu">&#10005;</button>
  <img src="/images/mkr-logo-on-dark.webp" alt="Medway and Kent Removals" width="90" height="90" loading="lazy" decoding="async" style="display:block;margin:8px auto 18px;border-radius:8px">

  <a class="mob-nav-link" href="tel:01634971005" style="background:#e04e1b;color:#fff;border-radius:8px;padding:12px 16px;margin-bottom:6px;font-weight:700;text-align:center">&#128222; Call 01634 971005</a>

  <a class="mob-nav-link" href="/">Home</a>
  <a class="mob-nav-link" href="/services">Services</a>
  <a class="mob-nav-link" href="/areas">Areas We Cover</a>
{mobile_links}
  <a class="mob-nav-link" href="/about">About Us</a>
  <a class="mob-nav-link" href="/contact" style="color:#e04e1b">Get a Free Quote &#8594;</a>
</div>
'''


# ─────────── nav CSS (Fix 6 + Fix 4) ───────────

NAV_CSS_BLOCK = '''
<!-- MKR-PATCH-NAV-V2 -->
<style>
/* MKR fix-pages.py: nav restyle (taller, bold, nowrap) + dropdown hardening */
#site-nav{
  position:sticky !important;top:0 !important;z-index:1000 !important;
  background:#0d1f3c !important;
  box-shadow:0 1px 0 rgba(255,255,255,0.04), 0 4px 16px rgba(0,0,0,0.18) !important;
}
#site-nav .nav-inner{
  max-width:1280px;margin:0 auto;padding:18px 24px !important;
  display:flex !important;align-items:center !important;gap:24px;
  min-height:92px !important;
}
#site-nav .nav-logo{
  display:flex !important;align-items:center;gap:10px;
  text-decoration:none !important;color:#fff !important;
  font-family:Syne, system-ui, sans-serif !important;font-weight:700 !important;
}
#site-nav .nav-logo img{display:block;border-radius:6px}
#site-nav .nav-logo-text{font-size:16px !important;line-height:1 !important;letter-spacing:-0.01em !important;color:#fff !important}
#site-nav .nav-logo-text span{color:#e04e1b !important}

#site-nav .nav-links{
  display:flex !important;align-items:center !important;gap:6px !important;
  list-style:none !important;margin:0 !important;padding:0 !important;flex:1 !important;
}
#site-nav .nav-links li{margin:0 !important;padding:0 !important;position:relative !important}
#site-nav .nav-links li > a,
#site-nav .nav-links li > button{
  display:inline-flex !important;align-items:center !important;gap:5px !important;
  padding:10px 14px !important;
  color:#ffffff !important;text-decoration:none !important;
  font-size:15px !important;font-weight:700 !important;
  font-family:DM Sans, system-ui, sans-serif !important;
  background:none !important;border:0 !important;cursor:pointer !important;
  border-radius:6px !important;
  white-space:nowrap !important;
  transition:color 0.15s, background 0.15s !important;
}
#site-nav .nav-links li > a:hover,
#site-nav .nav-links li > button:hover{
  color:#fff !important;background:rgba(255,255,255,0.08) !important;
}

/* Areas We Cover dropdown — opaque white, dark text, on top */
#site-nav .nav-dropdown{position:relative !important}
#site-nav .nav-dropdown-menu{
  display:none !important;position:absolute !important;top:100% !important;left:0 !important;z-index:1100 !important;
  background:#ffffff !important;border:1px solid #e0e0e0 !important;border-radius:10px !important;
  box-shadow:0 10px 30px rgba(0,0,0,0.18) !important;
  min-width:260px !important;padding:8px 0 !important;margin-top:4px !important;
  list-style:none !important;max-height:70vh !important;overflow-y:auto !important;
}
#site-nav .nav-dropdown.is-open .nav-dropdown-menu{display:block !important}
#site-nav .nav-dropdown-menu li{margin:0 !important;padding:0 !important;background:transparent !important}
#site-nav .nav-dropdown-menu li a{
  display:block !important;padding:9px 18px !important;font-size:14px !important;
  color:#1a1a1a !important;background:#ffffff !important;
  text-decoration:none !important;font-weight:500 !important;
  white-space:nowrap !important;
}
#site-nav .nav-dropdown-menu li a:hover{background:#F4F8F6 !important;color:#0d1f3c !important}
#site-nav .nav-dropdown-menu .dd-divider{display:block !important;height:1px !important;background:#e0e0e0 !important;margin:6px 0 !important;padding:0 !important}
#site-nav .nav-dropdown-menu .dd-all{color:#e04e1b !important;font-weight:700 !important}

/* services hover-dropdown */
#site-nav .nav-links .dropdown{
  display:none;position:absolute;top:100%;left:0;z-index:1100;
  background:#fff;border:1px solid #e0e0e0;border-radius:10px;
  box-shadow:0 10px 30px rgba(0,0,0,0.14);
  min-width:240px;padding:8px;margin-top:4px;
}
#site-nav .nav-links .dropdown-inner{display:flex;flex-direction:column;gap:0}
#site-nav .nav-links .dropdown a{
  display:flex;align-items:center;gap:10px;
  padding:9px 12px;color:#222 !important;text-decoration:none;font-size:13.5px;font-weight:500;
  border-radius:6px;background:#fff !important;
}
#site-nav .nav-links .dropdown a:hover{background:#F4F8F6 !important}
#site-nav .nav-links .dropdown .dico{font-size:16px;width:22px;text-align:center}
#site-nav .nav-links li:hover .dropdown{display:block}

/* right-side actions: phone link + Get a Free Quote button */
#site-nav .nav-actions{
  display:flex !important;align-items:center !important;gap:10px !important;margin-left:auto !important;
}
#site-nav .nav-phone{
  display:inline-flex !important;align-items:center !important;gap:8px !important;
  padding:9px 14px !important;color:#fff !important;text-decoration:none !important;
  font-size:14.5px !important;font-weight:700 !important;
  border:1.5px solid rgba(255,255,255,0.22) !important;border-radius:8px !important;
  white-space:nowrap !important;
  transition:border-color 0.15s, background 0.15s !important;
}
#site-nav .nav-phone:hover{
  border-color:#e04e1b !important;background:rgba(224,78,27,0.10) !important;
}
#site-nav .nav-cta{
  display:inline-block !important;
  background:#e04e1b !important;color:#fff !important;
  padding:11px 18px !important;border-radius:8px !important;
  font-size:14px !important;font-weight:700 !important;text-decoration:none !important;
  white-space:nowrap !important;
}
#site-nav .nav-cta:hover{background:#c4400e !important}

/* mobile burger button */
#site-nav .mob-toggle{
  display:none;width:44px;height:44px;
  background:transparent;border:0;cursor:pointer;
  flex-direction:column;justify-content:center;gap:5px;align-items:center;
}
#site-nav .mob-toggle span{display:block;width:22px;height:2px;background:#fff;border-radius:2px}

/* mobile overlay drawer */
#mobile-overlay{
  display:none;position:fixed;inset:0;z-index:1100;
  background:#0d1f3c;overflow-y:auto;padding:20px 18px 40px;
}
#mobile-overlay.open{display:block}
#mobile-overlay .mob-close{
  position:absolute;top:14px;right:14px;
  background:transparent;border:0;color:#fff;font-size:22px;cursor:pointer;
  width:40px;height:40px;
}
.mob-nav-link{
  display:block;padding:12px 14px;
  color:#fff;text-decoration:none;font-size:16px;font-weight:500;
  border-bottom:1px solid rgba(255,255,255,0.06);
}
.mob-nav-link:hover{background:rgba(255,255,255,0.04)}

@media (max-width: 980px){
  #site-nav .nav-inner{min-height:64px !important;padding:12px 16px !important;gap:12px !important}
  #site-nav .nav-links,
  #site-nav .nav-actions{display:none !important}
  #site-nav .mob-toggle{display:flex !important}
}
</style>
'''


# ─────────── nav JS (mobile toggle, areas click-toggle) ───────────

NAV_JS_BLOCK = '''
<!-- MKR-PATCH-NAV-JS-V2 -->
<script>
function toggleMobile(){var o=document.getElementById('mobile-overlay');if(o)o.classList.toggle('open');}
document.addEventListener('DOMContentLoaded', function () {
  var dd = document.getElementById('areas-dropdown');
  if (dd) {
    var btn = dd.querySelector('.nav-dropdown-btn');
    if (btn) btn.addEventListener('click', function (e) {
      e.stopPropagation();
      dd.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', dd.classList.contains('is-open') ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!dd.contains(e.target)) dd.classList.remove('is-open');
    });
  }
});
</script>
'''


# ─────────── email click-to-copy (Fix 7) ───────────

EMAIL_COPY_JS = '''
<!-- MKR-PATCH-EMAIL-COPY -->
<script>
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var isDesktop = window.matchMedia && window.matchMedia('(hover: hover)').matches;
    if (!isDesktop) return;
    document.querySelectorAll('a[href^="mailto:"]').forEach(function(link){
      link.addEventListener('click', function(){
        var addr = link.getAttribute('href').replace(/^mailto:/i, '').split('?')[0];
        if (!addr) return;
        var done = function(){ showToast('Email copied: ' + addr); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(addr).then(done).catch(done);
        } else {
          var ta = document.createElement('textarea');
          ta.value = addr; ta.style.position='fixed'; ta.style.opacity='0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch(_) {}
          document.body.removeChild(ta); done();
        }
      });
    });
    function showToast(msg){
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;bottom:30px;right:30px;background:#0d1f3c;color:#fff;padding:14px 22px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.3);z-index:99999;font-family:DM Sans,system-ui,sans-serif;font-size:14px;font-weight:600;transition:opacity 0.3s';
      document.body.appendChild(t);
      setTimeout(function(){ t.style.opacity='0'; }, 2200);
      setTimeout(function(){ if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
    }
  });
})();
</script>
'''


# ─────────── PATCH FUNCTIONS ───────────

def patch_remove_47(html):
    """Fix 2: Remove '47 ' before 'Knight Templar Way' everywhere."""
    new = html.replace('47 Knight Templar Way', 'Knight Templar Way')
    # Also handle URL-encoded variant in the maps link
    new = new.replace('47+Knight+Templar+Way', 'Knight+Templar+Way')
    return new, new != html


def patch_remove_google_rating(html):
    """Fix 1: Remove the 'Google rating: 4.9 out of 5' row from about.html.
    Tries multiple HTML structures (dt/dd, dl pair, div with strong/span, li
    with strong+text). Idempotent."""
    if '4.9 out of 5' not in html:
        return html, False

    original = html

    # Pattern A: <dt>Google rating</dt><dd>4.9 out of 5</dd>
    html = re.sub(
        r'<dt[^>]*>\s*Google rating\s*</dt>\s*<dd[^>]*>\s*4\.9 out of 5\s*</dd>',
        '', html, flags=re.IGNORECASE | re.DOTALL
    )

    # Pattern B: <li>...<strong>Google rating</strong><span>4.9 out of 5</span>...</li>
    html = re.sub(
        r'<li[^>]*>\s*(?:<[^>]+>\s*)*Google rating\s*(?:</[^>]+>\s*)*\s*(?:<[^>]+>\s*)*4\.9 out of 5\s*(?:</[^>]+>\s*)*</li>',
        '', html, flags=re.IGNORECASE | re.DOTALL
    )

    # Pattern C: container div with Google rating + 4.9 out of 5 inside (compact form)
    html = re.sub(
        r'<div[^>]*>\s*<(?:strong|span|h\d|p|dt)[^>]*>\s*Google rating\s*</(?:strong|span|h\d|p|dt)>\s*<(?:span|p|dd)[^>]*>\s*4\.9 out of 5\s*</(?:span|p|dd)>\s*</div>',
        '', html, flags=re.IGNORECASE | re.DOTALL
    )

    # Pattern D: <p><strong>Google rating</strong>4.9 out of 5</p> (markdown extract suggested
    # text was "Google rating4.9 out of 5" with no space — typical of <strong>+text)
    html = re.sub(
        r'<p[^>]*>\s*<strong[^>]*>\s*Google rating\s*</strong>\s*4\.9 out of 5\s*</p>',
        '', html, flags=re.IGNORECASE | re.DOTALL
    )

    # Pattern E: <div><strong>Google rating</strong>4.9 out of 5</div>
    html = re.sub(
        r'<div[^>]*>\s*<strong[^>]*>\s*Google rating\s*</strong>\s*4\.9 out of 5\s*</div>',
        '', html, flags=re.IGNORECASE | re.DOTALL
    )

    return html, html != original


def patch_replace_nav(html):
    """Fix 5: Replace existing <nav id="site-nav">...</nav> + <div id="mobile-overlay">...</div>
    with the new homepage-style header. Idempotent (skips if already updated)."""
    # Detect "already new" marker — the new nav has class="nav-actions"
    if 'class="nav-actions"' in html and 'nav-phone' in html:
        return html, False

    new_header = build_new_header()

    # Replace the old <nav id="site-nav">...</nav>
    nav_pattern = re.compile(r'<nav id="site-nav"[^>]*>.*?</nav>', re.DOTALL)
    if not nav_pattern.search(html):
        return html, False

    # Replace the old <div id="mobile-overlay">...</div>
    overlay_pattern = re.compile(r'<div id="mobile-overlay"[^>]*>.*?</div>\s*(?=<)', re.DOTALL)

    new_html = nav_pattern.sub('__MKR_NAV_PLACEHOLDER__', html, count=1)
    new_html = overlay_pattern.sub('', new_html, count=1)
    new_html = new_html.replace('__MKR_NAV_PLACEHOLDER__', new_header)

    return new_html, new_html != html


def patch_inject_css(html):
    """Fix 6 + 4: inject the nav CSS block before </head>. Idempotent."""
    if 'MKR-PATCH-NAV-V2' in html:
        return html, False
    if '</head>' not in html:
        return html, False
    new_html = html.replace('</head>', NAV_CSS_BLOCK + '\n</head>', 1)
    return new_html, True


def patch_inject_nav_js(html):
    """Inject the nav JS (toggleMobile + areas click-toggle) before </body>. Idempotent."""
    if 'MKR-PATCH-NAV-JS-V2' in html:
        return html, False
    if '</body>' not in html:
        return html, False
    new_html = html.replace('</body>', NAV_JS_BLOCK + '\n</body>', 1)
    return new_html, True


def patch_inject_email_copy(html):
    """Fix 7: inject email click-to-copy script before </body>. Idempotent."""
    if 'MKR-PATCH-EMAIL-COPY' in html:
        return html, False
    if '</body>' not in html:
        return html, False
    new_html = html.replace('</body>', EMAIL_COPY_JS + '\n</body>', 1)
    return new_html, True


# ─────────── DRIVER ───────────

def patch_file(path, do_replace_nav=False, do_remove_google_rating=False):
    """Apply the patches relevant to this file. Returns list of actions taken."""
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as f:
        html = f.read()
    original = html
    actions = []

    # Fix 2 — remove "47 " before address (all files)
    html, changed = patch_remove_47(html)
    if changed: actions.append('rm-47')

    # Fix 1 — remove Google rating row (about.html only)
    if do_remove_google_rating:
        html, changed = patch_remove_google_rating(html)
        if changed: actions.append('rm-google-rating')

    # Fix 5 — swap to new nav (about.html + services.html only)
    if do_replace_nav:
        html, changed = patch_replace_nav(html)
        if changed: actions.append('new-nav')

    # Fix 6 + 4 — inject nav CSS (taller, bold, nowrap, opaque dropdown)
    # Only on files that have <nav id="site-nav">
    if '<nav id="site-nav"' in html or '__MKR_NAV_PLACEHOLDER__' in original:
        html, changed = patch_inject_css(html)
        if changed: actions.append('nav-css')
        # also inject nav JS so the click-toggle dropdown works
        html, changed = patch_inject_nav_js(html)
        if changed: actions.append('nav-js')

    # Fix 7 — email click-to-copy (all files)
    html, changed = patch_inject_email_copy(html)
    if changed: actions.append('email-copy')

    if html != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(html)

    return actions


if __name__ == '__main__':
    # Discover all HTML files in the repo root
    repo_root = os.getcwd()
    html_files = sorted(glob.glob('*.html'))

    if not html_files:
        print(f'No HTML files found in {repo_root}')
        print('Run this script from the repo root.')
        sys.exit(1)

    print(f'Patching {len(html_files)} HTML files...\n')
    total_changed = 0
    for path in html_files:
        # Specific per-file rules:
        do_replace_nav         = path in ('about.html', 'services.html')
        do_remove_google       = path == 'about.html'

        actions = patch_file(path, do_replace_nav, do_remove_google)
        if actions is None:
            print(f'  - {path:38} (not found)')
        elif actions:
            print(f'  ✔ {path:38} {", ".join(actions)}')
            total_changed += 1
        else:
            print(f'  · {path:38} (no change)')

    print(f'\n{total_changed} file(s) updated.')
    if total_changed:
        print('\nNext: git add -A && git commit -m "Fix nav, dropdown, header style, addresses, email click-to-copy" && git push')

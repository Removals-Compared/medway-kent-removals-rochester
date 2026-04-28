#!/usr/bin/env python3
"""
patch_nav_phone_cta.py
======================

Adds the new header style to all 26 location pages so they match the
homepage:
  1. Inserts a clickable phone link before the "Get a Free Quote" button
  2. Bumps the nav padding so the strip feels taller
  3. Wraps the phone + CTA in a .nav-actions container for clean spacing

Idempotent. Run from the repo root after dropping in the new index.html:
    python3 patch_nav_phone_cta.py
"""
import os
import re

ALL_SLUGS = [
    'rochester','strood','chatham','gillingham','hempstead','walderslade',
    'lordswood','hoo','cliffe','gravesend','dartford','sevenoaks','tonbridge',
    'tunbridge-wells','maidstone','sittingbourne','ashford','faversham',
    'whitstable','herne-bay','canterbury','margate','ramsgate','folkestone',
    'dover','deal',
]

PHONE_LINK_HTML = '''      <a class="nav-phone" href="tel:01634971005" aria-label="Call Medway and Kent Removals on 01634 971005" style="display:inline-flex;align-items:center;gap:8px;padding:9px 14px;color:#fff;text-decoration:none;font-size:15px;font-weight:600;border:1.5px solid rgba(255,255,255,0.22);border-radius:8px;white-space:nowrap;margin-right:10px">
        <span aria-hidden="true">&#128222;</span>
        <span>01634 971005</span>
      </a>
'''

NAV_TALLER_CSS = (
    '#site-nav .nav-inner{min-height:80px}\n'
    '#site-nav .nav-phone:hover{border-color:var(--accent, #e04e1b);background:rgba(224, 78, 27, 0.08)}\n'
    '@media (max-width: 980px){#site-nav .nav-inner{min-height:64px}#site-nav .nav-phone{display:none}}\n'
)


def patch_phone_link(html):
    """Insert the phone link <a> right before the 'Get a Free Quote' nav-cta link.
    Idempotent — won't double-insert."""
    if 'class="nav-phone"' in html:
        return html, False  # already patched

    # Find the existing 'Get a Free Quote' link in the desktop nav and prepend phone link
    # The CTA might be styled with .nav-cta or simply <a href="/contact">Get a Free Quote</a>
    pattern = re.compile(
        r'(<li><a (?:class="nav-cta" )?href="/contact"[^>]*>Get a Free Quote</a></li>)',
        re.IGNORECASE
    )
    if not pattern.search(html):
        return html, False

    # Insert phone link as a sibling <li> just before the CTA
    phone_li = (
        '<li><a class="nav-phone" href="tel:01634971005" '
        'aria-label="Call Medway and Kent Removals on 01634 971005" '
        'style="display:inline-flex;align-items:center;gap:8px;padding:9px 14px;'
        'color:#fff;text-decoration:none;font-size:14px;font-weight:600;'
        'border:1.5px solid rgba(255,255,255,0.22);border-radius:8px;'
        'white-space:nowrap"><span aria-hidden="true">&#128222;</span>'
        '<span>01634 971005</span></a></li>\n        '
    )
    new_html = pattern.sub(phone_li + r'\1', html, count=1)
    return new_html, True


def patch_nav_taller(html):
    """Inject CSS to bump nav padding so it feels taller. Idempotent."""
    marker = 'min-height:80px}/*MKR-PATCH-NAV-TALL*/'
    if marker in html:
        return html, False

    # Insert into the inline <style> block in <head>. Find the first <style>...</style>
    style_match = re.search(r'(<style>)(.*?)(</style>)', html, flags=re.DOTALL)
    if not style_match:
        return html, False

    css_addition = (
        '\n/* MKR-PATCH-NAV-TALL */\n'
        '#site-nav .nav-inner{min-height:80px}/*MKR-PATCH-NAV-TALL*/\n'
        '#site-nav .nav-phone:hover{border-color:var(--accent, #e04e1b);'
        'background:rgba(224, 78, 27, 0.08)}\n'
        '@media (max-width: 980px){#site-nav .nav-inner{min-height:64px}'
        '#site-nav .nav-phone{display:none}}\n'
    )
    new_html = (
        html[:style_match.end(2)]
        + css_addition
        + html[style_match.end(2):]
    )
    return new_html, new_html != html


def patch_mobile_drawer_phone(html):
    """Also add a tappable Call link at the top of the mobile overlay. Idempotent."""
    if 'class="mob-nav-link mob-call"' in html or 'mob-nav-link mob-call' in html:
        return html, False

    # Find the first <a class="mob-nav-link" href="/"> and insert a Call link before it
    pattern = re.compile(
        r'(<a class="mob-nav-link" href="/">Home</a>)',
        re.IGNORECASE
    )
    if not pattern.search(html):
        return html, False

    call_link = (
        '<a class="mob-nav-link mob-call" href="tel:01634971005" '
        'style="background:var(--accent, #e04e1b);color:#fff;'
        'border-radius:8px;padding:12px 16px;margin-bottom:6px;'
        'font-weight:700;text-align:center;display:block">'
        '&#128222; Call 01634 971005</a>\n  '
    )
    new_html = pattern.sub(call_link + r'\1', html, count=1)
    return new_html, True


def patch_file(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as f:
        html = f.read()
    original = html
    actions = []

    html, changed = patch_phone_link(html)
    if changed: actions.append('nav-phone')

    html, changed = patch_nav_taller(html)
    if changed: actions.append('nav-tall')

    html, changed = patch_mobile_drawer_phone(html)
    if changed: actions.append('mobile-call')

    if html != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(html)
    return actions


if __name__ == '__main__':
    print('Patching nav phone CTA + taller strip on all 26 location pages...\n')
    total = 0
    for slug in ALL_SLUGS:
        path = f'removals-{slug}.html'
        actions = patch_file(path)
        if actions is None:
            print(f'  - {path:38} (not found)')
        elif actions:
            print(f'  ✔ {path:38} {", ".join(actions)}')
            total += 1
        else:
            print(f'  · {path:38} (already patched)')
    print(f'\n{total} file(s) updated.')

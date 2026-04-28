#!/usr/bin/env python3
"""
fix_all_pages.py
================

Run ONCE from the repo root. Idempotent (safe to re-run).

Fixes three things across the whole site:

  1. FAVICON  - adds favicon link tags to every HTML file's <head>
                (fixes the "world icon" showing in the browser tab)
  2. EXISTING 10 PAGES (Phase 1) - logo image in nav, 26-link dropdown,
                26-link mobile drawer, updated footer "Areas We Cover"
  3. NEW 16 PAGES + areas.html - already fine, only get the favicon update

Just run:
    cd ~/Documents/medway-kent-removals-rochester
    python3 fix_all_pages.py
"""
import os
import re
import sys

# Master 26-location list (same order as the generator)
ALL_LOCATIONS = [
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
NAME_BY_SLUG = dict(ALL_LOCATIONS)

# 10 existing Phase 1 pages (need full nav/footer/logo patch)
EXISTING_10 = ['maidstone','chatham','gillingham','dartford','strood','sittingbourne',
               'gravesend','canterbury','tonbridge','faversham']

# 16 new Phase 2 pages (only need favicon)
NEW_16 = ['walderslade','lordswood','hoo','cliffe','hempstead','rochester',
          'tunbridge-wells','ashford','sevenoaks','folkestone','margate','ramsgate',
          'whitstable','herne-bay','dover','deal']

# Footer block prominent areas (5 + All Areas)
FOOTER_PROMINENT = ['rochester','chatham','gillingham','maidstone','gravesend','dartford','canterbury']


# ---------- BUILDERS ----------

def build_favicon_block():
    return ('<link rel="icon" type="image/webp" href="/images/mkr-logo-on-dark.webp">\n'
            '<link rel="shortcut icon" type="image/webp" href="/images/mkr-logo-on-dark.webp">\n'
            '<link rel="apple-touch-icon" href="/images/mkr-logo-on-dark.webp">\n'
            '<meta name="theme-color" content="#0d1f3c">')


def build_dropdown_inner(current_slug):
    out = []
    for slug, name in ALL_LOCATIONS:
        if slug == current_slug:
            out.append(f'          <li><a href="/removals-{slug}" aria-current="page" class="dd-active">Removals {name}</a></li>')
        else:
            out.append(f'          <li><a href="/removals-{slug}">Removals {name}</a></li>')
    return '\n'.join(out)


def build_mobile_drawer_links():
    return '\n'.join(
        f'  <a class="mob-nav-link" href="/removals-{s}" style="font-size:14px;padding-left:24px">&#8627; Removals {n}</a>'
        for s, n in ALL_LOCATIONS
    )


def build_footer_areas(current_slug):
    selected = [(s, n) for s, n in ALL_LOCATIONS if s in FOOTER_PROMINENT and s != current_slug][:5]
    items = [f'<li><a href="/removals-{s}">Removals {n}</a></li>' for s, n in selected]
    items.append('<li><a href="/areas">All Areas</a></li>')
    return ''.join(items)


# ---------- PATCHERS ----------

def patch_favicon(html):
    """Insert favicon block before </head>. Idempotent."""
    if 'rel="icon"' in html and 'mkr-logo-on-dark.webp' in html.split('</head>')[0]:
        return html, False
    fav = build_favicon_block()
    new_html = html.replace('</head>', fav + '\n</head>', 1)
    return new_html, new_html != html


def patch_logo_in_nav(html):
    """
    If <a class="nav-logo" href="/" ...> exists but contains no <img> tag, inject one.
    If the nav-logo class doesn't exist, try the first <a href="/"> inside <nav>.
    Idempotent.
    """
    # Already has the logo image in the nav?
    nav_match = re.search(r'<nav[^>]*id="site-nav"[^>]*>(.*?)</nav>', html, re.DOTALL)
    if nav_match and 'mkr-logo-on-dark.webp' in nav_match.group(1):
        return html, False  # already has logo

    # Look for a <a class="nav-logo" ...>...</a> without an img inside
    pattern = re.compile(
        r'(<a class="nav-logo"[^>]*>)(\s*)(<span class="nav-logo-text">)',
        re.DOTALL
    )
    img_tag = ('<img src="/images/mkr-logo-on-dark.webp" alt="" width="44" height="44" '
               'fetchpriority="high" decoding="async">')
    if pattern.search(html):
        new_html = pattern.sub(r'\1' + img_tag + r'\3', html, count=1)
        return new_html, True

    # Fallback: if there's a brand link <a class="brand" href="/">TEXT</a>
    pattern2 = re.compile(
        r'(<a class="brand"[^>]*>)([^<]+)(</a>)',
        re.DOTALL
    )
    m = pattern2.search(html)
    if m:
        text = m.group(2).strip()
        replacement = (m.group(1) + img_tag +
                       f'<span class="nav-logo-text">{text}</span>' + m.group(3))
        new_html = pattern2.sub(replacement, html, count=1)
        return new_html, True

    # Last resort: <a href="/"...>Medway & Kent Removals</a>
    pattern3 = re.compile(
        r'(<a href="/"[^>]*>)([^<]*Medway[^<]*Kent[^<]*Removals[^<]*)(</a>)',
        re.IGNORECASE
    )
    m = pattern3.search(html)
    if m:
        text = m.group(2).strip()
        # Inject class and an inner img + span
        anchor_open = m.group(1).replace('<a ', '<a class="nav-logo" ', 1)
        replacement = (anchor_open + img_tag +
                       f'<span class="nav-logo-text">{text}</span>' + m.group(3))
        new_html = pattern3.sub(replacement, html, count=1)
        return new_html, True

    return html, False


def patch_dropdown(html, current_slug):
    """Replace contents of <ul class="nav-dropdown-menu">…</ul>."""
    new_inner = build_dropdown_inner(current_slug)
    pattern = r'(<ul class="nav-dropdown-menu">)(.*?)(</ul>)'
    if not re.search(pattern, html, flags=re.DOTALL):
        return html, False
    replacement = r'\1\n' + new_inner + r'\n        \3'
    new_html = re.sub(pattern, replacement, html, count=1, flags=re.DOTALL)
    return new_html, new_html != html


def patch_mobile_drawer(html):
    """Replace existing /removals-* links between Areas We Cover and About Us."""
    new_links = build_mobile_drawer_links()
    pattern = re.compile(
        r'(<a class="mob-nav-link" href="/areas">[^<]*</a>\s*)'
        r'(?:<a class="mob-nav-link" href="/removals-[a-z\-]+"[^>]*>[^<]*</a>\s*)+'
        r'(<a class="mob-nav-link" href="/about">[^<]*</a>)',
        re.DOTALL
    )
    if not pattern.search(html):
        return html, False
    replacement = r'\1\n' + new_links + r'\n  \2'
    new_html = pattern.sub(replacement, html, count=1)
    return new_html, new_html != html


def patch_footer_areas(html, current_slug):
    """Replace the footer 'Areas We Cover' <ul> contents."""
    new_inner = build_footer_areas(current_slug)
    pattern = r'(<div class="footer-col"><h3>Areas We Cover</h3><ul>)(.*?)(</ul></div>)'
    if not re.search(pattern, html, flags=re.DOTALL):
        return html, False
    replacement = r'\1' + new_inner + r'\3'
    new_html = re.sub(pattern, replacement, html, count=1, flags=re.DOTALL)
    return new_html, new_html != html


# ---------- DRIVER ----------

def patch_file(path, slug=None):
    """slug=None means it's a non-location page (homepage, areas, services, etc.)."""
    if not os.path.exists(path):
        return None
    with open(path, encoding='utf-8') as f:
        html = f.read()
    original = html
    actions = []

    # Always: favicon
    html, changed = patch_favicon(html)
    if changed: actions.append('favicon')

    # Location-page-specific patches
    if slug:
        if slug in EXISTING_10:
            html, changed = patch_logo_in_nav(html)
            if changed: actions.append('logo')
            html, changed = patch_dropdown(html, slug)
            if changed: actions.append('dropdown(26)')
            html, changed = patch_mobile_drawer(html)
            if changed: actions.append('mobile-drawer(26)')
            html, changed = patch_footer_areas(html, slug)
            if changed: actions.append('footer-areas')

    if html != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(html)

    return actions


if __name__ == '__main__':
    print('Patching all HTML files in repo root...\n')
    targets = []

    # Core pages (no slug)
    for fn in ['index.html', 'areas.html', 'services.html', 'about.html', 'contact.html', 'privacy-policy.html']:
        targets.append((fn, None))

    # All 26 location pages
    for slug, _ in ALL_LOCATIONS:
        targets.append((f'removals-{slug}.html', slug))

    total_changed = 0
    for path, slug in targets:
        actions = patch_file(path, slug)
        if actions is None:
            print(f'  - {path:42} (not found, skipping)')
        elif actions:
            print(f'  ✔ {path:42} {", ".join(actions)}')
            total_changed += 1
        else:
            print(f'  · {path:42} (no change)')

    print(f'\n{total_changed} file(s) updated.')
    print('Push to git when ready.')

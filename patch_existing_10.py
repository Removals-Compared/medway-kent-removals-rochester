#!/usr/bin/env python3
"""
Updates the 10 existing Phase 1 location pages so their:
  1. Desktop dropdown (.nav-dropdown-menu)
  2. Mobile overlay drawer (.mob-nav-link block)
  3. Footer 'Areas We Cover' column

…all link to all 26 location pages.

Run from the repo root:
    python3 patch_existing_10.py

Idempotent: safe to re-run.
"""
import os
import re
import sys

# Master ordered list of all 26 locations (matches generator)
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

# The 10 existing Phase 1 slugs (the ones to patch)
EXISTING_10 = ['maidstone','chatham','gillingham','dartford','strood','sittingbourne',
               'gravesend','canterbury','tonbridge','faversham']

# Footer prominent areas (5 shown + All Areas link)
FOOTER_PROMINENT = ['rochester','chatham','gillingham','maidstone','gravesend','dartford','canterbury']


def build_dropdown_inner(current_slug):
    """Build the inner <li> list for the desktop dropdown."""
    out = []
    for slug, name in ALL_LOCATIONS:
        if slug == current_slug:
            out.append(f'          <li><a href="/removals-{slug}" aria-current="page" class="dd-active">Removals {name}</a></li>')
        else:
            out.append(f'          <li><a href="/removals-{slug}">Removals {name}</a></li>')
    return '\n'.join(out)


def build_mobile_drawer_links():
    """Build all 26 mobile drawer links."""
    return '\n'.join(
        f'  <a class="mob-nav-link" href="/removals-{s}" style="font-size:14px;padding-left:24px">&#8627; Removals {n}</a>'
        for s, n in ALL_LOCATIONS
    )


def build_footer_areas(current_slug):
    """Build the footer Areas We Cover <ul> inner items."""
    selected = [(s, n) for s, n in ALL_LOCATIONS if s in FOOTER_PROMINENT and s != current_slug][:5]
    items = [f'<li><a href="/removals-{s}">Removals {n}</a></li>' for s, n in selected]
    items.append('<li><a href="/areas">All Areas</a></li>')
    return ''.join(items)


def patch_dropdown(html, current_slug):
    """Replace contents of <ul class="nav-dropdown-menu"> ... </ul>."""
    new_inner = build_dropdown_inner(current_slug)
    pattern = r'(<ul class="nav-dropdown-menu">)(.*?)(</ul>)'
    replacement = r'\1\n' + new_inner + r'\n        \3'
    new_html, n = re.subn(pattern, replacement, html, count=1, flags=re.DOTALL)
    if n == 0:
        raise RuntimeError(f'  ! could not find <ul class="nav-dropdown-menu"> in {current_slug}')
    return new_html


def patch_mobile_drawer(html):
    """
    The mobile drawer in existing pages has:
      <a class="mob-nav-link" href="/areas">Areas We Cover</a>
      [10 location links here]
      <a class="mob-nav-link" href="/about">About Us</a>
    Replace the 10 location links with all 26.
    """
    new_links = build_mobile_drawer_links()
    pattern = re.compile(
        r'(<a class="mob-nav-link" href="/areas">Areas We Cover</a>\s*)'
        r'(?:<a class="mob-nav-link" href="/removals-[a-z\-]+"[^>]*>[^<]*</a>\s*)+'
        r'(<a class="mob-nav-link" href="/about">About Us</a>)',
        re.DOTALL
    )
    replacement = r'\1\n' + new_links + r'\n  \2'
    new_html, n = pattern.subn(replacement, html, count=1)
    if n == 0:
        raise RuntimeError('  ! could not find mobile drawer location-links block')
    return new_html


def patch_footer_areas(html, current_slug):
    """Replace the footer 'Areas We Cover' <ul> contents."""
    new_inner = build_footer_areas(current_slug)
    pattern = r'(<div class="footer-col"><h3>Areas We Cover</h3><ul>)(.*?)(</ul></div>)'
    replacement = r'\1' + new_inner + r'\3'
    new_html, n = re.subn(pattern, replacement, html, count=1, flags=re.DOTALL)
    if n == 0:
        raise RuntimeError(f'  ! could not find footer Areas We Cover block in {current_slug}')
    return new_html


def patch_file(slug):
    path = f'removals-{slug}.html'
    if not os.path.exists(path):
        print(f'  ! {path} not found, skipping')
        return False
    with open(path, encoding='utf-8') as f:
        html = f.read()
    original = html
    html = patch_dropdown(html, slug)
    html = patch_mobile_drawer(html)
    html = patch_footer_areas(html, slug)
    if html == original:
        print(f'  - {slug}: no change (already up to date)')
        return False
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'  ✔ {slug}: dropdown + mobile drawer + footer patched')
    return True


if __name__ == '__main__':
    print(f'Patching {len(EXISTING_10)} existing Phase 1 pages…\n')
    changed = 0
    for slug in EXISTING_10:
        try:
            if patch_file(slug):
                changed += 1
        except RuntimeError as e:
            print(f'  ✘ {slug}: {e}')
            sys.exit(1)
    print(f'\nDone. {changed}/{len(EXISTING_10)} files updated.')

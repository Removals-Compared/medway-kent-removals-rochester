#!/usr/bin/env python3
"""
fix_v3.py
=========

Surgical patcher for three things, idempotent.

  Fix 1: Inserts six service images into services.html, one per service,
         immediately above each service's CTA button (which sits directly
         under the quick-facts card). Images: house removals = family,
         office = loaded lorry, packing = boxes, man-and-van = van on road,
         storage = clean room, long-distance = period destination.

  Fix 2: Thorough sweep of every HTML file in the repo to remove the
         leading "47 " from any "Knight Templar Way" reference. Handles
         plain text, +-encoded URLs, %20-encoded URLs, and JSON-LD
         schema strings. Also REPORTS any other "47" found within 50
         characters of "Knight", "Rochester" or "ME2" so you can verify
         nothing was missed.

  Fix 3: Lists every patcher script that was added to the repo over time
         so you can delete them. (See the printed cleanup commands at the
         end of the run.)

Run from the repo root:

    cd ~/Documents/medway-kent-removals-rochester
    python3 fix_v3.py
"""
import os
import re
import sys
import glob


# ─────────── SERVICE IMAGES (Fix 1) ───────────
# Each tuple: (CTA-button text, image filename, alt text, caption)

SERVICE_IMAGES = [
    (
        'Get a Free House Removal Quote',
        'family-moving-in.webp',
        'A family settling into their new Kent home after a Medway and Kent Removals house move',
        'Helping a Kent family settle into their new home: every house removal handled with care.',
        'house-removals',
    ),
    (
        'Get an Office Removal Quote',
        'moving-truck-loaded.webp',
        'Medway and Kent Removals lorry loaded and ready for an office relocation',
        'One of our removal lorries loaded for an office relocation across Medway.',
        'office-removals',
    ),
    (
        'Get a Packing Service Quote',
        'unpacking-new-home.webp',
        'Professionally packed and labelled moving boxes prepared by our team',
        'Professionally packed, labelled and protected: ready for the move.',
        'packing-services',
    ),
    (
        'Get a Man and Van Quote',
        'removals-van-on-road.webp',
        'Medway and Kent Removals man and van on the road in Kent',
        'Our man-and-van service on the road, available across Rochester, Medway and Kent.',
        'man-and-van',
    ),
    (
        'Enquire About Storage',
        'modern-living-room-interior.webp',
        'A clean, organised living space representative of how items are kept in our secure storage',
        'Clean, dry and monitored: your belongings kept safe in our secure storage facility near Rochester.',
        'storage',
    ),
    (
        'Get a Long Distance Quote',
        'period-flint-cottages.webp',
        'A traditional British home, the kind of destination our long-distance removals deliver to',
        'Long-distance moves from Kent to anywhere in mainland Great Britain.',
        'long-distance',
    ),
]


def build_image_block(filename, alt, caption, key):
    return (
        f'<!-- MKR-PATCH-SERVICE-IMG-{key} -->\n'
        f'<figure class="service-img" style="margin:36px auto 28px;text-align:center;max-width:920px">\n'
        f'  <img src="/images/{filename}" alt="{alt}" '
        f'loading="lazy" decoding="async" '
        f'style="width:100%;height:auto;border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,0.12);display:block">\n'
        f'  <figcaption style="margin-top:12px;font-size:13.5px;color:#666;line-height:1.5;font-style:italic">{caption}</figcaption>\n'
        f'</figure>\n'
    )


def patch_service_images(html):
    """Insert six images into services.html, one before each CTA button.
    Idempotent: skips a service if its marker comment is already present."""
    actions = []
    for cta_text, filename, alt, caption, key in SERVICE_IMAGES:
        marker = f'MKR-PATCH-SERVICE-IMG-{key}'
        if marker in html:
            continue  # already inserted

        # Match the entire <a>...CTA_TEXT...</a> element without crossing
        # into other anchors.
        pattern = re.compile(
            r'<a\b[^>]*>(?:(?!</a>)[\s\S])*?'
            + re.escape(cta_text)
            + r'(?:(?!</a>)[\s\S])*?</a>',
            re.IGNORECASE,
        )
        m = pattern.search(html)
        if not m:
            actions.append(f'!{key}-not-found')
            continue

        block = build_image_block(filename, alt, caption, key)
        html = html[: m.start()] + block + html[m.start():]
        actions.append(key)
    return html, actions


# ─────────── THOROUGH 47 REMOVAL (Fix 2) ───────────

def remove_47(html):
    """Strip the leading '47 ' from every reference to Knight Templar Way.
    Handles plain text, +-encoded URLs, %20-encoded URLs and any
    whitespace variants. Idempotent."""
    original = html

    # Plain text with any whitespace between 47 and Knight Templar Way
    html = re.sub(r'\b47\s+Knight\s+Templar\s+Way', 'Knight Templar Way', html)

    # URL: +-encoded (Google Maps style)
    html = html.replace('47+Knight+Templar+Way', 'Knight+Templar+Way')

    # URL: %20 encoded
    html = re.sub(r'47%20Knight%20Templar%20Way', 'Knight%20Templar%20Way', html, flags=re.IGNORECASE)

    # Sometimes the building number is glued to the street with no whitespace
    # in pasted addresses, e.g. "47Knight Templar Way" — defensive
    html = re.sub(r'\b47Knight\s+Templar\s+Way', 'Knight Templar Way', html)

    return html, html != original


def find_orphan_47(html, path):
    """Report any '47' tokens within 50 chars of Knight, Rochester, or ME2.
    These would be ones the replacements above did not catch."""
    findings = []
    for m in re.finditer(r'\b47\b', html):
        start = max(0, m.start() - 50)
        end = min(len(html), m.end() + 50)
        context = html[start:end].replace('\n', ' ').replace('\r', ' ')
        # Only flag if it looks address-related
        if any(k in context for k in ('Knight', 'Rochester', 'ME2', 'Templar')):
            findings.append((path, m.start(), context.strip()))
    return findings


# ─────────── DRIVER ───────────

def patch_file(path):
    if not os.path.exists(path):
        return None, []
    with open(path, encoding='utf-8') as f:
        html = f.read()
    original = html
    actions = []

    # Fix 2: remove 47
    html, changed = remove_47(html)
    if changed:
        actions.append('rm-47')

    # Fix 1: insert service images (services.html only)
    if os.path.basename(path) == 'services.html':
        html, img_actions = patch_service_images(html)
        if img_actions:
            actions.append('imgs:' + ','.join(img_actions))

    if html != original:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(html)

    # Find orphan 47s after the patch
    orphans = find_orphan_47(html, path)
    return actions, orphans


def main():
    html_files = sorted(glob.glob('*.html'))
    if not html_files:
        print(f'No HTML files in {os.getcwd()}. Run from repo root.')
        sys.exit(1)

    print(f'Patching {len(html_files)} HTML files...\n')
    total = 0
    all_orphans = []
    services_present = False

    for path in html_files:
        if path == 'services.html':
            services_present = True
        actions, orphans = patch_file(path)
        if actions is None:
            print(f'  - {path:38} (not found)')
        elif actions:
            print(f'  ✔ {path:38} {", ".join(actions)}')
            total += 1
        else:
            print(f'  · {path:38} (no change)')
        all_orphans.extend(orphans)

    print(f'\n{total} file(s) updated.')

    if not services_present:
        print('\n⚠  services.html not found in this directory.')
        print('   Service-page images were not inserted. Run this script from')
        print('   the repo root and confirm services.html is present.')

    # Orphan 47 report
    if all_orphans:
        print('\n⚠  Orphan "47" mentions found near Knight/Rochester/ME2:')
        for path, pos, ctx in all_orphans:
            print(f'   {path} @ char {pos}: ...{ctx}...')
        print('\n   These were NOT auto-removed because the surrounding text')
        print('   did not match a known address pattern. Open each file and')
        print('   review manually.')
    else:
        print('\n✓  No orphan "47" mentions found anywhere in the repo.')

    # Fix 3: cleanup instructions
    print('\n' + '=' * 70)
    print('FIX 3: Clean up patcher scripts left in the repo')
    print('=' * 70)
    patchers = [
        'fix_pages.py',
        'fix_all_pages.py',
        'patch_nav_phone_cta.py',
        'patch_existing_10.py',
        'fix_v3.py',  # this script itself
    ]
    found = [p for p in patchers if os.path.exists(p)]
    if found:
        print('\nThe following patcher scripts are still in your repo and should')
        print('be deleted (they are not part of the live site, just one-shot tools):')
        for p in found:
            print(f'  - {p}')
        print('\nRun these commands AFTER you have confirmed the fixes work:')
        print('')
        print('    git add -A && git commit -m "Service images + thorough 47 cleanup"')
        print('    git push origin main')
        print('    # Verify on the live site, then:')
        print('    rm -f ' + ' '.join(found))
        print('    rm -rf __pycache__')
        print('    git add -A && git commit -m "Remove temporary patcher scripts"')
        print('    git push origin main')
    else:
        print('\n✓  No leftover patcher scripts found in the repo.')

    print()


if __name__ == '__main__':
    main()

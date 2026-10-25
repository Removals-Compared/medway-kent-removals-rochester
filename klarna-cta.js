/* ── Klarna "Instant quote & pay" card ─────────────────────
   A small floating card, Klarna pink, linking to /instant-quote.
   Floats over the page (position:fixed) so it never moves content or
   adds layout shift. Loaded by sticky-bar.js on every public page; the
   few pages without sticky-bar.js load it directly. Dismissible. */
(function () {
  if (window.__mkrKlarnaCta) return;
  window.__mkrKlarnaCta = true;
  var path = location.pathname.replace(/\/+$/, '') || '/';
  if (/^\/(instant-quote|booking-confirmed|thank-you|admin)/.test(path)) return;
  var KEY = 'mkr_klarna_cta_closed';
  var dismissed = false;
  try { dismissed = !!localStorage.getItem(KEY); } catch (e) {}

  // Inline "Instant quote & pay" button next to each primary "Get a Free Quote"
  // button. Existing pages already carry it in their HTML; this only fills the
  // gaps (for example a newly published post) and never doubles one up.
  function addInlineButtons() {
    var links = document.querySelectorAll('a.btn-primary[href^="/contact"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (/nav-cta|mob-nav-link|footer-cta/.test(a.className)) continue;
      if (!/quote/i.test(a.textContent)) continue;
      var n = a.nextElementSibling;
      if (n && /btn-klarna/.test(n.className)) continue;
      var b = document.createElement('a');
      b.href = '/instant-quote?src=cta';
      b.className = 'btn btn-klarna';
      if (a.getAttribute('style')) b.setAttribute('style', a.getAttribute('style'));
      b.innerHTML = 'Instant quote &amp; pay <span class="btn-klarna-k">Klarna</span>';
      a.parentNode.insertBefore(b, a.nextSibling);
    }
  }

  function init() {
    addInlineButtons();
    if (dismissed) return;
    var css =
      '.mkr-klarna{position:fixed;left:20px;bottom:20px;z-index:9990;width:292px;box-sizing:border-box;' +
        'background:#ffb3c7;color:#17120f;border-radius:16px;padding:16px 18px 16px;' +
        'box-shadow:0 10px 30px rgba(23,18,15,.22);font-family:"DM Sans",-apple-system,Arial,sans-serif;line-height:1.35}' +
      '.mkr-klarna *{box-sizing:border-box}' +
      '.mkr-klarna-pill{display:inline-block;background:#17120f;color:#ffb3c7;font-weight:800;font-size:12px;' +
        'letter-spacing:.3px;padding:3px 9px;border-radius:6px}' +
      '.mkr-klarna-t{font-weight:800;font-size:17px;margin:9px 0 2px}' +
      '.mkr-klarna-s{font-size:13.5px;margin:0 0 12px}' +
      '.mkr-klarna-b{display:block;text-align:center;background:#17120f;color:#fff !important;text-decoration:none;' +
        'font-weight:700;font-size:14.5px;padding:11px 14px;border-radius:10px}' +
      '.mkr-klarna-b:hover{background:#000}' +
      '.mkr-klarna-x{position:absolute;top:8px;right:10px;width:26px;height:26px;border:0;background:transparent;' +
        'color:#17120f;font-size:20px;line-height:1;cursor:pointer;border-radius:50%}' +
      '.mkr-klarna-x:hover{background:rgba(23,18,15,.12)}' +
      '@media screen and (max-width:719px){.mkr-klarna{left:10px;right:10px;width:auto;bottom:62px;padding:10px 14px 11px}' +
        '.mkr-klarna-t{display:inline-block;margin:0 0 0 8px;font-size:15px;vertical-align:middle}' +
        '.mkr-klarna-s{display:none}.mkr-klarna-b{margin-top:8px;padding:9px 12px;font-size:14px}}' +
      '@media print{.mkr-klarna{display:none}}';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var card = document.createElement('aside');
    card.className = 'mkr-klarna';
    card.setAttribute('aria-label', 'Instant quote and pay with Klarna');
    card.innerHTML =
      '<button type="button" class="mkr-klarna-x" aria-label="Close">&times;</button>' +
      '<span class="mkr-klarna-pill">Klarna</span>' +
      '<div class="mkr-klarna-t">Instant quote &amp; pay</div>' +
      '<p class="mkr-klarna-s">Get a fixed price in 60 seconds, then book online. You can pay with Klarna.</p>' +
      '<a class="mkr-klarna-b" href="/instant-quote?src=klarna-card">Get my instant price</a>';
    card.style.display = 'none';
    document.body.appendChild(card);
    // Keep it clear of the page's own buttons: show once the visitor has scrolled
    // past the first screen, or after 15 seconds on the page.
    var shown = false;
    function reveal() { if (shown) return; shown = true; card.style.display = ''; window.removeEventListener('scroll', onScroll); }
    function onScroll() { if (window.scrollY > 500) reveal(); }
    window.addEventListener('scroll', onScroll, { passive: true });
    setTimeout(reveal, 15000);

    card.querySelector('.mkr-klarna-x').addEventListener('click', function () {
      card.remove();
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
    });
    card.querySelector('.mkr-klarna-b').addEventListener('click', function () {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: 'klarna_cta_click', page_path: path });
    });
  }

  // Cosmetic UI: stay out of the critical rendering path.
  if (document.readyState === 'complete') {
    (window.requestIdleCallback || setTimeout)(init);
  } else {
    window.addEventListener('load', function () { (window.requestIdleCallback || setTimeout)(init); });
  }
})();

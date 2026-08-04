/* ── Sticky mobile contact bar ─────────────────────────────
   One-tap Call and WhatsApp buttons pinned to the bottom of the
   screen on phones. Loaded on every public page via this script;
   desktop and print never see it. */
(function () {
  var css =
    '.mkr-sticky-bar{display:none;}' +
    '@media screen and (max-width:719px){' +
      'body{padding-bottom:52px;}' +
      /* the bar replaces the floating WhatsApp pill on phones */
      '#wa-float{display:none !important;}' +
      '.mkr-sticky-bar{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:9999;' +
        'box-shadow:0 -4px 18px rgba(13,31,60,.25);}' +
      '.mkr-sticky-bar a{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;' +
        'padding:15px 10px;font-weight:700;font-size:15px;text-decoration:none;font-family:inherit;}' +
      '.mkr-sticky-call{background:#0D1F3C;color:#fff;}' +
      '.mkr-sticky-wa{background:#1EBE57;color:#fff;}' +
    '}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var bar = document.createElement('div');
  bar.className = 'mkr-sticky-bar';
  bar.innerHTML =
    '<a class="mkr-sticky-call" href="tel:01634971005">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24 11.36 11.36 0 003.56.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.36 11.36 0 00.57 3.56 1 1 0 01-.25 1.01z"/></svg>' +
      'Call us now</a>' +
    '<a class="mkr-sticky-wa" href="https://wa.me/447359917380?text=Hi%2C%20I%20would%20like%20a%20removals%20quote" target="_blank" rel="noopener">' +
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
      'WhatsApp us</a>';
  document.body.appendChild(bar);
})();

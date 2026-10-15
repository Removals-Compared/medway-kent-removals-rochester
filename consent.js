/* ── Cookie choices ────────────────────────────────────────
   Works with Google Consent Mode v2. Each page sets every Google consent signal
   to "denied" (or to the visitor's saved choice) BEFORE Google Tag Manager loads;
   this script then shows the banner, saves the choice, and tells Google.

   Accept: analytics and advertising are switched on and the OpenAI ads pixel loads.
   Reject: nothing is stored for analytics or advertising and the OpenAI pixel never
           loads. Google's tags still run in their cookie-free mode, which sends no
           identifiers.

   The saved choice (localStorage "mkr_consent_v1") is strictly necessary and needs
   no consent. A "Cookie settings" link in the footer lets people change their mind. */
(function () {
  'use strict';
  var KEY = 'mkr_consent_v1', VERSION = 1;
  var memory = null; // used only if the browser blocks localStorage

  function read() {
    try {
      var c = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (c && c.v === VERSION) return c;
    } catch (e) {}
    return memory;
  }
  function write(granted) {
    var c = { v: VERSION, analytics: !!granted, ads: !!granted, ts: new Date().toISOString() };
    memory = c;
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {}
    return c;
  }

  function gtagSafe() {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== 'function') window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag.apply(null, arguments);
  }
  function tell(granted) {
    var v = granted ? 'granted' : 'denied';
    gtagSafe('consent', 'update', { ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v });
    window.dataLayer.push({ event: 'mkr_consent_update', mkr_consent: granted ? 'accepted' : 'rejected' });
  }

  // Remove the cookies analytics and advertising tools set, on this domain and its parent.
  function clearTrackingCookies() {
    var host = location.hostname, parts = host.split('.'), domains = ['', host, '.' + host];
    if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    var names = document.cookie.split(';').map(function (c) { return c.split('=')[0].replace(/^\s+/, ''); });
    names.forEach(function (n) {
      if (!/^(_ga|_gid|_gat|_gcl_|_gac_|FPID|FPLC)/.test(n)) return;
      domains.forEach(function (d) {
        document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
  }

  function loadAdPixel() { if (typeof window.__mkrLoadOaiq === 'function') window.__mkrLoadOaiq(); }

  var bannerEl = null;
  // The floating WhatsApp button sits bottom-right; lift it above the banner while the banner is open.
  function liftFloats() {
    var root = document.documentElement;
    if (!root || !root.style || !root.style.setProperty) return;
    if (bannerEl) root.style.setProperty('--mkr-consent-h', bannerEl.offsetHeight + 'px');
    else root.style.removeProperty('--mkr-consent-h');
  }
  function closeBanner() {
    if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
    bannerEl = null;
    liftFloats();
  }

  function choose(granted) {
    var before = read();
    write(granted);
    tell(granted);
    closeBanner();
    if (granted) { loadAdPixel(); return; }
    clearTrackingCookies();
    // Scripts that are already running cannot be unloaded, so reload when someone withdraws a "yes".
    if (before && before.ads) location.reload();
  }

  function css() {
    if (document.getElementById('mkr-consent-css')) return;
    var s = document.createElement('style');
    s.id = 'mkr-consent-css';
    s.textContent =
      '#mkr-consent{position:fixed;left:0;right:0;bottom:0;z-index:9998;background:#16294a;color:#fff;' +
        'box-shadow:0 -6px 24px rgba(13,31,60,.28);font-family:inherit;font-size:14px;line-height:1.5}' +
      '#mkr-consent .mkr-c-in{max-width:1100px;margin:0 auto;padding:14px 20px;display:flex;gap:16px 24px;align-items:center;flex-wrap:wrap}' +
      '#mkr-consent p{margin:0;flex:1 1 380px;color:#fff}' +
      '#mkr-consent a{color:#fff;text-decoration:underline}' +
      '#mkr-consent .mkr-c-btns{display:flex;gap:10px;flex:0 0 auto}' +
      '#mkr-consent button{font:inherit;font-weight:700;cursor:pointer;border-radius:8px;padding:10px 18px;min-width:150px;' +
        'background:#fff;color:#16294a;border:2px solid #fff}' +
      '#mkr-consent button:hover{background:#eef1f7}' +
      '#mkr-consent button:focus-visible,#mkr-cookie-settings:focus-visible{outline:3px solid #f5b400;outline-offset:2px}' +
      '#wa-float{bottom:calc(var(--mkr-consent-h,0px) + 20px) !important}' +
      /* phones have a sticky Call/WhatsApp bar (52px) pinned to the bottom: sit just above it, never over it */
      '@media screen and (max-width:719px){#mkr-consent{bottom:52px}#mkr-consent .mkr-c-in{padding:12px 14px}' +
        '#mkr-consent .mkr-c-btns{width:100%}#mkr-consent button{flex:1;min-width:0;padding:10px 8px}}';
    document.head.appendChild(s);
  }

  function showBanner() {
    if (bannerEl || !document.body) return;
    css();
    var d = document.createElement('div');
    d.id = 'mkr-consent';
    d.setAttribute('role', 'region');
    d.setAttribute('aria-label', 'Cookie choices');
    d.innerHTML =
      '<div class="mkr-c-in"><p><strong>Your cookie choices.</strong> We would like to use cookies to see how the site is used and ' +
      'to measure our adverts. None are set until you choose. <a href="/privacy-policy#cookies">How we use cookies</a></p>' +
      '<div class="mkr-c-btns"><button type="button" id="mkr-c-reject">Reject non-essential</button>' +
      '<button type="button" id="mkr-c-accept">Accept all</button></div></div>';
    document.body.appendChild(d);
    bannerEl = d;
    liftFloats();
    if (window.addEventListener) window.addEventListener('resize', liftFloats);
    document.getElementById('mkr-c-accept').addEventListener('click', function () { choose(true); });
    document.getElementById('mkr-c-reject').addEventListener('click', function () { choose(false); });
  }

  function addSettingsLink() {
    if (document.getElementById('mkr-cookie-settings')) return;
    var footer = document.querySelector('footer');
    if (!footer) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'text-align:center;padding:10px 16px 16px;font-size:13px';
    var a = document.createElement('a');
    a.id = 'mkr-cookie-settings';
    a.href = '#cookie-settings';
    a.textContent = 'Cookie settings';
    a.style.cssText = 'color:inherit;opacity:.75;text-decoration:underline';
    a.addEventListener('click', function (e) { e.preventDefault(); showBanner(); });
    wrap.appendChild(a);
    footer.appendChild(wrap);
  }

  function start() {
    var c = read();
    if (c) { if (c.ads) loadAdPixel(); } else showBanner();
    // Cookies left over from before the banner existed, or from a "no": remove them unless analytics was accepted.
    if (!c || !c.analytics) clearTrackingCookies();
    addSettingsLink();
  }

  window.mkrConsent = { read: read, choose: choose, show: showBanner };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

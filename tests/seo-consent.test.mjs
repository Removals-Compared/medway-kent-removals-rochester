import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyConsent, consentProblems, INIT_MARK } from '../seo/lib/seo-consent-lib.mjs';
import { renderPost } from '../seo/lib/seo-post-render.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const GTM = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-TEST');</script>
<!-- End Google Tag Manager -->`;
const PIXEL = `<script>
  (function (w, d, s, u) {
    if (w.oaiq) return;
    var q = function () {
      q.q.push(arguments);
    };
    q.q = [];
    w.oaiq = q;
    var js = d.createElement(s);
    js.async = true;
    js.src = u;
    var f = d.getElementsByTagName(s)[0];
    f.parentNode.insertBefore(js, f);
  })(window, document, "script", "https://bzrcdn.openai.com/sdk/oaiq.min.js");
  oaiq("init", { pixelId: "x" });
</script>`;
const page = (head, body = '') => `<!DOCTYPE html><html><head>${head}<title>t</title></head><body>${body}<footer>f</footer></body></html>`;

test('consent defaults are placed before Tag Manager, the ads pixel is gated, the banner script is added', () => {
  const out = applyConsent(page(GTM + PIXEL));
  assert.ok(out.indexOf(INIT_MARK) < out.indexOf('<!-- Google Tag Manager -->'), 'defaults come first, ahead of the Tag Manager comment');
  assert.ok(out.includes("gtag('consent','default',{ad_storage:v,ad_user_data:v,ad_personalization:v,analytics_storage:v"));
  assert.ok(out.includes('w.__mkrLoadOaiq = function'), 'the pixel only loads when asked');
  assert.ok(!/\n    js\.src = u;\n    var f = d\.getElementsByTagName\(s\)\[0\];\n    f\.parentNode\.insertBefore\(js, f\);\n  \}\)\(/.test(out), 'the pixel no longer loads by itself');
  assert.ok(out.includes('oaiq("init"'), 'its queue and calls are kept, so measurements wait for consent');
  assert.ok(out.includes('<script src="/consent.js?v=1" defer></script>\n</body>'));
  assert.deepEqual(consentProblems(out), []);
});

test('running it again changes nothing, and pages without tracking are left alone', () => {
  const once = applyConsent(page(GTM + PIXEL));
  assert.equal(applyConsent(once), once);
  const plain = page('<meta charset="utf-8">', '<p>hello</p>');
  assert.equal(applyConsent(plain), plain);
  assert.deepEqual(consentProblems(plain), []);
});

test('gtag.js-only pages and ads-pixel-only pages are handled, and the guard spots unprotected pages', () => {
  const g = applyConsent(page('<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script><script>gtag("config","G-TEST")</script>'));
  assert.ok(g.indexOf(INIT_MARK) < g.indexOf('gtag/js?id=G-TEST'));
  const o = applyConsent(page(PIXEL));
  assert.ok(!o.includes(INIT_MARK) && o.includes('__mkrLoadOaiq') && o.includes('/consent.js'));
  assert.ok(consentProblems(page(GTM)).length >= 1);
  assert.ok(consentProblems(page(PIXEL)).some((p) => /OpenAI/.test(p)));
});

test('pages the SEO publisher renders already carry the consent code', () => {
  const html = renderPost({ title: 'A test title for the page', meta_description: 'x'.repeat(130), slug: 'consent-check', content: '<h2>One</h2><p>' + 'word '.repeat(60) + '</p>', faqs: [] }, { date: '2026-10-20' });
  assert.deepEqual(consentProblems(html), []);
  assert.ok(html.indexOf(INIT_MARK) < html.indexOf("gtm.start"));
});

test('EVERY public page in the repository loads tracking only behind the consent code', () => {
  const files = execFileSync('git', ['ls-files', '*.html'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => !/^(admin|print|node_modules)\//.test(f));
  const bad = [];
  for (const f of files) { const p = consentProblems(fs.readFileSync(path.join(ROOT, f), 'utf8')); if (p.length) bad.push(`${f}: ${p.join('; ')}`); }
  assert.deepEqual(bad, [], 'run "npm run apply-consent"');
  assert.ok(files.length > 100);
});

// ── the banner script, run against a tiny fake browser ──
function browser({ saved = null, cookies = [] } = {}) {
  const jar = new Map(cookies.map((n) => [n, 'v']));
  const store = new Map(saved ? [['mkr_consent_v1', JSON.stringify(saved)]] : []);
  const log = { appended: [], removed: [], gtag: [], pixel: 0, reload: 0, listeners: {}, vars: {} };
  const els = {};
  const mk = (tag) => ({ tag, style: {}, children: [], parentNode: null, id: '', innerHTML: '', textContent: '', setAttribute() {}, addEventListener(t, fn) { (log.listeners[this.id || this.innerHTML.slice(0, 20)] ||= []).push(fn); }, appendChild(c) { c.parentNode = this; this.children.push(c); log.appended.push(c); return c; }, removeChild(c) { log.removed.push(c); c.parentNode = null; } });
  const body = mk('body'), head = mk('head'), footer = mk('footer');
  const byId = {};
  const document = {
    readyState: 'complete', body, head,
    get cookie() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(s) { const [kv, ...attrs] = String(s).split(';'); const [k, v] = kv.split('='); if (attrs.some((a) => /expires=Thu, 01 Jan 1970/.test(a))) jar.delete(k.trim()); else jar.set(k.trim(), v); },
    documentElement: { style: { setProperty(k, v) { log.vars[k] = v; }, removeProperty(k) { delete log.vars[k]; } } },
    createElement: mk,
    getElementById(id) {
      if (byId[id]) return byId[id];
      const all = [...head.children, ...body.children, ...footer.children.flatMap((c) => [c, ...c.children])];
      if (all.some((e) => e.id === id)) return byId[id] = all.find((e) => e.id === id);
      if (all.some((e) => e.innerHTML.includes(`id="${id}"`))) { const b = mk('button'); b.id = id; return byId[id] = b; }
      return null;
    },
    querySelector: (sel) => (sel === 'footer' ? footer : null),
    addEventListener() {},
  };
  const window = { addEventListener() {}, dataLayer: [], location: { hostname: 'www.example.co.uk', reload() { log.reload++; } }, __mkrLoadOaiq() { log.pixel++; } };
  window.gtag = function () { window.dataLayer.push(arguments); log.gtag.push([...arguments]); };
  const ctx = vm.createContext({ window, document, localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, location: window.location, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'consent.js'), 'utf8'), ctx);
  return { window, log, store, byId, footer, jar, click: (id) => { document.getElementById(id); (log.listeners[id] || []).forEach((f) => f()); } };
}
const banner = (b) => b.log.appended.find((e) => e.id === 'mkr-consent');

test('first visit: the banner shows, nothing is granted, the ads pixel does not load', () => {
  const b = browser();
  assert.ok(banner(b), 'banner is shown');
  assert.match(banner(b).innerHTML, /Reject non-essential/);
  assert.match(banner(b).innerHTML, /Accept all/);
  assert.equal(b.log.pixel, 0);
  assert.equal(b.log.gtag.length, 0);
  assert.ok(b.footer.children.length === 1, 'a "Cookie settings" link is added to the footer');
});

test('accept: choice saved, Google told "granted", ads pixel loaded once, banner closed', () => {
  const b = browser(); b.click('mkr-c-accept');
  const saved = JSON.parse(b.store.get('mkr_consent_v1'));
  assert.equal(saved.v, 1); assert.equal(saved.analytics, true); assert.equal(saved.ads, true);
  assert.deepEqual(b.log.gtag[0].slice(0, 2), ['consent', 'update']);
  assert.deepEqual(JSON.parse(JSON.stringify(b.log.gtag[0][2])), { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
  assert.equal(b.log.pixel, 1);
  assert.equal(b.log.removed.length, 1);
  assert.equal(b.window.dataLayer.at(-1).mkr_consent, 'accepted');
  assert.equal(b.log.vars['--mkr-consent-h'], undefined, 'the WhatsApp button drops back once the banner is gone');
});

test('reject: choice saved, Google told "denied", ads pixel never loads, no reload needed', () => {
  const b = browser(); b.click('mkr-c-reject');
  const saved = JSON.parse(b.store.get('mkr_consent_v1'));
  assert.equal(saved.analytics, false); assert.equal(saved.ads, false);
  assert.deepEqual(JSON.parse(JSON.stringify(b.log.gtag[0][2])), { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
  assert.equal(b.log.pixel, 0); assert.equal(b.log.reload, 0);
});

test('a returning visitor who accepted: no banner, ads pixel loads straight away', () => {
  const b = browser({ saved: { v: 1, analytics: true, ads: true } });
  assert.equal(banner(b), undefined); assert.equal(b.log.pixel, 1);
});

test('leftover tracking cookies are cleared when there is no saved "yes", but other cookies are kept', () => {
  const fresh = browser({ cookies: ['_ga', '_ga_ABC123', '_gcl_au', 'other_site_cookie'] });
  assert.deepEqual([...fresh.jar.keys()], ['other_site_cookie']);
  const rejected = browser({ saved: { v: 1, analytics: false, ads: false }, cookies: ['_ga', '_gcl_au'] });
  assert.deepEqual([...rejected.jar.keys()], []);
  const accepted = browser({ saved: { v: 1, analytics: true, ads: true }, cookies: ['_ga', '_gcl_au'] });
  assert.deepEqual([...accepted.jar.keys()].sort(), ['_ga', '_gcl_au'], 'a visitor who said yes keeps theirs');
});

test('a returning visitor who rejected: no banner, nothing loads', () => {
  const b = browser({ saved: { v: 1, analytics: false, ads: false } });
  assert.equal(banner(b), undefined); assert.equal(b.log.pixel, 0);
});

test('changing a "yes" to a "no" reloads the page so already-running scripts stop', () => {
  const b = browser({ saved: { v: 1, analytics: true, ads: true } });
  b.window.mkrConsent.show(); b.click('mkr-c-reject');
  assert.equal(b.log.reload, 1);
  assert.equal(JSON.parse(b.store.get('mkr_consent_v1')).ads, false);
});

test('an old or unreadable saved choice is treated as no choice', () => {
  const b = browser({ saved: { v: 0, analytics: true, ads: true } });
  assert.ok(banner(b)); assert.equal(b.log.pixel, 0);
});

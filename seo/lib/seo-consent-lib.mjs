// ════════════════════════════════════════════════════════════
//  Cookie consent for every public page (Google Consent Mode v2).
//  Pure and idempotent: running it again on a page it has already handled changes nothing.
//
//   1. A tiny inline script, placed BEFORE Google Tag Manager / gtag.js, sets every Google
//      consent signal to "denied" (or to the visitor's saved choice).
//   2. The OpenAI ads pixel keeps its queue but no longer loads by itself; /consent.js loads it
//      only after the visitor accepts.
//   3. /consent.js (banner, saved choice, "Cookie settings" link) is added before </body>.
// ════════════════════════════════════════════════════════════
export const INIT_MARK = '<!-- consent-mode -->';
export const CONSENT_SRC = '/consent.js?v=1';
const SCRIPT_TAG = /<script[^>]+src=["']\/consent\.js/i; // the tag itself, not a comment that mentions the file

export const CONSENT_INIT = `${INIT_MARK}
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}(function(){var a=0;try{var c=JSON.parse(localStorage.getItem('mkr_consent_v1')||'null');if(c&&c.v===1&&c.ads&&c.analytics)a=1}catch(e){}var v=a?'granted':'denied';gtag('consent','default',{ad_storage:v,ad_user_data:v,ad_personalization:v,analytics_storage:v,functionality_storage:'granted',security_storage:'granted',wait_for_update:500});gtag('set','url_passthrough',true);gtag('set','ads_data_redaction',true)})();</script>
`;

const hasGoogleTags = (html) => /gtm\.start/.test(html) || /googletagmanager\.com\/gtag\/js\?id=/.test(html);
const hasAdPixel = (html) => /w\.oaiq\s*=\s*q/.test(html);

// The exact lines in the OpenAI snippet that load its script.
const PIXEL_LOAD = /var js = d\.createElement\(s\);\s*js\.async = true;\s*js\.src = u;\s*var f = d\.getElementsByTagName\(s\)\[0\];\s*f\.parentNode\.insertBefore\(js, f\);/;
const PIXEL_GATED =
`// Loads only after the visitor accepts cookies (see /consent.js).
    w.__mkrLoadOaiq = function () {
      if (w.__mkrOaiqLoaded) return;
      w.__mkrOaiqLoaded = true;
      var js = d.createElement(s);
      js.async = true;
      js.src = u;
      var f = d.getElementsByTagName(s)[0];
      f.parentNode.insertBefore(js, f);
    };`;

// Position to insert the consent defaults: before the Tag Manager snippet (and its comment), else before gtag.js.
function initPosition(html) {
  const gtm = html.search(/gtm\.start/);
  if (gtm !== -1) {
    let at = html.lastIndexOf('<script', gtm);
    const before = html.slice(0, at);
    const m = before.match(/<!--\s*Google Tag Manager\s*-->\s*$/i);
    if (m) at = before.length - m[0].length;
    return at;
  }
  const g = html.search(/<script[^>]*googletagmanager\.com\/gtag\/js\?id=/);
  return g;
}

export function applyConsent(html) {
  html = String(html);
  const google = hasGoogleTags(html), pixel = hasAdPixel(html);
  if (!google && !pixel) return html;
  let out = html;

  if (google && !out.includes(INIT_MARK)) {
    const at = initPosition(out);
    if (at < 0) throw new Error('Could not find where Google Tag Manager is loaded');
    out = out.slice(0, at) + CONSENT_INIT + out.slice(at);
  }
  if (pixel && !/__mkrLoadOaiq/.test(out)) {
    if (!PIXEL_LOAD.test(out)) throw new Error('The OpenAI pixel snippet has an unexpected shape');
    out = out.replace(PIXEL_LOAD, () => PIXEL_GATED);
  }
  if (!SCRIPT_TAG.test(out)) {
    const tag = `<script src="${CONSENT_SRC}" defer></script>`;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, () => `${tag}\n</body>`) : out.replace(/\s*$/, '\n' + tag + '\n'); // partial files have no </body>
  }
  return out;
}

// Does this page still have an unprotected tracker? (used by checks)
export function consentProblems(html) {
  html = String(html);
  const p = [];
  if (hasGoogleTags(html)) {
    if (!html.includes(INIT_MARK)) p.push('Google tags without consent defaults');
    else {
      const a = html.indexOf(INIT_MARK);
      const t = Math.min(...['gtm.start', 'googletagmanager.com/gtag/js?id='].map((s) => { const i = html.indexOf(s); return i < 0 ? Infinity : i; }));
      if (a > t) p.push('consent defaults come after the Google tags');
    }
  }
  if (hasAdPixel(html) && !/__mkrLoadOaiq/.test(html)) p.push('OpenAI pixel loads without consent');
  if ((hasGoogleTags(html) || hasAdPixel(html)) && !SCRIPT_TAG.test(html)) p.push('no consent banner script');
  return p;
}

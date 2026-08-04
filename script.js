// ════════════════════════════════════════════════════════════
//  Medway & Kent Removals, script.js
//  All API calls now go through /api/quote (Vercel function)
//  No credentials stored in this file, all secrets are in
//  Vercel environment variables server-side
// ════════════════════════════════════════════════════════════

// ── MOBILE MENU ──
function toggleMobile(){
  var m=document.getElementById('mobile-overlay');
  var isOpen=m.classList.toggle('open');
  document.body.style.overflow=isOpen?'hidden':'';
}
function toggleSubNav(e){
  e.preventDefault();
  var sub=document.getElementById('mob-services');
  sub.classList.toggle('open');
}
window.addEventListener('resize',function(){
  if(window.innerWidth>768){
    var m=document.getElementById('mobile-overlay');
    if(m){m.classList.remove('open');document.body.style.overflow='';}
  }
});

// ── FAQ ACCORDION ──
function toggleFaq(btn){
  var item=btn.closest('.faq-item');
  var isOpen=item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(function(i){
    i.classList.remove('open');
  });
  if(!isOpen) item.classList.add('open');
}

// ── QUICK HERO QUOTE FORM (legacy — kept for safety) ──
function quickQuote(e){
  e.preventDefault();
}

// ── HERO QUOTE FORM HANDLER ──
// Handles the short 4-field form on the homepage hero section
// Validates all fields, submits to /api/quote, redirects to /thank-you
document.addEventListener('DOMContentLoaded', function(){
  var heroForm = document.getElementById('hero-quote-form');
  if(!heroForm) return;

  heroForm.addEventListener('submit', async function(e){
    e.preventDefault();

    var btn = heroForm.querySelector('button[type="submit"]');
    var originalText = btn.textContent;

    // ── Collect values ──
    var fullname = (document.getElementById('hero-fullname') || {}).value || '';
    var phone    = (heroForm.querySelector('[name="phone"]') || {}).value || '';
    var email    = (heroForm.querySelector('[name="email"]') || {}).value || '';
    var service  = (heroForm.querySelector('[name="service"]') || {}).value || '';

    fullname = fullname.trim();
    phone    = phone.trim();
    email    = email.trim();

    // ── Validation ──
    if(!fullname){
      showHeroError('Please enter your full name.');
      return;
    }
    if(!phone || phone.replace(/\s/g,'').length < 10){
      showHeroError('Please enter a valid phone number.');
      return;
    }
    if(!email || !email.includes('@') || !email.includes('.')){
      showHeroError('Please enter a valid email address.');
      return;
    }
    if(!service){
      showHeroError('Please select the type of move.');
      return;
    }

    clearHeroError();

    // ── Split full name into fname / lname ──
    var parts = fullname.split(' ');
    var fname = parts[0];
    var lname = parts.slice(1).join(' ') || '';

    btn.textContent = 'Sending...';
    btn.disabled = true;

    try {
      var response = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fname:         fname,
          lname:         lname,
          phone:         phone,
          email:         email,
          service:       service,
          from_postcode: '',
          to_postcode:   '',
          property_size: '',
          move_date:     '',
          access:        '',
          notes:         'Submitted from homepage hero (short form)',
        }),
      });

      var data = await response.json();

      if(response.ok && data.success){
        window.location.href = '/thank-you';
      } else {
        throw new Error('Server error');
      }

    } catch(err){
      console.error('Hero form error:', err);
      btn.textContent = originalText;
      btn.disabled = false;
      showHeroError('Something went wrong. Please call us on 01634 971005.');
    }
  });

  function showHeroError(msg){
    var el = document.getElementById('hero-form-error');
    if(!el){
      el = document.createElement('p');
      el.id = 'hero-form-error';
      el.style.cssText = 'color:#e04e1b;font-size:13px;margin:8px 0 0;font-weight:600;';
      var form = document.getElementById('hero-quote-form');
      form.appendChild(el);
    }
    el.textContent = msg;
  }

  function clearHeroError(){
    var el = document.getElementById('hero-form-error');
    if(el) el.textContent = '';
  }
});

// ── PRE-FILL CONTACT FORM FROM URL PARAMS ──
// Supports: name, phone, service, email, from, to, property
(function(){
  var params = new URLSearchParams(window.location.search);
  var supported = ['name','phone','service','email','from','to','property'];
  var hasAny = supported.some(function(k){ return params.get(k) !== null; });
  if(!hasAny) return;

  function setVal(id, val){
    var el = document.getElementById(id);
    if(el && val) el.value = val;
  }

  if(params.get('name')){
    var nameParts = params.get('name').split(' ');
    setVal('cf-fname', nameParts[0] || '');
    setVal('cf-lname', nameParts.slice(1).join(' ') || '');
  }
  setVal('cf-phone', params.get('phone'));
  setVal('cf-email', params.get('email'));
  setVal('cf-from',  params.get('from'));
  setVal('cf-to',    params.get('to'));

  var sv = document.getElementById('cf-service');
  if(sv && params.get('service')){
    for(var i=0; i<sv.options.length; i++){
      if(sv.options[i].text === params.get('service')){
        sv.selectedIndex = i;
        break;
      }
    }
  }

  var pr = document.getElementById('cf-property');
  if(pr && params.get('property')){
    for(var j=0; j<pr.options.length; j++){
      if(pr.options[j].text === params.get('property')){
        pr.selectedIndex = j;
        break;
      }
    }
  }
})();

// ── CONTACT FORM SUBMISSION ──
// Posts all form data to /api/quote (Vercel serverless function)
async function submitForm(e){
  e.preventDefault();

  var btn = e.target.querySelector('.form-submit');
  var originalText = btn.textContent;
  btn.textContent = 'Sending...';
  btn.disabled = true;

  var fname     = document.getElementById('cf-fname').value.trim();
  var lname     = document.getElementById('cf-lname').value.trim();
  var phone     = document.getElementById('cf-phone').value.trim();
  var email     = document.getElementById('cf-email').value.trim();
  var service   = document.getElementById('cf-service').value;
  var fromPost  = document.getElementById('cf-from').value.trim();
  var toPost    = document.getElementById('cf-to').value.trim();
  var propSize  = document.getElementById('cf-property').value;
  var moveDate  = document.getElementById('cf-date').value;
  var access    = document.getElementById('cf-access') ? document.getElementById('cf-access').value : '';
  var notes     = document.getElementById('cf-notes').value.trim();

  if(!fname || !phone || !email || !service || !fromPost || !toPost){
    alert('Please fill in all required fields before submitting.');
    btn.textContent = originalText;
    btn.disabled = false;
    return;
  }

  try {
    var response = await fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fname:         fname,
        lname:         lname,
        phone:         phone,
        email:         email,
        service:       service,
        from_postcode: fromPost,
        to_postcode:   toPost,
        property_size: propSize,
        move_date:     moveDate,
        access:        access,
        notes:         notes,
      }),
    });

    var data = await response.json();

    if(response.ok && data.success){
      window.location.href = '/thank-you';
    } else {
      throw new Error('Server returned an error');
    }

  } catch(err) {
    console.error('Form submission error:', err);
    btn.textContent = originalText;
    btn.disabled = false;
    alert('Something went wrong. Please call us directly on 01634 971005 and we will get your quote sorted right away.');
  }
}

// ── ABOUT PAGE RESPONSIVE GRID ──
(function(){
  function fixAbout(){
    var el = document.querySelector('.about-split');
    if(!el) return;
    el.style.gridTemplateColumns = window.innerWidth < 768 ? '1fr' : '1fr 1fr';
  }
  fixAbout();
  window.addEventListener('resize', fixAbout);
})();

/* ─── Areas We Cover dropdown: click toggle ─── */
document.addEventListener('DOMContentLoaded', function () {
  var dd = document.getElementById('areas-dropdown');
  if (!dd) return;
  var btn = dd.querySelector('.nav-dropdown-btn');
  if (!btn) return;

  function close() {
    dd.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
  }
  function open() {
    dd.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (dd.classList.contains('is-open')) {
      close();
    } else {
      open();
    }
  });

  document.addEventListener('click', function (e) {
    if (!dd.contains(e.target)) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dd.classList.contains('is-open')) {
      close();
      btn.focus();
    }
  });

  dd.querySelectorAll('.nav-dropdown-menu a').forEach(function (a) {
    a.addEventListener('click', close);
  });
});

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

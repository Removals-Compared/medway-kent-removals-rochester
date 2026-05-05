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

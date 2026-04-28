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

// ── QUICK HERO QUOTE FORM (home page only) ──
function quickQuote(e){
  e.preventDefault();
  var name    = document.getElementById('qq-name').value;
  var phone   = document.getElementById('qq-phone').value;
  var service = document.getElementById('qq-move').value;
  var params  = new URLSearchParams({name:name, phone:phone, service:service});
  window.location.href = '/contact?' + params.toString();
}

// ── PRE-FILL CONTACT FORM FROM URL PARAMS ──
// Supports: name, phone, service, email, from, to, property
// Runs whenever any supported parameter is present.
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
// The function handles Resend email + HubSpot CRM + Supabase
async function submitForm(e){
  e.preventDefault();

  var btn = e.target.querySelector('.form-submit');
  var originalText = btn.textContent;
  btn.textContent = 'Sending...';
  btn.disabled = true;

  // ── Collect all form values ──
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

  // ── Basic validation ──
  if(!fname || !phone || !email || !service || !fromPost || !toPost){
    alert('Please fill in all required fields before submitting.');
    btn.textContent = originalText;
    btn.disabled = false;
    return;
  }

  // ── Send to /api/quote ──
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
      // ── Show success state ──
      document.getElementById('contact-form').style.display = 'none';
      document.getElementById('form-success').classList.add('show');
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

  /* close when clicking outside */
  document.addEventListener('click', function (e) {
    if (!dd.contains(e.target)) close();
  });

  /* close on Escape */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dd.classList.contains('is-open')) {
      close();
      btn.focus();
    }
  });

  /* close after clicking a link inside the menu */
  dd.querySelectorAll('.nav-dropdown-menu a').forEach(function (a) {
    a.addEventListener('click', close);
  });
});

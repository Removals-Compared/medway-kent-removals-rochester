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
  document.querySelectorAll('.faq-item.open').forEach(function(i){i.classList.remove('open');});
  if(!isOpen)item.classList.add('open');
}

// ── QUICK HERO QUOTE FORM (home page only) ──
function quickQuote(e){
  e.preventDefault();
  var name=document.getElementById('qq-name').value;
  var phone=document.getElementById('qq-phone').value;
  var service=document.getElementById('qq-move').value;
  var params=new URLSearchParams({name:name,phone:phone,service:service});
  window.location.href='/contact?'+params.toString();
}

// ── PRE-FILL CONTACT FORM FROM URL PARAMS ──
(function(){
  var params=new URLSearchParams(window.location.search);
  if(!params.get('name'))return;
  var nameParts=(params.get('name')||'').split(' ');
  var fn=document.getElementById('cf-fname');
  var ln=document.getElementById('cf-lname');
  var ph=document.getElementById('cf-phone');
  var sv=document.getElementById('cf-service');
  if(fn)fn.value=nameParts[0]||'';
  if(ln)ln.value=nameParts.slice(1).join(' ')||'';
  if(ph)ph.value=params.get('phone')||'';
  if(sv&&params.get('service')){
    for(var i=0;i<sv.options.length;i++){
      if(sv.options[i].text===params.get('service')){sv.selectedIndex=i;break;}
    }
  }
})();

// ── CONTACT FORM SUBMISSION ──
async function submitForm(e){
  e.preventDefault();
  var btn=e.target.querySelector('.form-submit');
  btn.textContent='Sending...';
  btn.disabled=true;

  var SUPABASE_URL='YOUR_SUPABASE_URL';
  var SUPABASE_KEY='YOUR_SUPABASE_ANON_KEY';
  var HS_TOKEN='YOUR_HUBSPOT_PRIVATE_APP_TOKEN';

  var fname=document.getElementById('cf-fname').value.trim();
  var lname=document.getElementById('cf-lname').value.trim();
  var phone=document.getElementById('cf-phone').value.trim();
  var email=document.getElementById('cf-email').value.trim();
  var service=document.getElementById('cf-service').value;
  var fromPost=document.getElementById('cf-from').value.trim();
  var toPost=document.getElementById('cf-to').value.trim();
  var propSize=document.getElementById('cf-property').value;
  var moveDate=document.getElementById('cf-date').value;
  var notes=document.getElementById('cf-notes').value.trim();
  var fullName=fname+' '+lname;

  var supabasePromise=fetch(SUPABASE_URL+'/rest/v1/quote_requests',{
    method:'POST',
    headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY,'Prefer':'return=minimal'},
    body:JSON.stringify({name:fullName,phone:phone,email:email,service:service,from_postcode:fromPost,to_postcode:toPost,property_size:propSize,move_date:moveDate,notes:notes})
  });

  var hsPromise=fetch('https://api.hubapi.com/crm/v3/objects/contacts',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+HS_TOKEN},
    body:JSON.stringify({properties:{firstname:fname,lastname:lname,phone:phone,email:email,hs_lead_status:'NEW',lifecyclestage:'lead',message:'Service: '+service+' | From: '+fromPost+' | To: '+toPost+' | Property: '+propSize+' | Date: '+moveDate+' | Notes: '+notes}})
  }).then(r=>r.json()).then(contact=>{
    if(contact&&contact.id){
      return fetch('https://api.hubapi.com/crm/v3/objects/deals',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+HS_TOKEN},
        body:JSON.stringify({properties:{dealname:'Quote: '+fullName+' ('+service+')',dealstage:'appointmentscheduled',pipeline:'default',closedate:moveDate?new Date(moveDate).getTime().toString():'',description:'From '+fromPost+' to '+toPost+' | '+propSize+' | '+notes},associations:[{to:{id:contact.id},types:[{associationCategory:'HUBSPOT_DEFINED',associationTypeId:3}]}]})
      });
    }
  });

  try{
    await Promise.allSettled([supabasePromise,hsPromise]);
    document.getElementById('contact-form').style.display='none';
    document.getElementById('form-success').classList.add('show');
  }catch(err){
    btn.textContent='Send Quote Request';
    btn.disabled=false;
    alert('Something went wrong. Please call us on 01634 570 000.');
  }
}

// ── ABOUT PAGE RESPONSIVE GRID ──
(function(){
  function fixAbout(){
    var el=document.querySelector('.about-split');
    if(!el)return;
    el.style.gridTemplateColumns=window.innerWidth<768?'1fr':'1fr 1fr';
  }
  fixAbout();
  window.addEventListener('resize',fixAbout);
})();

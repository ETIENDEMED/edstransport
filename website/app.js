import {firebaseConfig} from './config.js';

const paths = {
  car:'<path d="m5 16-1 2v2m15-4 1 2v2M3 13l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5v4H3zM6 13h2m8 0h2"/>',
  box:'<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4m-9 4v10M7 5l9 4"/>',
  plane:'<path d="M22 2 9 15m13-13-8 20-5-7-7-5z"/>',
  bag:'<path d="M4 8h16l1 13H3zM8 9V6a4 4 0 0 1 8 0v3"/>',
  heart:'<path d="M20.8 5.6a5.4 5.4 0 0 0-8.8 1A5.4 5.4 0 0 0 3.2 13L12 21l8.8-8a5.4 5.4 0 0 0 0-7.4Z"/><path d="M7 12h3l1-2 2 4 1-2h3"/>',
  pin:'<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 4v2"/>'
};
const icon = name => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
const menu = document.querySelector('.menu');
menu.onclick = () => menu.setAttribute('aria-expanded', document.getElementById('navlinks').classList.toggle('open'));
const services = [
  ['book','car','Ride Service','Local, scheduled and out-of-town rides.'],
  ['airport','plane','Airport Transportation','Plan your ride to or from the terminal.'],
  ['grocery','bag','Grocery Delivery','Get your grocery order brought to your door.'],
  ['medical','heart','Medical Appointments','Schedule transportation to your appointment.'],
  ['delivery','box','Delivery Services','Groceries, parcels, prescriptions and documents.']
];
const ride = ['Local ride','Scheduled ride','Medical ride','Airport ride','Out-of-town ride'];
const delivery = ['Grocery delivery','Parcel delivery','Prescription pickup','Document delivery'];
const route = location.pathname.split('/').filter(Boolean)[0] || 'home';
const active = document.querySelector(`nav a[href="${route === 'home' ? '/' : '/' + route + '/'}"]`);
if(active) active.setAttribute('aria-current','page');
const button = (href,label,cls='') => `<a class="btn ${cls}" href="${href}">${label}</a>`;
const form = `<form class="booking" id="booking"><div class="tabs" aria-label="Booking category" ${route==='home'?'hidden':''}><button type="button" data-category="ride">${icon('car')} Ride</button><button type="button" data-category="delivery">${icon('box')} Delivery</button></div><h3 id="booking-title">Plan your ride</h3><label><span id="pickup-label">Pickup location</span><input name="pickup" placeholder="Enter pickup address" required maxlength="250"></label><label><span id="dropoff-label">Destination</span><input name="destination" placeholder="Enter destination" required maxlength="250"></label><div id="ride-postal" class="postal-fields"><label>Pickup postal code<input name="pickupPostal" autocomplete="off" maxlength="7" placeholder="T4N 1A1"></label><label>Destination postal code<input name="destinationPostal" autocomplete="off" maxlength="7" placeholder="T4N 1A1"></label><p class="hint">Add both postal codes to help confirm your ride price.</p></div><label>Service<select name="service"></select></label><label id="details" hidden>Pickup instructions (optional)<input name="pickupDetails" maxlength="300" placeholder="Terminal, order reference or pickup notes"></label><label id="schedule" hidden>Pickup time (Alberta)<input name="scheduledAt" type="datetime-local"></label><button class="btn" type="submit">Continue booking</button><p class="status" role="status"></p></form>`;
const card = ([id,glyph,title,description]) => `<a class="card" href="/${id}/"><span class="icon">${icon(glyph)}</span><h3>${title}</h3><p>${description}</p><strong>Explore service</strong></a>`;
const pages = {
  about:['About Us','Community comes first.','ED’s brings everyday rides and deliveries together for Alberta communities.','From getting to an appointment to sending a parcel across town, find the right service for the trip you need.'],
  book:['Book a Ride','Where are you headed?','Choose a local, scheduled, airport, medical or out-of-town ride.','Enter your pickup and destination, then sign in to submit your request. Availability is confirmed after a driver is assigned.'],
  delivery:['Delivery Services','Send it across town.','Request grocery delivery, parcel delivery, prescription pickup or document delivery.','Enter the pickup and delivery addresses. For prescription pickups, arrange authorization with the pharmacy before booking.'],
  airport:['Airport Transportation','Start your trip on the right foot.','Schedule a ride to or from the airport with your terminal as a pickup or destination.','For airport pickups, add the terminal or designated pickup area to the address so your driver can find you.'],
  grocery:['Grocery Delivery','Groceries to your door.','Place your order with the store, then request delivery to your home.','Have the store address and your order pickup details ready when you book.'],
  medical:['Medical Appointments','Plan your ride to your appointment.','Request scheduled transportation to a clinic, hospital or other appointment.','For a return trip, submit a separate request when you know your pickup time. For a medical emergency, call 911.'],
  contact:['Contact','Get in touch with ED’s.','Ask about service coverage, bookings, or deliveries in Alberta.','To help with an existing booking, include your booking reference.']
};
const communityPhotos = `<div class="community-photos" aria-label="Photos of Springbrook and Penhold">
  <figure><img src="/springbrook.webp" alt="Homes beside a pond in Springbrook, Alberta" width="1250" height="833" loading="lazy"><figcaption><strong>Springbrook</strong><small>2021 · <a href="https://commons.wikimedia.org/wiki/File:Springbrook,_Red_Deer_County.jpg">Ribbet32</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · Resized</small></figcaption></figure>
  <figure><img src="/penhold.webp" alt="Exterior of the Penhold Museum in Penhold, Alberta" width="1250" height="833" loading="lazy"><figcaption><strong>Penhold</strong><small>2019 · <a href="https://commons.wikimedia.org/wiki/File:Penhold_Museum.jpg">Ribbet32</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · Resized</small></figcaption></figure>
</div>`;
const main = document.querySelector('main');
if(route==='home'){
  main.innerHTML = `<section class="hero"><div class="wrap hero-inner"><div class="hero-copy"><div class="eyebrow">Springbrook · Penhold · Central Alberta</div><h1>Request a Ride <br><span>with ED’S</span></h1><p>Book a ride across town, schedule transportation to an appointment, or plan your next airport trip.</p>${button('/book/', 'Request a Ride')}${button('/book/?service=scheduled', 'Schedule a Ride','ghost')}</div><img class="mobile-car" src="/eds-corolla.webp" alt="ED’s branded black Toyota Corolla" width="1672" height="941">${form}</div></section><section class="strip"><div class="wrap"><span>${icon('pin')} Alberta focused</span><span>${icon('clock')} Scheduled rides</span><span>${icon('people')} Community first</span></div></section><section class="section"><div class="wrap"><div class="center"><div class="eyebrow">Our services</div><h2>Find the right ride</h2><p class="intro">Book local, scheduled, airport, medical or out-of-town transportation. Delivery services are also available.</p></div><div class="cards">${services.map(card).join('')}</div></div></section><section class="section pale"><div class="wrap split"><div class="copy"><div class="eyebrow">Our mission</div><h2>Connecting Central Alberta.</h2><p class="intro">ED’S helps bridge gaps in rural transit with safe, dependable rides at fair, transparent prices. We help workers, students, and neighbours across Red Deer County and nearby communities get to work, school, and essential errands so they can stay connected and independent.</p>${button('/about/','Meet ED’s','blue')}</div>${communityPhotos}</div></section>`;
}else if(route==='account'){
  showAccount();
}else if(pages[route]){
  const [title,heading,lead,body]=pages[route];
  document.title=`${title} | ED’S Transport & Delivery`;
  const contact = `<form class="contact-form" id="contact"><label>Name<input name="name" required maxlength="100" autocomplete="name"></label><label>Email<input name="email" type="email" required maxlength="254" autocomplete="email"></label><label>Message<textarea name="message" required maxlength="2000"></textarea></label><button class="btn blue" type="submit">Send message</button><p class="status" role="status"></p></form>`;
  main.innerHTML=`<section class="subhero"><div class="wrap"><div class="eyebrow">ED’s Transport & Delivery</div><h1>${title}</h1><p>${lead}</p></div></section><section class="section pale"><div class="wrap split"><div class="detail copy"><h2>${heading}</h2><p class="intro">${body}</p>${route==='about' ? button('/book/','Book a Ride','blue') : route==='delivery' ? button('/marketplace/','Shop the Marketplace','blue') : route==='book'?'<p>Rides within Red Deer include a $2 pickup fee. Rides involving Innisfail, Blackfalds or Lacombe include a $5 surcharge, once per ride. We add 5% GST to your fare and any required fees.</p>':''}</div>${route==='about' ? communityPhotos : route==='contact' ? contact : form}</div></section><section class="section"><div class="wrap"><h2>Explore services</h2><div class="cards">${services.map(card).join('')}</div></div></section>`;
}else{
  main.innerHTML='<section class="section wrap"><h1>Page unavailable</h1><p><a href="/">Return home</a></p></section>';
}

const booking = document.getElementById('booking');
if(booking){
  let category;
  const select = booking.elements.service;
  const schedule = document.getElementById('schedule');
  function updateSchedule(){
    schedule.hidden = !['Scheduled ride','Medical ride','Airport ride'].includes(select.value);
    booking.elements.scheduledAt.required = !schedule.hidden;
  }
  function setCategory(value, service){
    category = value;
    booking.querySelectorAll('[data-category]').forEach(tab => tab.setAttribute('aria-pressed',tab.dataset.category===value));
    const isRide = value==='ride';
    document.getElementById('booking-title').textContent=isRide ? 'Plan your ride' : 'Plan your delivery';
    document.getElementById('dropoff-label').textContent=isRide ? 'Destination' : 'Delivery address';
    document.getElementById('ride-postal').hidden=!isRide;
    select.replaceChildren(...(isRide ? ride : delivery).map(label=>new Option(route==='home'&&label==='Local ride'?'Ride now':label,label)));
    if(service) select.value=service;
    document.getElementById('details').hidden=route==='home';
    updateSchedule();
  }
  booking.querySelectorAll('[data-category]').forEach(tab => tab.onclick=()=>setCategory(tab.dataset.category));
  select.onchange=updateSchedule;
  setCategory(['delivery','grocery'].includes(route)?'delivery':'ride',{book:new URLSearchParams(location.search).get('service')==='scheduled'?'Scheduled ride':undefined,airport:'Airport ride',medical:'Medical ride',grocery:'Grocery delivery'}[route]);
  booking.onsubmit=event=>{
    event.preventDefault();
    const values=Object.fromEntries(new FormData(booking));
    values.category=category;
    values.pickup=values.pickup.trim();
    values.destination=values.destination.trim();
    if(!values.pickup || !values.destination){booking.querySelector('.status').textContent='Enter a pickup address and a destination.';return;}
    if(!values.pickupDetails) delete values.pickupDetails;
    for(const key of ['pickupPostal','destinationPostal']){
      if(category!=='ride'||!values[key]?.trim()){delete values[key];continue;}
      values[key]=values[key].replace(/[ -]/g,'').toUpperCase();
      if(!/^T[0-9][ABCEGHJ-NPRSTV-Z][0-9][ABCEGHJ-NPRSTV-Z][0-9]$/.test(values[key])){
        booking.querySelector('.status').textContent='Enter a valid Alberta postal code for '+(key==='pickupPostal'?'pickup':'the destination')+'.';
        return;
      }
    }
    if(schedule.hidden) delete values.scheduledAt;
    if(values.scheduledAt){
      const alberta=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
      const localTime = values.scheduledAt;
      const intended = Date.parse(localTime + 'Z');
      const candidate = [-6,-7].map(offset=>new Date(intended-offset*3600000)).find(date=>{
        const parts=Object.fromEntries(alberta.formatToParts(date).map(p=>[p.type,p.value]));
        return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute===localTime;
      });
      if(!candidate){booking.querySelector('.status').textContent='Choose a valid Alberta pickup time.';return;}
      values.scheduledAt=candidate.toISOString();
      if(Date.parse(values.scheduledAt)<=Date.now()){booking.querySelector('.status').textContent='Choose a pickup time in the future.';return;}
    }
    openSubmission(booking, 'trips', values);
  };
}
const contact = document.getElementById('contact');
if(contact) contact.onsubmit=event=>{
  event.preventDefault();
  const values=Object.fromEntries([...new FormData(contact)].map(([key,value])=>[key,value.trim()]));
  if(!values.name||!values.email||!values.message){
    contact.querySelector('.status').textContent='Enter your name, email address and message.';
    return;
  }
  openSubmission(contact,'inquiries',values);
};

const submissionAttempts=new WeakMap();
async function createOnce(db,ref,payload,uid){
  try{await db.setDoc(ref,payload);}
  catch(error){
    // A response can be lost after the original create succeeds.
    const existing=await db.getDocFromServer(ref).catch(()=>null);
    if(existing?.data()?.customerId!==uid) throw error;
  }
}

async function openSubmission(form,collection,values){
  const status=form.querySelector('.status');
  if(!firebaseConfig){
    status.textContent=collection==='trips'?'Online booking is currently unavailable.':'Online contact is currently unavailable.';
    return;
  }
  const submit=form.querySelector('[type=submit]');
  if(submit.disabled) return;
  submit.disabled=true;
  try{
    const base='https://www.gstatic.com/firebasejs/11.10.0/';
    const [{initializeApp,getApps},auth,db]=await Promise.all([import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-firestore.js')]);
    const app=getApps()[0] || initializeApp(firebaseConfig);
    const account=auth.getAuth(app);
    await account.authStateReady();
    const user=account.currentUser || (await auth.signInWithPopup(account,new auth.GoogleAuthProvider())).user;
    const store=db.getFirestore(app);
    const fingerprint=JSON.stringify([user.uid,values]);
    let attempt=submissionAttempts.get(form);
    if(attempt?.fingerprint!==fingerprint){
      attempt={fingerprint,ref:db.doc(db.collection(store,collection))};
      submissionAttempts.set(form,attempt);
    }
    const {ref}=attempt;
    if(collection==='trips'){
      const payload={...values,customerId:user.uid,status:'requested',createdAt:db.serverTimestamp()};
      if(payload.scheduledAt) payload.scheduledAt=db.Timestamp.fromDate(new Date(payload.scheduledAt));
      await createOnce(db,ref,payload,user.uid);
      status.textContent='Request submitted. Your booking reference is '+ref.id+'. ';
      const pay=document.createElement('a');
      pay.href='/pay/?kind=trip&ref='+encodeURIComponent(ref.id);
      pay.textContent='View payment when your fare is ready';
      status.append(pay);
    }else{
      await createOnce(db,ref,{...values,customerId:user.uid,createdAt:db.serverTimestamp()},user.uid);
      status.textContent='Your message was sent.';
    }
    submissionAttempts.delete(form);
    if(form===booking){
      const selectedService=booking.elements.service.value;
      form.reset();
      booking.elements.service.value=selectedService;
      booking.elements.service.onchange();
    }else form.reset();
  }catch(error){
    status.textContent=error.code==='auth/popup-closed-by-user'?'Sign in to continue.':'The request could not be submitted. Please try again.';
  }finally{submit.disabled=false;}
}

function showAccount(){
  const signup=new URLSearchParams(location.search).get('mode')==='signup';
  const title=signup?'Sign Up':'Sign In';
  const next=new URLSearchParams(location.search).get('next');
  let nextPayment=null;
  if(next){
    try{const target=new URL(next,location.origin);
      if(target.origin===location.origin&&target.pathname==='/pay/') nextPayment=target.pathname+target.search;
    }catch{}
  }
  document.title=title+' | ED’S Transport & Delivery';
  main.innerHTML=`<section class="section pale"><div class="wrap account-page"><h1>${title}</h1><div class="contact-form" id="account-panel"></div></div></section>`;
  const panel=document.getElementById('account-panel');
  if(!firebaseConfig){
    panel.innerHTML='<p role="status">Customer accounts are unavailable on this preview.</p>'+button('/book/','Request a Ride','blue');
    return;
  }
  panel.innerHTML='<p role="status">Loading customer account…</p>';
  const base='https://www.gstatic.com/firebasejs/11.10.0/';
  Promise.all([import(base+'firebase-app.js'),import(base+'firebase-auth.js')]).then(([apps,sdk])=>{
    const auth=sdk.getAuth(apps.getApps()[0]||apps.initializeApp(firebaseConfig));
    sdk.onAuthStateChanged(auth,user=>{
      if(user){
        panel.innerHTML='<p>You’re signed in.</p>'+button('/book/','Request a Ride','blue')+'<button class="btn outline-account" type="button" id="account-exit">Sign Out</button><p class="status" role="status"></p>';
        panel.querySelector('#account-exit').onclick=()=>sdk.signOut(auth).catch(()=>{panel.querySelector('.status').textContent='Sign-out failed. Please try again.';});
        if(nextPayment){
          const link=document.createElement('a');link.href=nextPayment;link.className='btn blue';link.textContent='Continue to payment';
          panel.querySelector('p').after(link);
        }
        return;
      }
      panel.innerHTML=`<form id="customer-auth"><label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" ${signup?'minlength="8"':''} required></label>
        <button class="btn blue" type="submit">${title}</button><button class="btn outline-account" type="button" id="account-google">Continue with Google</button>
        <p class="status" role="status"></p></form><p class="account-switch">${signup?'Already have an account? <a href="/account/">Sign In</a>':'New to ED’S? <a href="/account/?mode=signup">Sign Up</a>'}</p>`;
      if(nextPayment){
        const toggle=panel.querySelector('.account-switch a');
        const switchUrl=new URL(toggle.href);
        switchUrl.searchParams.set('next',nextPayment);
        toggle.href=switchUrl.href;
      }
      const form=panel.querySelector('form');
      async function authenticate(action){
        const buttons=[...form.querySelectorAll('button')];
        if(buttons.some(button=>button.disabled)) return;
        buttons.forEach(button=>button.disabled=true);
        const status=form.querySelector('.status');
        status.textContent='';
        try{await action();}
        catch(error){
          const messages={'auth/email-already-in-use':'An account already uses this email. Sign in instead.',
            'auth/invalid-credential':'Check your email and password, then try again.',
            'auth/popup-closed-by-user':'The sign-in window was closed.',
            'auth/weak-password':'Choose a stronger password.'};
          status.textContent=messages[error.code]||'Unable to continue. Please try again.';
        }finally{buttons.forEach(button=>button.disabled=false);}
      }
      form.onsubmit=event=>{
        event.preventDefault();
        const {email,password}=Object.fromEntries(new FormData(form));
        authenticate(()=>signup?sdk.createUserWithEmailAndPassword(auth,email.trim(),password):sdk.signInWithEmailAndPassword(auth,email.trim(),password));
      };
      panel.querySelector('#account-google').onclick=()=>authenticate(()=>sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider()));
    });
  }).catch(()=>{panel.textContent='Customer accounts could not load. Please try again.';});
}

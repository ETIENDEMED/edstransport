import {firebaseConfig} from './config.js';

const staff=location.pathname.startsWith('/admin');
const title=staff?'Admin Console':'Driver Portal';
const root=document.querySelector('#portal');
const e=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=cents=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format((cents||0)/100);
const date=value=>value?new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Edmonton'}).format(value.toDate?.()??new Date(value)):'';
const dateInput=()=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
  return [parts.year,parts.month,parts.day].join('-');
};
const timestamp=value=>value?.toMillis?.()??Number(value??0);
const labels={photo:'Driver photo',license:'Driver licence',registration:'Vehicle registration',insurance:'Insurance',record:'Criminal record check',inspection:'Vehicle inspection form'};
const checks={identity:'Photo and identity match',license:'Driver licence verified',registration:'Vehicle registration verified',insurance:'Insurance verified',criminalRecord:'Criminal record check verified',vehicleInspection:'Vehicle inspection verified'};
const inspection={brakes:'Brakes and parking brake',tires:'Tires and wheels',lights:'Lights and signals',restraints:'Seat belts and restraints',interior:'Windshield, mirrors and cabin'};
const statuses={requested:'Requested',assigned:'Assigned',en_route:'En route',in_progress:'In progress',completed:'Completed',cancelled:'Cancelled'};
const ledgerTypes={completed_ride:'Completed rides',completed_delivery:'Completed deliveries',ride:'Ride revenue',delivery:'Delivery revenue',tip:'Tips',bonus:'Bonuses'};
const periodLabels={daily:'Today',weekly:'This week',monthly:'This month'};
const nav=staff?{applications:'Applications',directory:'Drivers',dispatch:'Dispatch',payments:'Payments'}:{overview:'Overview',scheduled:'Scheduled',deliveries:'Deliveries',history:'Completed trips',earnings:'Earnings'};
const quick={overview:'Your shift',scheduled:'Scheduled rides',deliveries:'Delivery jobs',history:'Completed trips',earnings:'Earnings',applications:'Driver applications',directory:'Driver directory',dispatch:'Dispatch queue',payments:'Driver payments'};
const state={page:Object.keys(nav)[0],demo:!firebaseConfig,user:null,driver:null,application:null,offers:[],active:[],history:[],applications:[],requested:[],drivers:[],earnings:null,ledger:[],lastHistory:null,notice:'',bad:false};
let api,unsubscribe=[],heartbeat,gps,gpsTrip,lastGps=0,refreshEarnings,signingOut=false,locked=false;
const btn=(label,attrs='',style='blue')=>`<button class="btn ${style}" ${attrs}>${label}</button>`;
const signOut=()=>btn('Sign out','type="button" data-action="signout"','outline');
const renderHead=()=>`<header class="ops-top"><a href="/" aria-label="ED’s Transport and Delivery home"><img src="/eds-logo.webp" alt="ED’S Transport &amp; Delivery"></a><span>${title}</span><a href="${staff?'/driver/':'/admin/'}">${staff?'Driver Portal':'Admin Console'}</a></header>`;
const demoBanner=()=>state.demo?`<div class="ops-banner"><span><strong>Demo workspace.</strong> Sample data and temporary changes. Use fictional information only.</span>${staff?'':btn('Try signup','data-action="demo-signup"','outline')}</div>`:'';
const notice=()=>`<p id="portal-notice" class="ops-message ${state.bad?'':'good'}" role="status">${e(state.notice)}</p>`;
const badge=(text,on=false)=>`<span class="tag ${on?'on':''}">${e(text)}</span>`;
const empty=message=>`<p class="muted">${message}</p>`;
const section=(heading,content)=>`<section class="ops-panel"><h2>${heading}</h2>${content}</section>`;
const authFields=()=>`<label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" minlength="8" autocomplete="current-password" required></label>`;
function badgeOnline() {
  return state.driver?.online && (state.demo || timestamp(state.driver?.onlineUntil)>Date.now());
}
function authPanel(){
  return `<div class="ops-auth"><div class="eyebrow">ED’S Transport &amp; Delivery</div><h1>${title}</h1>
    ${section(state.newAccount?'Create your driver account':'Sign in',`<form data-form="auth" class="ops-form ops-stack">${authFields()}
       ${btn(state.newAccount?'Create account':'Sign in','type="submit"')}
       ${staff?'':btn(state.newAccount?'Use an existing account':'Create a driver account','type="button" data-action="toggle-auth"','outline')}
       ${state.newAccount?'':btn('Send password reset','type="button" data-action="reset"','outline')}
    </form>`)}</div>`;
}
function signup(){
  const application=state.application;
  const docInputs=state.demo?`<p class="muted">The demo uses sample documents and does not accept uploads.</p>${Object.values(labels).map(label=>`<div class="ops-head"><span>${label}</span>${badge('Sample document')}</div>`).join('')}`:Object.entries(labels).map(([kind,label])=>`<label>${label}<input class="ops-fileselect" type="file" name="${kind}" accept="image/jpeg,image/png,image/webp${kind==='photo'?'':',application/pdf'}" required></label>`).join('');
  return `<div class="ops-auth"><div class="eyebrow">Drive with ED’S</div><h1>Driver application</h1>
    ${application?.status==='needs_changes'?`<p class="ops-banner">Changes requested. ${e(application.note)}</p>`:''}
    ${section('Driver and vehicle',`<form class="ops-stack ops-form" data-form="application"><label>Full legal name<input name="name" value="${e(application?.name)}" required maxlength="100"></label>
    <div class="ops-form-cols"><label>Vehicle year, make and model<input name="vehicle" value="${e(application?.vehicle)}" required maxlength="100"></label><label>Licence plate<input name="plate" value="${e(application?.plate)}" required maxlength="20"></label></div>
    <fieldset><legend>Documents</legend>${docInputs}<p class="muted">JPG, PNG or WebP for photos, and PDF or images for other documents. Maximum 10 MB per file.</p></fieldset>
    <fieldset><legend>Vehicle inspection</legend><div class="ops-form-cols"><label>Inspector or shop<input name="inspectedBy" required maxlength="100"></label><label>Inspection date<input type="date" name="inspectedAt" max="${dateInput()}" required></label></div>
    ${Object.entries(inspection).map(([key,label])=>`<label><input type="checkbox" name="${key}" required> ${label}</label>`).join('')}</fieldset>
    ${btn('Submit for admin review','type="submit"')}
    </form>`)}
    <div class="actions">${state.demo?btn('Back to demo dashboard','data-action="demo-dashboard"','outline'):signOut()}</div></div>`;
}
function tracking(trip){
  const stage=trip.status==='assigned'?'en_route':trip.status==='en_route'?'in_progress':trip.status==='in_progress'?'completed':'';
  const destination=trip.status==='in_progress'?trip.destination:trip.pickup;
  const maps='https://www.google.com/maps/dir/?api=1&travelmode=driving&destination='+encodeURIComponent(destination||'');
  return `<article class="ops-job"><div class="ops-head"><h3>${e(trip.service)}</h3>${badge(statuses[trip.status]||trip.status)}</div>
    ${trip.scheduledAt?`<p>${e(date(trip.scheduledAt))} Alberta time</p>`:''}
    <p><strong>Pickup</strong> ${e(trip.pickup)}</p><p><strong>Destination</strong> ${e(trip.destination)}</p>
    ${trip.pickupDetails?`<p>${e(trip.pickupDetails)}</p>`:''}
    ${stage?`<div class="actions"><a class="btn outline" href="${e(maps)}" target="_blank" rel="noopener noreferrer">Open GPS navigation</a>
      ${btn(gpsTrip===trip.id?'Stop GPS sharing':'Share live GPS',`data-action="gps" data-id="${e(trip.id)}"`,'outline')}
      ${btn({en_route:'Start heading to pickup',in_progress:'Start job',completed:'Complete job'}[stage],`data-action="stage" data-id="${e(trip.id)}" data-stage="${stage}"`)}</div>`:''}
  </article>`;
}
function offerRow(offer){
  return `<article class="ops-job"><div class="ops-head"><h3>${e(offer.service)}</h3>${badge(offer.category==='delivery'?'Delivery':'Ride')}</div>
  <p>${offer.scheduledAt?'Pickup at '+e(date(offer.scheduledAt))+' Alberta time':'Pickup as soon as possible'}</p>
  <div class="actions">${btn('Accept',`data-action="accept" data-id="${e(offer.id)}"`)}${btn('Decline',`data-action="decline" data-id="${e(offer.id)}"`,'outline')}</div></article>`;
}
const list=(items,html,fallback)=>items.length?`<div class="ops-list">${items.map(html).join('')}</div>`:empty(fallback);
const displayedOffers=()=>state.offers.filter(o=>state.demo || timestamp(o.expiresAt)>Date.now());
const isCompleted=key=>key.startsWith('completed_');
const count=period=>(period?.completed_ride?.count||0)+(period?.completed_delivery?.count||0);
const cents=period=>Object.entries(period||{}).filter(([key])=>!isCompleted(key)).reduce((sum,[,value])=>sum+(value.cents||0),0);
const stats=()=>`<div class="ops-grid">${Object.entries(periodLabels).map(([key,label])=>`<div class="ops-stat"><span>${label}</span><strong>${state.earnings?money(cents(state.earnings[key])):'—'}</strong><small>${state.earnings?`${count(state.earnings[key])} completed trips · CAD`:'Earnings unavailable'}</small></div>`).join('')}</div>`;
function earnings(){
  return stats()+Object.entries(periodLabels).map(([key,label])=>section(label,`<table class="ops-table"><thead><tr><th scope="col">Activity</th><th scope="col">Amount</th></tr></thead><tbody>
    ${Object.entries(ledgerTypes).map(([type,title])=>`<tr><td>${title}</td><td>${state.earnings?(isCompleted(type)?(state.earnings[key]?.[type]?.count||0):money(state.earnings[key]?.[type]?.cents)):'—'}</td></tr>`).join('')}
    </tbody></table>`)).join('');
}
function driverPage(){
  const offers=displayedOffers();
  if(state.page==='overview'){
    return `<div class="ops-head"><div><div class="eyebrow">Driver dashboard</div><h1>Your shift</h1><p class="muted">Welcome, ${e(state.driver?.name||'driver')}.</p></div>
      <div>${badge(badgeOnline()?'Online':'Offline',badgeOnline())}<div class="actions">${btn(badgeOnline()?'Go offline':'Go online','data-action="availability"')}</div></div></div>
      ${stats()}<div class="ops-panels">${section('Incoming jobs',list(offers,offerRow,'New offers appear here when you’re online.'))}
      ${section('Current assignment',list(state.active,tracking,'Your accepted ride or delivery will appear here.'))}</div>`;
  }
  let content='';
  if(state.page==='scheduled'){
    content=section('Scheduled offers',list(offers.filter(o=>o.scheduledAt&&o.category==='ride'),offerRow,'No scheduled ride offers.'))+
      section('Accepted scheduled rides',list(state.active.filter(t=>t.scheduledAt&&t.category==='ride'),tracking,'No scheduled rides assigned.'));
  }
  if(state.page==='deliveries'){
    content=section('Delivery offers',list(offers.filter(o=>o.category==='delivery'),offerRow,'No delivery offers.'))+
      section('Accepted deliveries',list(state.active.filter(t=>t.category==='delivery'),tracking,'No delivery jobs assigned.'));
  }
  if(state.page==='history'){
    content=section('Trip history',list(state.history,tracking,'No completed trips to show.')+(state.lastHistory?btn('Load older trips','data-action="older"','outline'):''));
  }
  if(state.page==='earnings') content=earnings();
  return `<h1>${quick[state.page]}</h1><div class="ops-stack ops-section">${content}</div>`;
}
function adminPage(){
  const item=state.applications.find(a=>a.id===state.review);
  if(state.page==='applications'){
    const queue=section('Pending review',list(state.applications,a=>`<article class="ops-job"><h3>${e(a.name)}</h3><p>${e(a.vehicle)} · ${e(date(a.submittedAt))}</p>
      <div class="actions">${btn('Review',`data-action="review" data-id="${e(a.id)}"`,'outline')}</div></article>`,'No applications are waiting.'));
    const detail=item?section(e(item.name),`<p>${e(item.vehicle)} · ${e(item.plate)}</p><p>Inspection by ${e(item.inspectedBy)} on ${e(item.inspectedAt)}</p>
      <div class="actions">${Object.entries(labels).map(([key,label])=>btn(e(label),`data-action="document" data-key="${key}" type="button"`,'outline')).join('')}</div>
      <form data-form="decision" class="ops-stack ops-form ops-section"><fieldset><legend>Verification</legend>${Object.entries(checks).map(([key,label])=>`<label><input type="checkbox" name="${key}"> ${label}</label>`).join('')}</fieldset>
      <label>Notes for applicant<textarea name="note" maxlength="600" rows="3"></textarea></label>
      <div class="actions">${btn('Approve and activate','type="submit" value="approved"')}${btn('Request changes','type="submit" value="needs_changes"','outline')}</div></form>`):section('Application details',empty('Choose a pending application to review.'));
    return `<h1>Driver applications</h1><div class="ops-panels">${queue}${detail}</div>`;
  }
  if(state.page==='directory'){
    return `<h1>Driver directory</h1><div class="ops-section">${section('Driver accounts',list(state.drivers,driver=>`<article class="ops-job"><div class="ops-head"><h3>${e(driver.name)}</h3>${badge(driver.active?'Active':'Suspended',driver.active)}</div>
      <p>${e(driver.vehicle||'')} · ${e(driver.id)}</p><div class="actions">${btn(driver.active?'Suspend account':'Reactivate account',`data-action="activation" data-id="${e(driver.id)}"`,'outline')}</div></article>`,'No driver accounts are available.'))}</div>`;
  }
  if(state.page==='dispatch'){
    const cards=list(state.requested,trip=>`<article class="ops-job"><h3>${e(trip.service)}</h3><p>${e(trip.pickup)} to ${e(trip.destination)}</p>
      <p>${e(trip.scheduledAt?date(trip.scheduledAt):'As soon as possible')} · ${e(trip.id)}</p>
      <form class="ops-form actions" data-form="dispatch" data-id="${e(trip.id)}">
        <label>Driver<select name="uid" required><option value="">Choose an available driver</option>${state.drivers.filter(d=>d.active&&!d.busy).map(d=>`<option value="${e(d.id)}">${e(d.name)}</option>`).join('')}</select></label>
        ${btn('Assign manually','type="submit"')}${btn('Cancel request',`type="button" data-action="cancel" data-id="${e(trip.id)}"`,'outline')}
      </form></article>`,'No unassigned bookings.');
    const assigned=list(state.active,trip=>`<article class="ops-job"><div class="ops-head"><h3>${e(trip.service)}</h3>${badge(statuses[trip.status]||trip.status)}</div>
      <p>${e(trip.pickup)} to ${e(trip.destination)}</p><p>${e(trip.driver?.name||'Assigned driver')} · ${e(trip.id)}</p>
      ${trip.scheduledAt?`<p>${e(date(trip.scheduledAt))} Alberta time</p>`:''}
      <div class="actions">${btn('Cancel booking',`type="button" data-action="cancel" data-id="${e(trip.id)}"`,'outline')}</div>
    </article>`,'No active assignments.');
    return `<h1>Dispatch queue</h1><div class="ops-panels">${section('Requested jobs',cards)}${section('Active assignments',assigned)}</div>`;
  }
  return `<h1>Driver payments</h1><div class="ops-panels">${section('Record earnings',`<form class="ops-form ops-stack" data-form="payment">
    <label>Driver account ID<input name="uid" required list="driver-ids" maxlength="128" value="${e(state.ledgerDriver)}"><datalist id="driver-ids">${state.drivers.map(d=>`<option value="${e(d.id)}">${e(d.name)}</option>`).join('')}</datalist></label>
    <label>Category<select name="type">${Object.entries(ledgerTypes).filter(([key])=>!isCompleted(key)).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label>
    <label>Completed booking ID<input name="tripId" maxlength="128" placeholder="Optional only for bonuses"></label>
    <label>Amount in CAD<input name="amount" inputmode="decimal" placeholder="25.00" required maxlength="8"></label>
    <p class="muted">Record revenue, tips and bonuses for driver reporting. This entry does not transfer funds.</p>
    ${btn('Record entry','type="submit"')}
    </form>`)}${section('Recent ledger entries',`<form class="ops-form actions" data-form="ledger"><label>Driver account ID<input name="uid" required value="${e(state.ledgerDriver)}" list="driver-ids" maxlength="128"></label>${btn('Load ledger','type="submit"','outline')}</form>
    <div class="ops-section">${list(state.ledger,entry=>`<article class="ops-job"><strong>${e(ledgerTypes[entry.type]||entry.type)}</strong><p>${isCompleted(entry.type)?'Trip completed':money(entry.amountCents)} · ${e(entry.day)}</p>${entry.tripId?`<p>${e(entry.tripId)}</p>`:''}</article>`,'Select a driver to view their ledger.')}</div>`)}
   </div>`;
}
function render(){
  const ready=state.demo?!state.demoSignup:state.user&&!state.loading&&(staff?state.canDispatch:state.driver?.active);
  if(ready){
    root.innerHTML=renderHead()+`<div class="ops-layout"><aside class="ops-sidebar"><nav aria-label="${title} navigation">${Object.entries(nav).filter(([key])=>!staff||state.demo||state.isAdmin||key==='dispatch').map(([key,label])=>`<button type="button" data-page="${key}" ${state.page===key?'aria-current="page"':''}>${label}</button>`).join('')}</nav>
      <div class="side-footer">${state.demo?'Demonstration':signOut()}</div></aside><main class="ops-main" id="main">${demoBanner()}${notice()}${staff?adminPage():driverPage()}</main></div>`;
    return;
  }
  let content;
  if(state.loading) content='<p role="status">Loading account…</p>';
  else if(state.demo) content=state.application?.status==='pending'?`<div class="ops-auth"><h1>Application submitted</h1><p>Admin approval is required before activation.</p><div class="actions">${btn('Back to demo dashboard','data-action="demo-dashboard"')}</div></div>`:signup();
  else if(!state.user) content=authPanel();
  else if(staff) content=`<div class="ops-auth"><h1>Admin access required</h1><div class="actions">${signOut()}</div></div>`;
  else if(state.failedLoad) content=`<div class="ops-auth"><h1>Account unavailable</h1><div class="actions">${btn('Retry','data-action="reload"')}${signOut()}</div></div>`;
  else if(!state.user.emailVerified) content=`<div class="ops-auth"><h1>Verify your email</h1><p>Open the verification email, then return here.</p><div class="actions">${btn('I verified my email','data-action="reload"')}${btn('Resend verification','data-action="verify"','outline')}${signOut()}</div></div>`;
  else if(state.application?.status==='pending') content=`<div class="ops-auth"><h1>Application under review</h1><p>Your driver account activates after an administrator verifies your application.</p><div class="actions">${signOut()}</div></div>`;
  else if(state.application?.status==='approved') content=`<div class="ops-auth"><h1>Driver account unavailable</h1><p>Contact ED’S to check your account status.</p><div class="actions">${signOut()}</div></div>`;
  else content=signup();
  root.innerHTML=renderHead()+`<main class="ops-main" id="main">${demoBanner()}${notice()}${content}</main>`;
}
function show(message='',bad=false){
  state.notice=message;
  state.bad=bad;
  const el=document.getElementById('portal-notice');
  if(el) {el.textContent=message;el.classList.toggle('good',!bad);}
}

const demoTrips=[
  {id:'ED-1048',service:'Scheduled ride',category:'ride',pickup:'Sample pickup · Red Deer',destination:'Sample destination · Penhold',status:'requested',scheduledAt:Date.now()+1800000},
  {id:'ED-1049',service:'Parcel delivery',category:'delivery',pickup:'Sample shop · Red Deer',destination:'Sample drop-off · Springbrook',status:'requested'}
];
const demoEarnings={
  daily:{completed_ride:{count:2},completed_delivery:{count:1},ride:{cents:4200},delivery:{cents:1800},tip:{cents:700},bonus:{cents:0}},
  weekly:{completed_ride:{count:16},completed_delivery:{count:5},ride:{cents:32400},delivery:{cents:9750},tip:{cents:4600},bonus:{cents:2500}},
  monthly:{completed_ride:{count:49},completed_delivery:{count:19},ride:{cents:102400},delivery:{cents:34800},tip:{cents:11500},bonus:{cents:7500}}
};
const snapshotRows=snapshot=>snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));
function refresh(){
  if(!locked && !document.activeElement?.closest('form')) render();
}
function watch(reference,apply){
  unsubscribe.push(api.db.onSnapshot(reference,snapshot=>{
    const visible=apply(snapshot);
    if(visible!==false) refresh();
  },error=>show(error.message||'This data could not be loaded.',true)));
}
function stopGps(){
  if(gps!=null) navigator.geolocation.clearWatch(gps);
  gps=null;gpsTrip=null;lastGps=0;
}
function stopSession(){
  unsubscribe.forEach(stop=>stop());unsubscribe=[];
  clearInterval(heartbeat);heartbeat=null;
  clearInterval(refreshEarnings);refreshEarnings=null;
  stopGps();
}
function assignedQuery(history=false){
  const {db,store}=api;
  return db.query(db.collection(store,'trips'),db.where('driverId','==',state.user.uid),
    db.where('status',history?'==':'in',history?'completed':['assigned','en_route','in_progress']),
    db.orderBy('updatedAt','desc'),db.limit(history?20:25));
}
async function loadHistory(older=false){
  const {db}=api;
  const query=assignedQuery(true);
  const result=await db.getDocs(older&&state.lastHistory?db.query(query,db.startAfter(state.lastHistory)):query);
  state.history=older?[...state.history,...snapshotRows(result).filter(row=>!state.history.some(old=>old.id===row.id))]:snapshotRows(result);
  state.lastHistory=result.size===20?result.docs.at(-1):null;
}
async function readEarnings(){
  const uid=state.user?.uid;
  try{
    const result=await api.run('driverEarnings',{});
    if(state.user?.uid!==uid) return;
    state.earnings=result;
    if(['overview','earnings'].includes(state.page)) refresh();
  }catch(error){if(state.user?.uid===uid) show(error.message||'Earnings could not be loaded.',true);}
}
function keepOnline(){
  clearInterval(heartbeat);
  const session=state.driver?.availabilitySession;
  if(!session) return;
  const interval=setInterval(async()=>{
    if(!state.driver?.online || signingOut || state.driver.availabilitySession!==session){clearInterval(interval);return;}
    try{await api.run('setDriverAvailability',{online:true,renew:true,session});}
    catch(error){
      clearInterval(interval);
      if(heartbeat!==interval || !state.driver?.online || signingOut) return;
      heartbeat=null;
      refresh();
      show(error.message||'Could not renew availability.',true);
    }
  },35000);
  heartbeat=interval;
}
function watchDriverJobs(){
  const {db,store}=api;
  const uid=state.user.uid;
  watch(db.query(db.collection(store,'drivers',uid,'offers'),db.limit(25)),snapshot=>{
    state.offers=snapshotRows(snapshot);
    return ['overview','scheduled','deliveries'].includes(state.page);
  });
  watch(assignedQuery(),snapshot=>{
    state.active=snapshotRows(snapshot);
    if(gpsTrip && !state.active.some(t=>t.id===gpsTrip)) stopGps();
    return ['overview','scheduled','deliveries'].includes(state.page);
  });
  readEarnings();
  refreshEarnings=setInterval(()=>{if(['overview','earnings'].includes(state.page)) readEarnings();},60000);
}
function watchStaff(){
  const {db,store}=api;
  if(state.isAdmin){
    watch(db.query(db.collection(store,'driverApplications'),db.where('status','==','pending'),db.orderBy('submittedAt'),db.limit(25)),
      snapshot=>{state.applications=snapshotRows(snapshot);return state.page==='applications';});
  }
  watch(db.query(db.collection(store,'trips'),db.where('status','==','requested'),db.orderBy('createdAt'),db.limit(25)),
    snapshot=>{state.requested=snapshotRows(snapshot);return state.page==='dispatch';});
  watch(db.query(db.collection(store,'trips'),db.where('status','in',['assigned','en_route','in_progress']),
    db.orderBy('updatedAt','desc'),db.limit(25)),snapshot=>{state.active=snapshotRows(snapshot);return state.page==='dispatch';});
  watch(db.query(db.collection(store,'drivers'),db.limit(50)),
    snapshot=>{state.drivers=snapshotRows(snapshot);return ['dispatch','payments','directory'].includes(state.page);});
}
let uploadAttempt, paymentAttempt;
async function session(user){
  stopSession();
  uploadAttempt=null;paymentAttempt=null;
  Object.assign(state,{user,loading:!!user,failedLoad:false,isAdmin:false,canDispatch:false,driver:null,application:null,
    history:[],lastHistory:null,offers:[],active:[],requested:[],applications:[],drivers:[],ledger:[],earnings:null,ledgerDriver:'',review:null});
  render();
  if(!user) return;
  const {db,store,auth}=api;
  try{
    if(staff){
      const {claims}=await api.authSdk.getIdTokenResult(user,true);
      if(auth.currentUser?.uid!==user.uid) return;
      state.isAdmin=claims.driverAdmin===true;
      state.canDispatch=state.isAdmin||claims.dispatcher===true;
      state.page=state.isAdmin?'applications':'dispatch';
      state.loading=false;
      if(state.canDispatch) watchStaff();
      render();
      return;
    }
    const driverRef=db.doc(store,'drivers',user.uid);
    const appRef=db.doc(store,'driverApplications',user.uid);
    const [driver,application]=await Promise.all([db.getDoc(driverRef),db.getDoc(appRef)]);
    if(auth.currentUser?.uid!==user.uid) return;
    state.driver=driver.data();state.application=application.data();state.loading=false;
    let jobs=state.driver?.active===true;
    watch(driverRef,snapshot=>{
      const previous=state.driver;
      state.driver=snapshot.data();
      if(!jobs && state.driver?.active){jobs=true;watchDriverJobs();}
      if(!state.driver?.active) stopGps();
      return previous?.active!==state.driver?.active || previous?.online!==state.driver?.online || state.page==='overview';
    });
    watch(appRef,snapshot=>{const status=state.application?.status;state.application=snapshot.data();return status!==state.application?.status;});
    if(jobs){watchDriverJobs();if(badgeOnline()) keepOnline();}
    render();
  }catch(error){
    if(auth.currentUser?.uid!==user.uid) return;
    state.loading=false;state.failedLoad=true;render();show(error.message||'Unable to load your account.',true);
  }
}
async function setup(){
  if(state.demo){
    state.driver={name:'Jordan Sample',online:false};
    state.earnings=structuredClone(demoEarnings);
    state.history=[{...demoTrips[0],id:'ED-1040',service:'Local ride',status:'completed',scheduledAt:null}];
    state.applications=[{id:'demo-driver',batch:'demo',name:'Taylor Sample',vehicle:'2022 Toyota Corolla',plate:'DEMO01',inspectedBy:'Sample Auto',inspectedAt:'2026-11-15',submittedAt:Date.now()-3600000}];
    state.requested=structuredClone(demoTrips);
    state.drivers=[{id:'demo-driver',name:'Jordan Sample',vehicle:'2022 Toyota Corolla',active:true,busy:false}];
    render();return;
  }
  try{
    const base='https://www.gstatic.com/firebasejs/11.10.0/';
    const [apps,authSdk,db,storageSdk,functions]=await Promise.all(
      ['app','auth','firestore','storage','functions'].map(label=>import(base+'firebase-'+label+'.js')));
    const app=apps.initializeApp(firebaseConfig);
    const auth=authSdk.getAuth(app), store=db.getFirestore(app),storage=storageSdk.getStorage(app);
    const fns=functions.getFunctions(app,'northamerica-northeast1');
    api={authSdk,auth,db,store,storageSdk,storage,run:async(name,data)=>(await functions.httpsCallable(fns,name)(data)).data};
    authSdk.onAuthStateChanged(auth,session);
  }catch(error){show('Unable to connect to Firebase. Check the web configuration.',true);if(!document.getElementById('portal-notice')) root.querySelector('[role=status]').textContent=state.notice;}
}

async function submitApplication(form){
  const fields=new FormData(form);
  const object=Object.fromEntries(['name','vehicle','plate','inspectedBy','inspectedAt'].map(key=>[key,fields.get(key)]));
  object.inspection=Object.fromEntries(Object.keys(inspection).map(key=>[key,fields.has(key)]));
  if(state.demo){state.application={status:'pending'};render();return;}
  const files=Object.fromEntries(Object.keys(labels).map(key=>[key,fields.get(key)]));
  for(const [key,file] of Object.entries(files)){
    const formats=['image/jpeg','image/png','image/webp',...(key==='photo'?[]:['application/pdf'])];
    if(!file?.size || file.size>10485760 || !formats.includes(file.type)) throw Error('Check the file type and size for '+labels[key]+'.');
  }
  const signature=Object.values(files).map(file=>[file.name,file.size,file.lastModified,file.type].join(':')).join('|');
  if(uploadAttempt?.signature!==signature) uploadAttempt={batch:crypto.randomUUID(),signature,uploaded:new Set()};
  const attempt=uploadAttempt;
  const {storageSdk,storage}=api;
  for(const [key,file] of Object.entries(files)){
    if(attempt.uploaded.has(key)) continue;
    show('Uploading '+labels[key].toLowerCase()+'…');
    const ref=storageSdk.ref(storage,'driver-documents/'+state.user.uid+'/'+attempt.batch+'/'+key);
    try{await storageSdk.uploadBytes(ref,file,{contentType:file.type});}
    catch(error){
      if(error.code!=='storage/unauthorized') throw error;
      const existing=await storageSdk.getMetadata(ref);
      if(existing.size!==file.size||existing.contentType!==file.type) throw error;
    }
    attempt.uploaded.add(key);
  }
  const result=await api.run('submitDriverApplication',{...object,batch:attempt.batch});
  state.application={status:result.status};
  uploadAttempt=null;render();show('Application submitted for review.');
}
function startGps(id){
  if(state.demo){
    gpsTrip=gpsTrip===id?null:id;render();
    show(gpsTrip?'Demo GPS sharing started.':'Demo GPS sharing stopped.');return;
  }
  if(gpsTrip===id){stopGps();render();show('Live GPS sharing stopped.');return;}
  if(!navigator.geolocation) throw Error('Location access is unavailable in this browser.');
  stopGps();gpsTrip=id;
  gps=navigator.geolocation.watchPosition(async position=>{
    const now=Date.now();
    if(gpsTrip!==id || now-lastGps<12000) return;
    lastGps=now;
    const {db,store}=api;
    try{await db.setDoc(db.doc(store,'trips',id,'live','position'),{
      latitude:position.coords.latitude,longitude:position.coords.longitude,updatedAt:db.serverTimestamp()
    });}
    catch(error){if(gpsTrip===id){stopGps();render();show('Location sharing stopped. '+error.message,true);}}
  },error=>{
    if(gpsTrip===id){stopGps();render();show('Location sharing stopped. '+error.message,true);}
  },{enableHighAccuracy:true,maximumAge:10000,timeout:25000});
  render();show('Keep this page open while sharing your live location.');
}
async function loadLedger(uid){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw Error('Enter a valid driver account ID.');
  state.ledgerDriver=uid;
  if(state.demo) return;
  const {db,store}=api;
  const query=db.query(db.collection(store,'drivers',uid,'ledger'),db.orderBy('createdAt','desc'),db.limit(25));
  state.ledger=snapshotRows(await db.getDocs(query));
}
async function download(key){
  if(state.demo){show('The demo has no private files.');return;}
  const app=state.applications.find(a=>a.id===state.review);
  const item=app?.documents?.[key];
  if(!item) throw Error('This document is unavailable.');
  const {storageSdk,storage}=api;
  const blob=await storageSdk.getBlob(storageSdk.ref(storage,item.path),10485760);
  const url=URL.createObjectURL(blob);
  const extension={'application/pdf':'pdf','image/png':'png','image/webp':'webp','image/jpeg':'jpg'}[blob.type]||'bin';
  const a=document.createElement('a');a.href=url;a.download='ED-driver-'+key+'.'+extension;
  document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function clicked(button){
  const {action,id,key,stage,page}=button.dataset;
  if(page){
    state.page=page;
    if(page==='history'&&!state.demo) await loadHistory();
    if((page==='earnings'||page==='overview')&&!state.demo) readEarnings();
    render();document.querySelector('[aria-current=page]')?.focus();return;
  }
  if(action==='demo-signup'){state.application=null;state.demoSignup=true;render();return;}
  if(action==='demo-dashboard'){state.demoSignup=false;render();return;}
  if(action==='toggle-auth'){state.newAccount=!state.newAccount;render();return;}
  if(action==='verify'){await api.authSdk.sendEmailVerification(state.user);show('Verification email sent.');return;}
  if(action==='reset'){
    const input=root.querySelector('[name=email]');
    if(!input.reportValidity()) return;
    await api.authSdk.sendPasswordResetEmail(api.auth,input.value.trim());show('If the account exists, a reset email will arrive.');return;
  }
  if(action==='reload'){
    await api.authSdk.reload(state.user);await api.authSdk.getIdToken(state.user,true);await session(state.user);return;
  }
  if(action==='signout'){
    signingOut=true;
    try{
      if(state.driver?.active&&state.driver.online){
        await api.run('setDriverAvailability',{online:false}).catch(()=>{});
      }
      stopGps();await api.authSdk.signOut(api.auth);
    }finally{signingOut=false;}return;
  }
  if(action==='availability'){
    const online=!badgeOnline();
    if(state.demo){state.driver.online=online;state.offers=online&&!state.active.length?structuredClone(demoTrips):[];}
    else{
      const result=await api.run('setDriverAvailability',{online});
      state.driver={...state.driver,online,onlineUntil:result.until,availabilitySession:result.session};
      if(online) keepOnline();else{clearInterval(heartbeat);heartbeat=null;}
    }
    render();show(online?'You’re available for incoming jobs.':'You’re offline.');return;
  }
  if(action==='accept'||action==='decline'){
    const accept=action==='accept';
    if(state.demo){
      const offer=state.offers.find(t=>t.id===id);
      if(accept&&offer){state.active=[{...offer,status:'assigned'}];state.offers=[];}
      else state.offers=state.offers.filter(t=>t.id!==id);
    }else{
      await api.run('answerOffer',{tripId:id,accept});
      state.offers=state.offers.filter(t=>t.id!==id);
    }
    render();show(accept?'Job accepted.':'Job declined.');return;
  }
  if(action==='gps'){startGps(id);return;}
  if(action==='stage'){
    if(stage==='completed'&&!window.confirm('Mark this job completed?')) return;
    if(state.demo){
      const trip=state.active.find(job=>job.id===id);
      if(trip) trip.status=stage;
      if(stage==='completed'&&trip){
        state.history.unshift(trip);state.active=state.active.filter(job=>job.id!==id);
        for(const period of Object.values(state.earnings)) period[trip.category==='delivery'?'completed_delivery':'completed_ride'].count++;
      }
    }else await api.run('updateTrip',{tripId:id,status:stage});
    if(stage==='completed'){stopGps();if(!state.demo) readEarnings();}
    render();show(statuses[stage]+'.');return;
  }
  if(action==='older'){await loadHistory(true);render();return;}
  if(action==='review'){state.review=id;render();return;}
  if(action==='document'){await download(key);return;}
  if(action==='activation'){
    const driver=state.drivers.find(item=>item.id===id);
    if(!driver) return;
    const active=!driver.active;
    if(!window.confirm(active?'Reactivate this driver account?':'Suspend this driver account?')) return;
    if(!state.demo) await api.run('setDriverActivation',{uid:id,active});
    driver.active=active;render();show(active?'Driver reactivated.':'Driver suspended.');return;
  }
  if(action==='cancel'){
    if(!window.confirm('Cancel this booking?')) return;
    if(!state.demo) await api.run('updateTrip',{tripId:id,status:'cancelled'});
    state.requested=state.requested.filter(job=>job.id!==id);state.active=state.active.filter(job=>job.id!==id);render();show('Booking cancelled.');
  }
}
async function submitted(form,submitter){
  const fields=new FormData(form);
  switch(form.dataset.form){
    case 'auth': {
      const email=fields.get('email').trim(), password=fields.get('password');
      if(state.newAccount){
        const result=await api.authSdk.createUserWithEmailAndPassword(api.auth,email,password);
        await api.authSdk.sendEmailVerification(result.user);
      }else await api.authSdk.signInWithEmailAndPassword(api.auth,email,password);
      return;
    }
    case 'application': await submitApplication(form);return;
    case 'decision': {
      const app=state.applications.find(item=>item.id===state.review), decision=submitter?.value;
      if(!app || !decision) return;
      const selected=Object.fromEntries(Object.keys(checks).map(key=>[key,fields.has(key)]));
      const note=fields.get('note').trim();
      if(decision==='approved'&&!Object.values(selected).every(Boolean)) throw Error('Confirm all six verification checks.');
      if(decision==='needs_changes'&&!note) throw Error('Enter the changes the applicant needs to make.');
      if(!window.confirm(decision==='approved'?'Approve and activate this driver account?':'Return this application for changes?')) return;
      if(!state.demo) await api.run('reviewDriverApplication',{uid:app.id,batch:app.batch,decision,note,checks:selected});
      state.applications=state.applications.filter(item=>item.id!==app.id);state.review=null;
      render();show(decision==='approved'?'Driver approved and activated.':'Changes requested.');return;
    }
    case 'dispatch': {
      const id=form.dataset.id, uid=fields.get('uid');
      if(!state.demo) await api.run('updateTrip',{tripId:id,status:'assigned',driverId:uid});
      else {
        const trip=state.requested.find(item=>item.id===id);
        const driver=state.drivers.find(item=>item.id===uid);
        if(trip&&driver) state.active.unshift({...trip,status:'assigned',driver:{name:driver.name}});
      }
      state.requested=state.requested.filter(job=>job.id!==id);render();show('Driver assigned.');return;
    }
    case 'payment': {
      const amount=fields.get('amount').trim();
      if(!/^\d{1,5}(\.\d{1,2})?$/.test(amount)||Number(amount)<=0) throw Error('Enter a positive CAD amount with up to two decimal places.');
      const [dollars,decimal='']=amount.split('.');
      const entry={uid:fields.get('uid').trim(),type:fields.get('type'),tripId:fields.get('tripId').trim()||null,amountCents:Number(dollars)*100+Number(decimal.padEnd(2,'0'))};
      if(!entry.tripId && entry.type!=='bonus') throw Error('Enter the completed booking ID.');
      const signature=JSON.stringify(entry);
      if(paymentAttempt?.signature!==signature) paymentAttempt={signature,id:crypto.randomUUID()};
      if(state.demo) state.ledger.unshift({...entry,day:dateInput()});
      else await api.run('recordDriverPayment',{...entry,entryId:paymentAttempt.id});
      paymentAttempt=null;
      await loadLedger(entry.uid);render();show('Earnings entry recorded.');return;
    }
    case 'ledger': await loadLedger(fields.get('uid').trim());render();return;
  }
}
async function handle(operation,control){
  if(locked) return;
  locked=true;
  if(control) control.disabled=true;
  show('');
  try{await operation();}
  catch(error){show(error.message||'Unable to complete that action.',true);}
  finally{locked=false;if(control?.isConnected) control.disabled=false;}
}
root.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action],button[data-page]');
  if(button) handle(()=>clicked(button),button);
});
root.addEventListener('submit',event=>{
  event.preventDefault();
  handle(()=>submitted(event.target,event.submitter),event.submitter);
});
addEventListener('pagehide',()=>stopGps());
setup();

import {firebaseConfig} from './config.js';
const admin=location.pathname.startsWith('/payments-admin');
const preview=!firebaseConfig;
const root=document.getElementById('finance');
const params=new URLSearchParams(location.search);
const groupNames={transportation:'Transportation',food:'Food delivery',grocery:'Grocery delivery',parcel:'Parcel delivery'};
const fareZones={'springbrook':'Springbrook','penhold':'Penhold','gasoline-alley':'Gasoline Alley',
  'red-deer-north':'North Red Deer','red-deer-south':'South Red Deer','innisfail':'Innisfail',
  'blackfalds':'Blackfalds','lacombe':'Lacombe','yyc':'Calgary International Airport','yeg':'Edmonton International Airport','other':'Other verified area'};
const zoneSelect=(label,name,value)=>`<label>${label}<select name="${name}"><option value="">Use saved postal-code zone</option>${Object.entries(fareZones).map(([key,text])=>`<option value="${key}" ${value===key?'selected':''}>${text}</option>`).join('')}</select></label>`;
const metricNames={gross:'Gross collected',commissions:'Commissions',taxes:'Taxes',tips:'Tips',driver:'Driver payouts paid',merchant:'Merchant payouts paid'};
const methodNames={
 stripe:['Credit cards & digital wallets','Visa, Mastercard, Apple Pay and Google Pay on eligible devices'],
 paypal:['PayPal','Continue to PayPal to approve your CAD payment'],
 etransfer:['Interac e-Transfer','Send using the instructions provided by ED’S'],
 invoice:['Business account billing','ED’S confirms billing eligibility and reconciles the invoice'],
 cash:['Cash','Pay in cash for your ride or delivery'],
 interac:['Interac Debit','Pay using an enabled in-person terminal'],
 samsung:['Samsung Pay','Tap at an enabled, compatible in-person terminal']
};
const fmt=new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'});
const dollars=value=>fmt.format((value||0)/100);
const decimal=value=>((value||0)/100).toFixed(2);
const e=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const btn=(label,attr='',kind='blue')=>`<button class="btn ${kind}" ${attr}>${label}</button>`;
const field=(label,name,value='',attr='')=>`<label>${label}<input name="${name}" value="${e(value)}" ${attr}></label>`;
const check=(label,name,value=false)=>`<label><input type="checkbox" name="${name}" ${value?'checked':''}> ${label}</label>`;
const panel=(title,body)=>`<section class="ops-panel"><h2>${title}</h2>${body}</section>`;
const tag=value=>`<span class="tag">${e(value)}</span>`;
const messages={quoted:'Ready for payment',checkout:'Checkout started',awaiting_collection:'Awaiting confirmation',paid:'Paid',refunding:'Refund pending',refunded:'Refunded',available:'Available for payout',processing:'Processing',payout_failed:'Reconciliation required',void:'Void'};
const basePay={fare:{routeBaseCents:3000,redDeerPickupCents:200,regionalSurchargeCents:0},id:'trip_ED-1048',kind:'trip',ref:'ED-1048',group:'transportation',status:'quoted',fulfillment:'ride',baseCents:3200,taxCents:160,tipCents:0,totalCents:3360,methods:Object.keys(methodNames),
 paymentNotes:{etransfer:'Sample e-Transfer instructions. No funds will be moved.',cash:'Pay your driver in cash. This is a sample booking.'}};
const state={ready:preview,owner:false,user:null,locked:false,kind:params.get('kind')==='order'?'order':'trip',ref:params.get('ref')||'',payment:null,settings:null,records:[],allocations:[],totals:{},tab:'overview',notice:'',bad:false};
let api,stops=[];
const label=admin?'Payments Admin':'Pay ED’S';
function heading(){
 return `<header class="finance-head"><a href="/" aria-label="ED’s home"><img src="/eds-logo.webp" alt="ED’S Transport &amp; Delivery"></a><nav aria-label="Payments navigation">
  <a href="${admin?'/admin/':'/book/'}">${admin?'Dispatch':'Request a Ride'}</a>
  ${admin?'<a href="/pay/">Customer Checkout</a>':'<a href="/marketplace/">Marketplace</a>'}
  ${state.user?btn('Sign Out','data-action="logout"','outline'):''}</nav></header>`;
}
function summary(p){
 return `<div class="finance-summary">${[...(p.fare?[
   ['Route base fare',p.fare.routeBaseCents],
   ...(p.fare.redDeerPickupCents?[['Red Deer pickup fee',p.fare.redDeerPickupCents]]:[]),
   ...(p.fare.regionalSurchargeCents?[['Regional ride surcharge',p.fare.regionalSurchargeCents]]:[])
 ]:[['Fare or order',p.baseCents]]),[p.kind==='trip'&&p.taxCents===Math.round(p.baseCents/20)?'GST (5%)':'Tax',p.taxCents],['Tip',p.tipCents],['Total CAD',p.totalCents]].map(([name,value])=>`<div class="finance-row"><span>${name}</span><span>${dollars(value)}</span></div>`).join('')}</div>`;
}
function checkout(){
 const p=state.payment;
 const intro=`<div class="finance-intro"><div class="eyebrow">ED’S Transport &amp; Delivery</div><h1>Pay for your ride or order</h1><p>Enter a booking or order reference to view the amount and choose how to pay.</p></div>`;
 const find=panel('Find your payment',`<form class="ops-form ops-stack" data-form="find"><label>Reference type<select name="kind"><option value="trip" ${state.kind==='trip'?'selected':''}>Ride or delivery booking</option><option value="order" ${state.kind==='order'?'selected':''}>Marketplace order</option></select></label>
   ${field('Booking or order reference','ref',state.ref,'maxlength="128" required')}${btn('Find payment','type="submit"')}</form>`);
 if(!p) return intro+find;
 const choices=p.status==='quoted'?panel('Payment method', p.methods.length?`<form class="ops-form ops-stack" data-form="start">
   <div class="finance-methods">${p.methods.map((key,index)=>`<label class="finance-method"><input name="method" type="radio" value="${e(key)}" ${index===0?'checked':''}><span><b>${e(key==='cash'&&(p.fulfillment==='ride')?'Cash Ride Payment':key==='cash'?'Cash on Delivery':methodNames[key][0])}</b><small>${e(methodNames[key][1])}</small></span></label>`).join('')}</div>
   ${field('Optional tip (CAD)','tip','0.00','inputmode="decimal" required')}${btn(preview?'Simulate payment':'Continue to payment','type="submit"','engage')}</form>`:'<p class="muted">No payment methods are available. Contact ED’S.</p>'):'';
 const next=p.status==='checkout'?btn('Resume checkout','data-action="resume"','engage')+btn('Refresh status','data-action="refresh"','outline'):
   p.status==='awaiting_collection'?'<p>'+e(p.paymentNotes?.[p.method]||'ED’S will confirm the payment after verifying receipt.')+'</p>'+(p.invoice?'<p>Invoice '+e(p.invoice.number)+' · Due '+e(p.invoice.dueDate)+'</p>':'')+btn('Refresh status','data-action="refresh"','outline'):'';
 return intro+`<div class="finance-columns">${find}${panel('Amount due',`<p class="finance-reference">${e(p.ref)} · ${tag(messages[p.status]||p.status)}</p>${summary(p)}<div class="actions">${next}</div>`)}</div>${choices}`;
}
function signIn(){
 const link='/account/?next='+encodeURIComponent('/pay/'+location.search);
 return `<div class="finance-intro"><div class="eyebrow">ED’S</div><h1>${label}</h1><p>Sign in to view payment information.</p></div>${admin?panel('Staff sign-in',`<form data-form="signin" class="ops-form ops-stack compact">${field('Email','email','','type="email" required autocomplete="email"')}${field('Password','password','','type="password" required autocomplete="current-password"')}${btn('Sign In','type="submit"')}</form>`):`<a class="btn blue" href="${e(link)}">Sign In</a>`}`;
}
function recent(){
 return state.records.length?state.records.map(p=>`<article class="ops-job"><strong>${e(p.id)}</strong> ${tag(messages[p.status]||p.status)}<p>${dollars(p.totalCents)} · ${e(groupNames[p.group]||p.group)}${p.reviewRequired?' · Review required':''}</p>
  ${btn('Manage','data-action="manage" data-id="'+e(p.id)+'"','outline')}</article>`).join(''):'<p class="muted">No payments to display.</p>';
}
function overview(){
 return `<div class="finance-grid">${Object.entries(metricNames).map(([key,title])=>`<div class="finance-metric"><span>${title}</span><strong>${dollars(state.totals[key])}</strong></div>`).join('')}</div>
 <div class="finance-columns">${panel('Recent payments',recent())}${panel('Quote a ride or delivery',`<form class="ops-form ops-stack" data-form="quote">${field('Booking reference','ref',state.routeRef||'','required maxlength="128"')}
 ${btn('Look up route','type="button" data-action="inspect-ride"','outline')}
 ${state.routeInfo?`<p class="finance-reference">Pickup: ${e(state.routeInfo.pickup)} ${e(state.routeInfo.pickupPostal||'')}<br>Destination: ${e(state.routeInfo.destination)} ${e(state.routeInfo.destinationPostal||'')}
   ${state.routeInfo.fare?.routeBaseCents!=null?`<br>${state.routeInfo.fare.minimum?'Starting base':'Fixed base'}: ${dollars(state.routeInfo.fare.routeBaseCents)} · Surcharges: ${dollars(state.routeInfo.fare.redDeerPickupCents+state.routeInfo.fare.regionalSurchargeCents)}`:''}</p>`:''}
 ${zoneSelect('Verified pickup zone','fromZone',state.routeInfo?.from)}${zoneSelect('Verified destination zone','toZone',state.routeInfo?.to)}
 ${field('Manual base fare before fees and tax (CAD)','base','','inputmode="decimal"')}
 <p class="muted">Checkout adds 5% GST to the fare and required fees.</p>
 <p class="muted">Fixed flyer fares use the confirmed route. For a starting-price or unlisted route, enter the base before surcharges.</p>${btn('Save quote','type="submit"')}</form>`)}</div>`;
}
function settings(){
 const cfg=state.settings||{methods:[],commissions:{},paymentNotes:{}};
 return panel('Commission & payment methods',`<form class="ops-form ops-stack" data-form="settings"><fieldset><legend>Commission rates</legend>${Object.entries(groupNames).map(([key,label])=>field(label+' (%)',key,decimal(cfg.commissions?.[key]),'required type="number" min="0" max="100" step="0.01"')).join('')}</fieldset>
 <fieldset><legend>Enabled methods</legend>${Object.entries(methodNames).map(([key,[label]])=>check(e(label),key,cfg.methods?.includes(key))).join('')}</fieldset>
 ${['etransfer','invoice','cash','interac','samsung'].map(key=>field(methodNames[key][0]+' instructions','note_'+key,cfg.paymentNotes?.[key],'maxlength="400"')).join('')}
 ${btn('Save settings','type="submit"')}</form>`);
}
function rideFares(){
 const cfg=state.fareConfig||{};
 const mappings=Object.entries(cfg.postalZones||{}).map(([postal,zone])=>postal+' | '+zone).join('\n');
 return panel('Postal-code ride pricing',`<form class="ops-form ops-stack" data-form="ride-fares">
 <label>Verified full postal codes<textarea name="postalZones" rows="8" placeholder="Full postal code | zone">${e(mappings)}</textarea></label>
 <p class="muted">Enter one postal code per line. Use these zone names: ${e(Object.keys(fareZones).join(', '))}.</p>
 <p class="muted">The server applies 5% Alberta GST. Unmapped addresses, airport estimates and “from” fares need staff confirmation.</p>
 ${btn('Save ride pricing','type="submit"')}</form>`);
}
function manage(){
 return `<div class="finance-columns">
 ${panel('Manage payment',`<form class="ops-form ops-stack" data-form="manage">
 ${field('Payment ID','id',state.selected,'required maxlength="128"')}
 <label>Action<select name="action"><option value="offline">Confirm offline funds received by ED’S</option><option value="invoice">Record a business invoice</option><option value="risk">Clear fraud review</option><option value="refund">Refund full payment or refresh refund</option><option value="release">Release completed-job earnings</option></select></label>
 ${field('Verified reference, review note or refund reason','note','','maxlength="250"')}
 ${field('Invoice due date (for business billing)','dueDate','','type="date"')}
 ${check('Offline funds have been collected and remitted to ED’S','treasury')}
 ${btn('Apply action','type="submit"')}</form>`)}
 ${panel('Recent payments',recent())}</div>`;
}
function payout(){
 const entries=state.allocations.length?state.allocations.map(p=>`<article class="ops-job"><strong>${e(p.role==='driver'?'Driver':'Merchant')} · ${dollars(p.amountCents)}</strong> ${tag(messages[p.status]||p.status)}<p>${e(p.id)}</p>
 ${btn('Use payout ID','data-action="select-payout" data-id="'+e(p.id)+'"','outline')}</article>`).join(''):'<p class="muted">No allocations to display.</p>';
 return `<div class="finance-columns">${panel('Recipient account',`<form class="ops-form ops-stack" data-form="recipient"><label>Recipient type<select name="role"><option value="driver">Driver</option><option value="merchant">Merchant</option></select></label>
 ${field('ED’S account ID','uid','','required maxlength="128"')}${field('Stripe connected account ID','account','','required placeholder="acct_…"')}${check('Eligible for weekly standard payouts','weekly')}${btn('Link account','type="submit"')}</form>`)}
 ${panel('Send or reconcile a payout',`<form class="ops-form ops-stack" data-form="payout">${field('Allocation ID','id',state.payoutId,'required maxlength="128"')}
 <label>Speed<select name="method"><option value="standard">Standard</option><option value="instant">Instant if eligible</option></select></label>${btn('Send or check payout','type="submit"')}</form>`)}</div>${panel('Recent allocations',entries)}`;
}
function staff(){
 if(!state.owner&&!preview) return panel('Access restricted','<p>A Payments Admin account is required.</p>');
 const pages={overview:'Overview',settings:'Commissions',rideFares:'Ride Pricing',manage:'Refunds & reconciliation',payout:'Payouts'};
 return `<div class="finance-intro"><div class="eyebrow">ED’S Transport &amp; Delivery</div><h1>Payments Admin</h1><p>Review collected payments, fees, taxes, and amounts owed to drivers and merchants.</p></div>
 <div class="actions">${Object.entries(pages).map(([key,title])=>btn(title,'data-tab="'+key+'" aria-current="'+(key===state.tab?'page':'false')+'"',key===state.tab?'blue':'outline')).join('')}</div><div class="ops-section">${{overview,settings,rideFares,manage,payout}[state.tab]()}</div>`;
}
function render(){
 const body=!state.ready?'<p role="status">Loading…</p>':!state.user&&!preview?signIn():admin?staff():checkout();
 root.innerHTML=heading()+`<main id="main" class="finance-wrap">${preview?'<div class="ops-banner"><strong>Demo payments</strong><span>Sample data. No money is collected or transferred.</span></div>':''}<p class="ops-message ${state.bad?'':'good'}" id="finance-notice" role="status">${e(state.notice)}</p>${body}</main>`;
}
function note(message='',bad=false){
 state.notice=message;state.bad=bad;
 const el=document.getElementById('finance-notice');
 if(el){el.textContent=message;el.classList.toggle('good',!bad);}
}
const amount=(value,max=1000000)=>{
 if(!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim())) throw Error('Enter an amount with up to two decimal places.');
 const [dollars,cents='']=value.trim().split('.');
 const total=Number(dollars)*100+Number(cents.padEnd(2,'0'));
 if(total>max) throw Error('This amount exceeds the allowed maximum.');
 return total;
};
async function readPayment(){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(state.ref)) throw Error('Enter a valid booking or order reference.');
 if(preview){state.payment={...basePay,kind:state.kind,fulfillment:state.kind==='trip'?'ride':'delivery',ref:state.ref,id:state.kind+'_'+state.ref};return;}
 state.payment=await api.call('getEdPayment',{kind:state.kind,ref:state.ref});
}
const loadTotals=async()=>{
 if(preview) return;
 state.totals=await api.call('edPaymentTotals',{});
 if(!state.locked&&!document.activeElement?.closest('form')) render();
};
async function refreshPayment(){
 if(preview) return;
 await readPayment();
 if(params.get('return')==='paypal'&&params.get('token')&&state.payment.method==='paypal'&&state.payment.status==='checkout'){
   await api.call('captureEdPayPal',{id:state.payment.id,token:params.get('token')});
   await readPayment();
 }
}
function recentWatch(collection,field){
 const {db,store}=api;
 const query=db.query(db.collection(store,collection),db.orderBy('updatedAt','desc'),db.limit(30));
 stops.push(db.onSnapshot(query,snapshot=>{
   state[field]=snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));
   if(!state.locked&&!document.activeElement?.closest('form')) render();
 },error=>note(error.message,true)));
}
async function initialize(){
 if(preview){
   state.payment={...basePay,kind:state.kind,fulfillment:state.kind==='trip'?'ride':'delivery',ref:state.ref||basePay.ref};
   state.ref=state.payment.ref;
   state.settings={methods:Object.keys(methodNames),commissions:{transportation:1000,food:1200,grocery:900,parcel:1000},paymentNotes:basePay.paymentNotes};
   state.totals={gross:184750,commissions:18780,taxes:8525,tips:10300,driver:76400,merchant:41250};
   state.records=[{...basePay,status:'paid'},{...basePay,id:'order_ED-M105',kind:'order',group:'food',totalCents:2450,status:'paid'}];
   state.allocations=[{id:'trip_ED-1048_driver',role:'driver',status:'available',amountCents:2880}];
   render();return;
 }
 try{
   const cdn='https://www.gstatic.com/firebasejs/11.10.0/firebase-';
   const [appSdk,authSdk,db,fn]=await Promise.all(['app','auth','firestore','functions'].map(name=>import(cdn+name+'.js')));
   const app=appSdk.initializeApp(firebaseConfig),auth=authSdk.getAuth(app),store=db.getFirestore(app);
   const functions=fn.getFunctions(app,'northamerica-northeast1');
   api={auth,authSdk,db,store,call:async(name,data)=>(await fn.httpsCallable(functions,name)(data)).data};
   authSdk.onAuthStateChanged(auth,async user=>{
     stops.forEach(stop=>stop());stops=[];
     Object.assign(state,{user,owner:false,ready:true,payment:null,records:[],allocations:[],totals:{},settings:null,fareConfig:null,routeInfo:null,routeRef:null,selected:null,payoutId:null,notice:''});
     render();
     if(!user)return;
     try{
       if(admin){
         const {claims}=await authSdk.getIdTokenResult(user,true);
         if(auth.currentUser?.uid!==user.uid)return;
         state.owner=claims.paymentAdmin===true;
         if(!state.owner){render();return;}
         const [settings,fares]=await Promise.all([db.getDoc(db.doc(store,'paymentSettings','default')),db.getDoc(db.doc(store,'paymentSettings','rideFares'))]);
         if(auth.currentUser?.uid!==user.uid)return;
         state.settings=settings.data();state.fareConfig=fares.data();
         recentWatch('payments','records');recentWatch('paymentAllocations','allocations');
         await loadTotals();
       }else if(state.ref) await refreshPayment();
       if(auth.currentUser?.uid===user.uid) render();
     }catch(error){if(auth.currentUser?.uid===user.uid)note(error.message,true);}
   });
 }catch{state.ready=true;render();note('Payments could not connect to Firebase.',true);}
}
async function start(method,tip){
 const p=state.payment;
 if(preview){
   p.tipCents=tip;p.totalCents=p.baseCents+p.taxCents+tip;p.method=method;
   p.status=['stripe','paypal'].includes(method)?'paid':'awaiting_collection';
   render();note('Demo payment updated. No funds moved.');return;
 }
 const result=await api.call('beginEdPayment',{id:p.id,method,tipCents:tip});
 if(result.url){location.assign(result.url);return;}
 await refreshPayment();render();
}
async function submit(form){
 const fields=new FormData(form);
 switch(form.dataset.form){
   case 'signin':await api.authSdk.signInWithEmailAndPassword(api.auth,fields.get('email').trim(),fields.get('password'));return;
   case 'find':state.kind=fields.get('kind');state.ref=fields.get('ref').trim();state.payment=null;await readPayment();render();return;
   case 'start':await start(fields.get('method'),amount(fields.get('tip'),50000));return;
   case 'settings':{
     const data={commissions:Object.fromEntries(Object.keys(groupNames).map(key=>[key,amount(fields.get(key),10000)])),
       methods:Object.keys(methodNames).filter(key=>fields.has(key)),
       paymentNotes:Object.fromEntries(['etransfer','invoice','cash','interac','samsung'].map(key=>[key,fields.get('note_'+key)]))};
     if(!preview) await api.call('setEdPaymentSettings',data);
     state.settings=data;render();note('Payment settings saved.');return;
   }
   case 'ride-fares':{
     const postalZones=fields.get('postalZones').split(/\r?\n/).filter(line=>line.trim()).map(line=>{
       const [postal,zone,...extra]=line.split('|').map(value=>value.trim());
       if(!postal||!zone||extra.length||!fareZones[zone]) throw Error('Use full postal code | zone on each line.');
       return {postal,zone};
     });
     const data={postalZones};
     if(!preview) await api.call('setEdRideFares',data);
     state.fareConfig={...data,postalZones:Object.fromEntries(postalZones.map(({postal,zone})=>[postal,zone]))};
     render();note('Ride pricing saved.');return;
   }
   case 'quote':{
     const data={ref:fields.get('ref').trim(),fromZone:fields.get('fromZone'),toZone:fields.get('toZone'),
       baseCents:fields.get('base').trim()?amount(fields.get('base')):null};
     if(!preview) await api.call('quoteEdFare',data);
     else{
       const baseCents=data.baseCents??basePay.baseCents,taxCents=Math.round(baseCents/20);
       state.records.unshift({...basePay,...data,id:'trip_'+data.ref,baseCents,taxCents,totalCents:baseCents+taxCents});
     }
     state.routeRef=null;state.routeInfo=null;render();note('Fare quote saved.');return;
   }
   case 'manage':{
     const id=fields.get('id').trim(), action=fields.get('action'), text=fields.get('note').trim();
     if(action==='offline'&&(!fields.has('treasury')||!text)) throw Error('Confirm ED’S received the funds and enter a receipt reference.');
     if(action==='invoice'&&(!text||!fields.get('dueDate'))) throw Error('Enter the verified invoice number and due date.');
     if(['risk','refund'].includes(action)&&!text) throw Error('Enter a review note or refund reason.');
     if(action==='refund'&&!confirm('Confirm a full refund or check an existing refund?'))return;
     const names={offline:'confirmEdOffline',invoice:'issueEdBusinessInvoice',risk:'clearEdRiskReview',refund:'refundEdPayment',release:'createEdAllocations'};
     const result=preview?null:await api.call(names[action],{id,reference:text,treasury:fields.has('treasury'),note:text,reason:text,number:text,dueDate:fields.get('dueDate')});
     if(preview){
       const sample=state.records.find(record=>record.id===id);
       if(sample&&action==='refund')sample.status='refunded';
       if(sample&&action==='offline')sample.status='paid';
     }
     if(!preview&&action!=='release')await loadTotals();
     render();note(result?.status?'Payment status: '+(messages[result.status]||result.status)+'.':preview?'Demo action recorded.':'Action completed.');return;
   }
   case 'recipient':{
     const data={role:fields.get('role'),uid:fields.get('uid').trim(),account:fields.get('account').trim(),weekly:fields.has('weekly')};
     if(!/^acct_[A-Za-z0-9]{6,}$/.test(data.account)) throw Error('Enter a Stripe connected account ID.');
     if(!preview)await api.call('linkEdPayoutAccount',data);
     render();note(preview?'Sample account linked.':'Recipient account linked.');return;
   }
   case 'payout':{
     if(!confirm('Send the selected payout or check its current provider status?'))return;
     const id=fields.get('id').trim(),method=fields.get('method');
     if(!preview){
       const result=await api.call('sendEdPayout',{id,method});
       await loadTotals();render();note('Payout: '+(messages[result.status]||result.status)+'.');
     }else{const sample=state.allocations.find(item=>item.id===id);if(sample)sample.status='paid';render();note('Demo payout updated. No funds moved.');}
     return;
   }
 }
}
async function click(button){
 const {action,tab,id}=button.dataset;
 if(tab){state.tab=tab;if(tab==='overview'&&!preview)await loadTotals();render();return;}
 if(action==='logout'){await api.authSdk.signOut(api.auth);return;}
 if(action==='inspect-ride'){
   const form=button.closest('form'),ref=form.elements.ref.value.trim();
   if(!ref) throw Error('Enter the booking reference.');
   state.routeInfo=preview?{pickup:'Sample address, North Red Deer',destination:'Sample address, South Red Deer',from:'red-deer-north',to:'red-deer-south'}:
     await api.call('inspectEdRideRoute',{ref});
   state.routeRef=ref;render();return;
 }
 if(action==='manage'){state.selected=id;state.tab='manage';render();return;}
 if(action==='select-payout'){state.payoutId=id;render();return;}
 if(action==='resume'){await start(state.payment.method,state.payment.tipCents);return;}
 if(action==='refresh'){if(!preview)await refreshPayment();render();}
}
async function handle(run,control){
 if(state.locked)return;
 state.locked=true;
 if(control)control.disabled=true;
 note('');
 try{await run();}
 catch(error){note(error.message||'Unable to complete the payment action.',true);}
 finally{state.locked=false;if(control?.isConnected)control.disabled=false;}
}
root.addEventListener('click',event=>{const b=event.target.closest('[data-action],[data-tab]');if(b)handle(()=>click(b),b);});
root.addEventListener('submit',event=>{event.preventDefault();handle(()=>submit(event.target),event.submitter);});
initialize();

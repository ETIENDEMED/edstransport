import {firebaseConfig} from './config.js';
const role=location.pathname.startsWith('/merchant-admin')?'admin':location.pathname.startsWith('/merchant')?'merchant':'customer';
const root=document.getElementById('market');
const demo=!firebaseConfig;
if(role!=='customer') document.title=(role==='merchant'?'Merchant Portal':'Merchant Review')+' | ED’S Transport & Delivery';
const categories=['Restaurants','Coffee Shops','Grocery Stores','Pharmacies','Convenience Stores','Local Businesses'];
const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const checkLabels={license:'Business licence',gst:'GST number',banking:'Banking documentation',contact:'Contact information',hours:'Operating hours',menu:'Menu upload'};
const docLabels={license:'Business licence',banking:'Banking document',menu:'Menu upload'};
const stageNames={pending:'Order received',accepted:'Accepted',preparing:'Preparing',ready:'Ready',rejected:'Declined',completed:'Completed',
  requested:'Finding a driver',assigned:'Driver assigned',en_route:'Driver heading to store',in_progress:'Out for delivery',cancelled:'Delivery cancelled'};
const e=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const cash=cents=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format((cents||0)/100);
const price=cents=>Number.isInteger(cents)?(cents/100).toFixed(2):'';
const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',dateStyle:'medium',timeStyle:'short'});
const date=value=>value?fmt.format(value.toDate?.()??new Date(value)):'';
const btn=(label,attr='',style='blue')=>`<button class="btn ${style}" ${attr}>${label}</button>`;
const field=(label,key,value='',attr='')=>`<label>${label}<input name="${key}" value="${e(value)}" ${attr}></label>`;
const textArea=(label,key,value='',max=450)=>`<label>${label}<textarea name="${key}" maxlength="${max}" rows="3">${e(value)}</textarea></label>`;
const check=(label,key,value=false)=>`<label class="inline-check"><input type="checkbox" name="${key}" ${value?'checked':''}> ${label}</label>`;
const tag=value=>`<span class="tag">${e(value)}</span>`;
const panel=(name,body)=>`<section class="market-panel"><h2>${name}</h2>${body}</section>`;
const empty=label=>`<p class="market-empty">${e(label)}</p>`;
const list=(rows,renderer,blank)=>rows.length?rows.map(renderer).join(''):empty(blank);
const normalize=value=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const state={user:null,authReady:demo,screen:role==='admin'?'review':role==='merchant'?'orders':'browse',stores:[],items:[],orders:[],favorites:new Set(),cart:[],
  filter:'',term:'',store:null,app:null,notice:'',bad:false,mode:'delivery',recent:null};
let api, subscriptions=[], viewSubscriptions=[], locked=false, loadedStoreSeq=0, querySeq=0, trackStop, submitBatch, checkoutAttempt, editingItem, selectedReview;
let storeCursor=null,itemCursor=null,orderCursor=null,menuCursor=null;
const demoHours=Object.fromEntries(days.map(day=>[day,{open:'08:00',close:'22:00'}]));
const defaults={hours:demoHours,acceptingOrders:true,delivery:true,pickup:true,scheduled:true,deliveryFeeCents:499,discountPercent:0,promotion:'',ratingCount:0,ratingSum:0};
const samples=[
  ['prairie','Prairie Burger Co.','Restaurants','Red Deer','Smash burgers, hand-cut fries and house sauces.','market-burger.webp',10],
  ['junction','Junction Coffee House','Coffee Shops','Penhold','Coffee, pastries and easy breakfast favourites.','market-coffee.webp',0],
  ['river','Riverbend Market','Grocery Stores','Red Deer','Fresh produce, bakery staples and local pantry picks.','market-grocery.webp',0],
  ['park','Parkside Pharmacy','Pharmacies','Springbrook','Everyday wellness and personal care essentials.','',0],
  ['crossing','Crossing Corner Store','Convenience Stores','Gasoline Alley','Snacks, drinks and the extras you forgot.','',0],
  ['workshop','The Alberta Workshop','Local Businesses','Innisfail','Small-batch gifts from local makers.','',0]
].map(([id,name,category,city,description,photo,discountPercent],index)=>({...defaults,id,name,category,city,description,photo,
  address:city+', Alberta',discountPercent,promotion:discountPercent?'10% off menu items':'',ratingCount:12+index,ratingSum:57+index*4}));
const products=[
 ['prairie','Double Smash Burger','Burgers','Two griddled patties, cheddar and house sauce.',1495,'market-burger.webp','Adds fries and a fountain drink', [['Extra cheese',125],['Fries and drink combo',550]]],
 ['prairie','Classic Fries','Sides','Sea salt and house seasoning.',525,'market-burger.webp','', [['Garlic aioli',130]]],
 ['junction','Flat White','Coffee','Double shot with silky steamed milk.',525,'market-coffee.webp','', [['Oat milk',95],['Extra espresso shot',125]]],
 ['junction','Butter Croissant','Bakery','Flaky, golden and baked fresh.',450,'market-coffee.webp','', []],
 ['river','Market Produce Box','Produce','Seasonal vegetables and berries.',2495,'market-grocery.webp','', [['Sourdough loaf',700]]],
 ['river','Sourdough Loaf','Bakery','Slow-fermented bakery sourdough.',700,'market-grocery.webp','', []],
 ['park','Travel Hand Cream','Personal care','Unscented hand cream, 50 mL.',699,'','',[]],
 ['crossing','Movie Night Snacks','Pantry','Popcorn, chips and a sweet treat.',1195,'','',[]],
 ['workshop','Alberta Postcard Set','Gifts','Five illustrated Central Alberta postcards.',995,'','',[]]
].map(([storeId,name,section,description,priceCents,photo,combo,options],index)=>{
  const store=samples.find(s=>s.id===storeId);
  return {id:'sample-'+index,storeId,storeName:store.name,storeCity:store.city,category:store.category,name,section,description,priceCents,photo,combo,stock:24,published:true,taxable:storeId!=='river',addons:options.map(([name,priceCents],i)=>({id:String(i+1),name,priceCents}))};
});
const displayPhoto=item=>{
  if(item.photoPreview) return item.photoPreview;
  if(item.photo) return '/'+item.photo;
  if(!item.photoPath||!firebaseConfig?.storageBucket) return '';
  return 'https://firebasestorage.googleapis.com/v0/b/'+encodeURIComponent(firebaseConfig.storageBucket)+'/o/'+encodeURIComponent(item.photoPath)+'?alt=media';
};
const picture=(item)=>displayPhoto(item)?`<img src="${e(displayPhoto(item))}" alt="" loading="lazy">`:'<div class="cover" aria-hidden="true"></div>';
const tab=(name,label)=>`<button type="button" data-view="${name}" ${state.screen===name?'aria-current="page"':''}>${label}</button>`;
function head(){
  const count=state.cart.reduce((sum,line)=>sum+line.quantity,0);
  const authButton=demo?'':state.user?btn('Sign out','data-action="logout"','outline'):btn('Sign in','data-view="auth"','outline');
  const links=role==='customer'?'<a href="/merchant/">For merchants</a>':role==='merchant'?'<a href="/marketplace/">Marketplace</a><a href="/merchant-admin/">Admin review</a>':'<a href="/merchant/">Merchant Portal</a>';
  return `<header class="market-top"><a href="/" aria-label="ED’s home"><img src="/eds-logo.webp" alt="ED’S Transport &amp; Delivery"></a><nav aria-label="Marketplace">${links}
   ${role==='customer'?`${btn('Orders','data-view="history"','outline')}${btn('Cart'+(count?' · '+count:''),'data-view="cart"')}`:''}${authButton}</nav></header>`;
}
const demoBanner=()=>demo?'<div class="market-banner"><strong>Demo marketplace.</strong> Sample data only. Use fictional details.</div>':'';
function render(){
  let content;
  if(!state.authReady) content='<p role="status">Loading account…</p>';
  else if(state.screen==='auth') content=login();
  else if(role==='customer') content=customer();
  else if(role==='merchant') content=merchant();
  else content=admin();
  root.innerHTML=head()+`<main id="main" class="market-wrap">${demoBanner()}<p id="market-notice" class="market-status ${state.bad?'error':''}" role="status">${e(state.notice)}</p>${content}</main>`;
}
function notify(message='',bad=false){
  state.notice=message;state.bad=bad;
  const output=document.getElementById('market-notice');
  if(output){output.textContent=message;output.classList.toggle('error',bad);}
}
function refresh(){if(!locked&&!document.activeElement?.closest('form')) render();}
function login(){
  const include=role!=='admin';
  return `<div class="hold"><h1 class="market-title">${state.register?'Create account':'Sign in'}</h1>
    ${panel(role==='merchant'?'Merchant account':role==='admin'?'Merchant administrator':'Customer account',`<form class="ops-form ops-stack" data-form="auth">
     ${field('Email','email','','type="email" autocomplete="email" required')}${field('Password','password','',state.register?'type="password" minlength="8" autocomplete="new-password" required':'type="password" autocomplete="current-password" required')}
     ${btn(state.register?'Create account':'Sign in','type="submit"')}</form>
     <div class="actions">${include?btn(state.register?'Use an existing account':'Create account','data-action="register"','outline'):''}${btn('Send password reset','data-action="reset"','outline')}${role==='customer'?btn('Continue with Google','data-action="google"','outline'):''}</div>`)}</div>`;
}
function shopCard(store){
  const rating=store.ratingCount?(store.ratingSum/store.ratingCount).toFixed(1):'New';
  return `<article class="market-card">${picture(store)}<div class="card-body"><p>${e(store.category)} · ${e(store.city)}</p><h3>${e(store.name)}</h3><p>${e(store.description)}</p>
    ${tag(rating==='New'?'New store':'★ '+rating)} ${store.promotion?tag(store.promotion):''}<div class="actions">
    ${btn('View menu',`data-action="store" data-id="${e(store.id)}"`)}${btn(state.favorites.has(store.id)?'Saved':'Save',`data-action="favorite" data-id="${e(store.id)}" aria-label="${state.favorites.has(store.id)?'Remove':'Save'} ${e(store.name)} ${state.favorites.has(store.id)?'from favourites':'to favourites'}"`,'outline')}
  </div></div></article>`;
}
function foodCard(item){
  return `<article class="market-card">${picture(item)}<div class="card-body"><p>${e(item.section)}${state.screen==='browse'?' · '+e(item.storeName):''}</p><h3>${e(item.name)}</h3><p>${e(item.description)}</p>
    ${item.combo?`<p><strong>Combo</strong> ${e(item.combo)}</p>`:''}<strong>${cash(item.priceCents)}</strong>
    ${item.stock>0?`<form class="ops-form actions" data-form="add" data-id="${e(item.id)}">
      ${item.addons.map(addon=>check(e(addon.name)+' + '+cash(addon.priceCents),'addon_'+addon.id)).join('')}
      ${btn('Add to cart','type="submit"','gold')}</form>`:`<p>${tag('Sold out')}</p>`}</div></article>`;
}
function browse(){
  return `<div class="market-hero"><div><div class="eyebrow">Central Alberta</div><h1>Shop local.<br><span>We’ll deliver.</span></h1>
    <p>Discover restaurants, coffee shops and independent businesses in your community.</p>
    <form class="market-search" data-form="search"><input aria-label="Search restaurants or food" name="term" value="${e(state.term)}" maxlength="60" placeholder="Search a restaurant or dish">${btn('Search','type="submit"','gold')}</form>
  </div></div><div class="market-filters" aria-label="Business categories">${['',...categories].map(category=>`<button type="button" data-action="filter" data-id="${e(category)}" aria-pressed="${state.filter===category}">${e(category||'All businesses')}</button>`).join('')}
  ${btn('Favourites','data-view="favorites"','outline')}</div>
  <h2 class="market-section-title">${state.term?'Matching businesses':'Explore nearby businesses'}</h2><div class="market-grid">${list(state.stores,shopCard,'No matching businesses.')}</div>
  ${storeCursor?btn('More businesses','data-action="more-stores"','outline'):''}
  ${state.term?`<h2 class="market-section-title">Matching menu items</h2><div class="market-grid">${list(state.items,foodCard,'No matching menu items.')}</div>${itemCursor?btn('More menu items','data-action="more-items"','outline'):''}`:''}`;
}
function storePage(){
  if(!state.store) return empty('Store unavailable.');
  const store=state.store;
  const hours=days.filter(day=>store.hours?.[day]).map(day=>day+' '+store.hours[day].open+'–'+store.hours[day].close).join(' · ');
  return `${btn('Back to marketplace','data-view="browse"','outline')}<h1 class="market-title">${e(store.name)}</h1><p class="market-muted">${e(store.category)} · ${e(store.city)}</p>
  <p>${e(store.description)}</p><p>${e(store.address)}</p><p>${e(hours)} Alberta time</p>
  <p>${store.delivery?'Delivery '+cash(store.deliveryFeeCents):''}${store.pickup?(store.delivery?' · ':'')+'Pickup':''}${store.scheduled?' · Scheduled orders':''}</p>
  ${store.promotion?tag(store.promotion):''}${!store.acceptingOrders?tag('Orders paused'):''}
  <div class="market-grid">${list(state.items,foodCard,'This store has no published items yet.')}</div>${menuCursor?btn('More menu items','data-action="more-menu"','outline'):''}`;
}
function totals(store,mode){
  const subtotal=state.cart.reduce((sum,line)=>sum+line.quantity*line.unit,0);
  const taxable=state.cart.filter(line=>line.taxable).reduce((sum,line)=>sum+line.quantity*line.unit,0);
  const percent=store?.discountPercent||0, discount=Math.round(subtotal*percent/100);
  const fee=mode==='delivery'?(store?.deliveryFeeCents||0):0;
  const tax=Math.round((taxable-Math.round(taxable*percent/100)+fee)*.05);
  return {subtotal,discount,fee,tax,total:subtotal-discount+fee+tax};
}
function breakdown(value){
  return [['Subtotal',value.subtotal],['Discount',-value.discount],['Delivery fee',value.fee],['GST',value.tax],['Total',value.total]].map(([k,v])=>
    `<div class="market-meter ${k==='Total'?'total':''}"><span>${k}</span><strong>${cash(v)}</strong></div>`).join('');
}
function cart(){
  const store=state.cartStore;
  if(!store||!state.cart.length) return `<h1 class="market-title">Your cart</h1>${empty('Your cart is empty.')}${btn('Browse businesses','data-view="browse"','outline')}`;
  const draft=state.checkoutDraft||{};
  return `<h1 class="market-title">Your cart</h1><p class="market-muted">${e(store.name)}</p><div class="market-columns">
  ${panel('Your items',list(state.cart,(line)=>`<article class="market-row"><h3>${e(line.name)}</h3>
  <p>${e(line.addonNames.join(', '))}</p><p>${line.quantity} × ${cash(line.unit)}</p><div class="actions">${btn('−',`data-action="qty" data-id="${e(line.key)}" data-step="-1" aria-label="Decrease ${e(line.name)} quantity"`,'outline')}
  ${btn('+',`data-action="qty" data-id="${e(line.key)}" data-step="1" aria-label="Increase ${e(line.name)} quantity"`,'outline')}</div></article>`,'Your cart is empty.'))}
  ${panel('Checkout',`<form class="ops-form ops-stack" data-form="order">
    <label>Fulfillment<select name="mode">${['delivery','pickup'].filter(mode=>store[mode]).map(mode=>`<option value="${mode}" ${state.mode===mode?'selected':''}>${mode==='delivery'?'Delivery':'Pickup'}</option>`).join('')}</select></label>
    ${state.mode==='delivery'?field('Delivery address','destination',draft.destination,'required maxlength="250"'):''}
    ${store.scheduled?field('Schedule order (Alberta time, optional)','when',draft.when,'type="datetime-local"'):''}
    ${textArea('Special instructions','instructions',draft.instructions)}
    <div>${breakdown(totals(store,state.mode))}</div>
    <p class="market-muted">${demo?'Demo checkout. No payment will be taken.':'Choose your payment method after submitting the order.'}</p>
    ${btn(demo?'Place demo order':'Place order','type="submit"','gold')}</form>`)}
  </div>`;
}
const statusFor=order=>order.mode==='delivery'&&order.status==='ready'?(order.deliveryStatus||'requested'):order.status;
function orderRow(order,merchantSide=false){
  const status=statusFor(order), trackable=order.tripId&&['assigned','en_route','in_progress'].includes(status);
  const steps={pending:[['accepted','Accept order'],['rejected','Decline']],accepted:[['preparing','Start preparing'],['rejected','Decline']],
    preparing:[['ready','Mark ready'],['rejected','Decline']],ready:order.mode==='pickup'?[['completed','Mark picked up']]:[]};
  const actions=merchantSide?(steps[order.status]||[]).map(([next,label])=>btn(label,`data-action="advance" data-id="${e(order.id)}" data-stage="${next}"`,next==='rejected'?'outline':'blue')).join(''):'';
  return `<article class="market-row"><h3>${e(order.storeName)} · ${cash(order.totalCents)}</h3>
    <p>${tag(stageNames[status]||status)} ${tag(order.mode==='pickup'?'Pickup':'Delivery')} ${order.paymentStatus?tag('Payment: '+order.paymentStatus.replace(/_/g,' ')):''}</p>
    <p>${order.scheduledAt?'Scheduled '+e(date(order.scheduledAt))+' Alberta time':e(date(order.createdAt))}</p>
    <p>${e(order.lines?.map(line=>line.quantity+' × '+line.name+(line.addons?.length?' ('+line.addons.map(a=>a.name).join(', ')+')':'')).join(' · '))}</p>
    <p>${order.mode==='delivery'?'Delivery address: '+e(order.destination):'Pickup address: '+e(order.pickupAddress)}</p>
    ${order.instructions?`<p><strong>Instructions</strong> ${e(order.instructions)}</p>`:''}
    <p class="market-muted">Order ${e(order.id)}</p><div class="actions">${actions}
    ${trackable?btn('Track driver',`data-action="track" data-id="${e(order.tripId)}"`,'outline'):''}${!merchantSide&&!['rejected','cancelled'].includes(status)?`<a class="btn outline" href="/pay/?kind=order&amp;ref=${encodeURIComponent(order.id)}">${order.paymentStatus==='paid'?'View payment':'Payment options'}</a>`:''}
    ${!merchantSide&&demo&&status!=='completed'&&status!=='rejected'?btn('Advance demo order',`data-action="demo-progress" data-id="${e(order.id)}"`,'outline'):''}</div>
    ${state.trackId===order.tripId&&trackable?`<p data-position>Waiting for driver coordinates…</p>`:''}
    ${!merchantSide&&status==='completed'?(order.rating?`<p>Your rating: ${e(order.rating)}/5</p>`:`<form class="ops-form actions" data-form="rate" data-id="${e(order.id)}"><label>Rating<select name="rating">${[5,4,3,2,1].map(n=>`<option value="${n}">${n}/5</option>`).join('')}</select></label>${field('Review (optional)','text','','maxlength="600"')}${btn('Submit rating','type="submit"','outline')}</form>`):''}
  </article>`;
}
function customer(){
  switch(state.screen){
    case 'store': return storePage();
    case 'cart': return cart();
    case 'favorites': return `${btn('Browse businesses','data-view="browse"','outline')}<h1 class="market-title">Favourite businesses</h1><div class="market-grid">${list(state.saved||[],shopCard,'Save a business to find it here.')}</div>${state.favoriteCursor?btn('More favourites','data-action="more-favorites"','outline'):''}`;
    case 'history': return `${btn('Browse businesses','data-view="browse"','outline')}<h1 class="market-title">Your orders</h1>${panel('Order history',list(state.orders,row=>orderRow(row),'Your orders will appear here.')+(orderCursor?btn('Older orders','data-action="older-orders"','outline'):''))}`;
    default:return browse();
  }
}
function hoursEditor(hours){
  return `<fieldset><legend>Operating hours in Alberta</legend><p class="market-muted">Leave both times empty for days you’re closed.</p>${days.map(day=>`<div class="hours"><strong>${day}</strong>${field('Opens',day+'_open',hours?.[day]?.open,'type="time"')}${field('Closes',day+'_close',hours?.[day]?.close,'type="time"')}</div>`).join('')}</fieldset>`;
}
function businessFields(store={}, lockedCategory=false){
  return `${field('Business name','name',store.name,'required maxlength="100"')}
    <div class="ops-form-cols"><label>Category<select name="category" ${lockedCategory?'disabled':''}>${categories.map(item=>`<option ${store.category===item?'selected':''}>${item}</option>`).join('')}</select>${lockedCategory?`<input type="hidden" name="category" value="${e(store.category)}">`:''}</label>
    ${field('Town or city','city',store.city,'required maxlength="75"')}</div>
    ${field('Business and pickup address','address',store.address,'required maxlength="250"')}${textArea('Store description','description',store.description)}`;
}
function photoInput(current){
  return `${displayPhoto(current)?`<img class="photo-preview" src="${e(displayPhoto(current))}" alt="Current photo">`:''}
    <label>Upload a photo <input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>`;
}
function application(){
  const current=state.app||{};
  return `<div class="hold"><div class="eyebrow">Partner with ED’S</div><h1 class="market-title">Merchant application</h1>
  ${current.status==='needs_changes'?`<p class="market-banner">Changes requested. ${e(current.note)}</p>`:''}
  ${panel('Business information',`<form class="ops-form ops-stack" data-form="application">
    ${businessFields(current)}
    <div class="ops-form-cols">${field('Contact person','contactName',current.contactName,'required maxlength="100"')}${field('Business phone','phone',current.phone,'type="tel" required maxlength="35"')}</div>
    ${field('GST number','gst',current.gst,'required maxlength="25" placeholder="123456789RT0001"')}
    ${hoursEditor(current.hours||demoHours)}
    <fieldset><legend>Private documents</legend>
      ${demo?Object.values(docLabels).map(label=>`<div class="market-meter"><span>${e(label)}</span>${tag('Sample document')}</div>`).join(''):Object.entries(docLabels).map(([key,label])=>`<label>${label}<input type="file" name="${key}" required accept="image/jpeg,image/png,image/webp,application/pdf"></label>`).join('')}
      <p class="market-muted">PDF or image, up to 10 MB per file. For banking, use a void cheque or direct deposit form. Keep online banking credentials private.</p></fieldset>
    ${btn('Submit for admin review','type="submit"')}</form>`)}
  ${demo?`<div class="market-nav">${tab('orders','Back to merchant demo')}</div>`:''}</div>`;
}
function settings(){
  const store=state.store;
  return panel('Storefront and fulfillment',`<form class="ops-form ops-stack" data-form="settings">
  ${businessFields(store,true)}${photoInput(store)}${hoursEditor(store.hours)}
  <fieldset><legend>Order options</legend>${check('Accept orders','acceptingOrders',store.acceptingOrders)}
    ${check('Allow delivery','delivery',store.delivery)}${check('Allow pickup','pickup',store.pickup)}${check('Allow scheduled orders','scheduled',store.scheduled)}
    ${field('Delivery fee (CAD)','fee',price(store.deliveryFeeCents),'inputmode="decimal" required')}</fieldset>
  <fieldset><legend>Promotion</legend>${field('Promotion label','promotion',store.promotion,'maxlength="120"')}${field('Automatic menu discount (%)','discount',store.discountPercent,'type="number" min="0" max="90" step="1" required')}</fieldset>
  ${btn('Save settings','type="submit"')}</form>`);
}
function itemEditor(item={}){
  const addonLines=(item.addons||[]).map(addon=>addon.name+' | '+price(addon.priceCents)).join('\n');
  return panel(item.id?'Edit menu item':'Add menu item',`<form class="ops-form ops-stack" data-form="item">
   ${field('Item name','name',item.name,'required maxlength="110"')}${field('Menu section','section',item.section,'required maxlength="60"')}
   ${textArea('Description','description',item.description,400)}${field('Combo contents (optional)','combo',item.combo,'maxlength="300"')}
   ${textArea('Add-ons (one per line, name | CAD price)','addons',addonLines,800)}${photoInput(item)}
   <div class="ops-form-cols">${field('Price (CAD)','price',price(item.priceCents),'required inputmode="decimal"')}${field('Available units','stock',item.stock??0,'required type="number" min="0" max="100000" step="1"')}</div>
   ${check('Apply 5% GST to this item and its add-ons','taxable',item.taxable!==false)}
   ${check('Show this item on the menu','published',item.published!==false)}${btn('Save menu item','type="submit"')}
   ${item.id?btn('Start a new item','type="button" data-action="new-item"','outline'):''}</form>`);
}
function merchant(){
  if(!demo&&!state.user) return login();
  if(!demo&&!state.user.emailVerified) return `<div class="hold"><h1 class="market-title">Verify your email</h1><p>Open your verification email to continue the application.</p><div class="market-nav">${btn('I verified my email','data-action="verify-reload"')}${btn('Resend verification','data-action="verify-send"','outline')}</div></div>`;
  if(state.screen==='apply'||(!demo&&!state.store&&state.app?.status!=='pending'&&!state.failed)) return application();
  if(!demo&&state.failed) return empty('Your account could not be loaded. Reload the page to retry.');
  if(!demo&&!state.store) return `<div class="hold"><h1 class="market-title">Application under review</h1><p>The business can publish a menu and accept orders after admin approval.</p></div>`;
  const nav=`<div class="market-nav" aria-label="Merchant tools">${tab('orders','Orders')}${tab('menu','Menu & inventory')}${tab('settings','Store settings')}${demo?tab('apply','Try merchant signup'):''}</div>`;
  let body;
  if(state.screen==='menu'){
    const current=state.items.find(item=>item.id===editingItem);
    body=`<div class="market-columns">${panel('Menu items',list(state.items,item=>`<article class="market-row"><h3>${e(item.name)}</h3><p>${e(item.section)} · ${cash(item.priceCents)}</p><p>${item.stock} units · ${item.published?'Published':'Hidden'}</p>
      ${btn('Edit item',`data-action="edit" data-id="${e(item.id)}"`,'outline')}</article>`,'Add your first menu item.')+(itemCursor?btn('More items','data-action="more-merchant-items"','outline'):''))}${itemEditor(current)}</div>`;
  }else if(state.screen==='settings') body=settings();
  else body=panel('Orders',list(state.orders,order=>orderRow(order,true),'New orders will appear here.')+(orderCursor?btn('Older orders','data-action="older-orders"','outline'):''));
  return `<div class="eyebrow">Merchant Portal</div><h1 class="market-title">${e(state.store.name)}</h1>${state.store.acceptingOrders?tag('Accepting orders'):tag('Orders paused')}${nav}${body}`;
}
function admin(){
  if(!demo&&!state.user) return login();
  if(!demo&&!state.admin) return `<h1 class="market-title">Merchant admin access required</h1>`;
  const application=state.applications.find(item=>item.id===selectedReview);
  const queue=panel('Pending businesses',list(state.applications,item=>`<article class="market-row"><h3>${e(item.name)}</h3><p>${e(item.category)} · ${e(item.city)}</p>
    ${btn('Review application',`data-action="review" data-id="${e(item.id)}"`,'outline')}</article>`,'There are no applications awaiting review.'));
  const detail=application?panel(e(application.name),`<p>${e(application.address)}</p><p>${e(application.contactName)} · ${e(application.email)} · ${e(application.phone)}</p>
    <p>GST account ${e(application.gst)}</p><p>${e(days.filter(day=>application.hours?.[day]).map(day=>day+' '+application.hours[day].open+'–'+application.hours[day].close).join(' · '))}</p>
    <div class="actions">${Object.entries(docLabels).map(([key,label])=>btn(label,`type="button" data-action="document" data-id="${key}"`,'outline')).join('')}</div>
    <form class="ops-form ops-stack ops-section" data-form="review"><fieldset><legend>Verification</legend>${Object.entries(checkLabels).map(([key,label])=>check(label,key)).join('')}</fieldset>
    ${textArea('Notes for requested changes','note','',600)}<div class="actions">${btn('Approve business','type="submit" value="approved"')}${btn('Request changes','type="submit" value="needs_changes"','outline')}</div></form>`):panel('Application details',empty('Select a pending business to review.'));
  return `<div class="eyebrow">Merchant Admin</div><h1 class="market-title">Business applications</h1><div class="market-columns">${queue}${detail}</div>`;
}
const rows=snap=>snap.docs.map(doc=>({id:doc.id,...doc.data()}));
const read=async(coll,key)=>{const snap=await api.db.getDoc(api.db.doc(api.store,coll,key));return snap.exists()?{id:snap.id,...snap.data()}:null;};
const watch=(reference,apply,target=subscriptions)=>target.push(api.db.onSnapshot(reference,snapshot=>{
  if(apply(snapshot)!==false) refresh();
},error=>notify(error.message||'Data could not load.',true)));
const col=name=>api.db.collection(api.store,name);
const stopAll=target=>{target.forEach(unsubscribe=>unsubscribe());target.length=0;};
const pageQuery=(name,constraints,cursor,count=24)=>api.db.query(col(name),...constraints,...(cursor?[api.db.startAfter(cursor)]:[]),api.db.limit(count));
const nextCursor=(snapshot,count=24)=>snapshot.size===count?snapshot.docs.at(-1):null;
const merge=(previous,current)=>{const map=new Map(previous.map(item=>[item.id,item]));current.forEach(item=>map.set(item.id,item));return [...map.values()];};
async function loadBrowse(more=''){
  const seq=++querySeq;
  const term=normalize(state.term).trim();
  if(demo){
    const contains=(...fields)=>!term||normalize(fields.join(' ')).includes(term);
    state.stores=samples.filter(item=>(!state.filter||state.filter===item.category)&&contains(item.name,item.description,item.city));
    state.items=term?products.filter(item=>item.published&&(!state.filter||state.filter===item.category)&&contains(item.name,item.description,item.combo)):[];
    return;
  }
  const {db}=api;
  const prefix=(term.match(/[a-z0-9]{2,}/)||[])[0]?.slice(0,32);
  const common=[db.where('published','==',true),...(state.filter?[db.where('category','==',state.filter)]:[])];
  const storeConstraints=[...common,...(prefix?[db.where('searchTokens','array-contains',prefix)]:[db.orderBy('name')])];
  const itemConstraints=[...common,...(prefix?[db.where('searchTokens','array-contains',prefix)]:[])];
  const [stores,items]=await Promise.all([
    more==='items'?null:db.getDocs(pageQuery('marketStores',storeConstraints,more?storeCursor:null)),
    !prefix||more==='stores'?null:db.getDocs(pageQuery('marketItems',itemConstraints,more?itemCursor:null))
  ]);
  if(seq!==querySeq) return;
  if(stores){state.stores=more?merge(state.stores,rows(stores)):rows(stores);storeCursor=nextCursor(stores);}
  if(items){
    const matches=rows(items);
    const owners=new Map(await Promise.all([...new Set(matches.map(item=>item.storeId))].map(async id=>[id,await read('marketStores',id)])));
    if(seq!==querySeq) return;
    const current=matches.filter(item=>owners.has(item.storeId)&&owners.get(item.storeId)?.published).map(item=>{
      const store=owners.get(item.storeId);return {...item,storeName:store.name,storeCity:store.city};
    });
    state.items=more?merge(state.items,current):current;itemCursor=nextCursor(items);
  }
  else if(!more){state.items=[];itemCursor=null;}
}
async function openStore(key,more=false){
  const seq=++loadedStoreSeq;
  if(demo){state.store=samples.find(item=>item.id===key);state.items=products.filter(item=>item.storeId===key&&item.published);return;}
  const {db}=api;
  const [store,menu]=await Promise.all([
    more?state.store:read('marketStores',key),
    db.getDocs(pageQuery('marketItems',[db.where('published','==',true),db.where('storeId','==',key),db.orderBy('section'),db.orderBy('name')],more?menuCursor:null))
  ]);
  if(seq!==loadedStoreSeq) return;
  state.store=store;state.items=more?merge(state.items,rows(menu)):rows(menu);menuCursor=nextCursor(menu);
}
async function favoritePage(more=false){
  if(demo){state.saved=samples.filter(store=>state.favorites.has(store.id));return;}
  const {db,store}=api;
  const ref=db.collection(store,'marketCustomers',state.user.uid,'favorites');
  const snap=await db.getDocs(db.query(ref,db.orderBy('createdAt','desc'),...(more&&state.favoriteCursor?[db.startAfter(state.favoriteCursor)]:[]),db.limit(24)));
  const saved=(await Promise.all(snap.docs.map(doc=>read('marketStores',doc.id)))).filter(Boolean);
  saved.forEach(item=>state.favorites.add(item.id));
  state.saved=more?merge(state.saved||[],saved):saved;
  state.favoriteCursor=nextCursor(snap);
}
function orderConstraints(){
  const {db}=api;
  return [db.where(role==='merchant'?'storeId':'customerId','==',state.user.uid),db.orderBy('createdAt','desc')];
}
function listenOrders(){
  watch(pageQuery('marketOrders',orderConstraints(),null),snapshot=>{
    const older=state.olderOrders||[];
    state.orders=merge(rows(snapshot),older.filter(order=>!snapshot.docs.some(doc=>doc.id===order.id)));
    if(!older.length) orderCursor=nextCursor(snapshot);
    return state.screen==='orders'||state.screen==='history';
  },viewSubscriptions);
}
async function olderOrders(){
  const snapshot=await api.db.getDocs(pageQuery('marketOrders',orderConstraints(),orderCursor));
  state.olderOrders=merge(state.olderOrders||[],rows(snapshot));state.orders=merge(state.orders,rows(snapshot));orderCursor=nextCursor(snapshot);
}
async function merchantItems(more=false){
  const {db}=api;
  const snap=await db.getDocs(pageQuery('marketItems',[db.where('storeId','==',state.user.uid),db.orderBy('updatedAt','desc')],more?itemCursor:null));
  state.items=more?merge(state.items,rows(snap)):rows(snap);itemCursor=nextCursor(snap);
}
function stopTracking(){
  if(trackStop) trackStop();
  trackStop=null;state.trackId=null;
}
async function session(user){
  stopAll(subscriptions);stopAll(viewSubscriptions);stopTracking();
  const different=state.user?.uid!==user?.uid;
  if(state.user&&different){
    state.cart=[];state.cartStore=null;state.checkoutDraft=null;state.returnTo=null;
    submitBatch=null;checkoutAttempt=null;editingItem=null;selectedReview=null;
  }
  if(different) Object.assign(state,{orders:[],olderOrders:[],favorites:new Set(),saved:[],app:null,admin:false,failed:false});
  state.user=user;state.authReady=true;
  if(role==='customer'){
    if(!user){if(state.screen==='history'||state.screen==='favorites') state.screen='browse';render();return;}
    if(state.screen==='auth') state.screen=state.returnTo||'browse';
    listenOrders();
    await favoritePage().catch(error=>notify(error.message,true));
    render();return;
  }
  if(!user){state.screen='auth';render();return;}
  state.screen=role==='admin'?'review':'orders';
  if(role==='admin'){
    state.admin=(await api.authSdk.getIdTokenResult(user,true)).claims.merchantAdmin===true;
    if(state.admin) watch(pageQuery('merchantApplications',[api.db.where('status','==','pending'),api.db.orderBy('submittedAt')],null),snapshot=>{
      state.applications=rows(snapshot);
    });
  }else{
    state.store=await read('marketStores',user.uid);
    if(state.store) listenOrders();
    watch(api.db.doc(api.store,'merchantApplications',user.uid),snapshot=>{
      const prior=state.app?.status;state.app=snapshot.data();
      if(!state.store&&prior!=='approved'&&state.app?.status==='approved'){
        read('marketStores',user.uid).then(store=>{state.store=store;if(store) listenOrders();refresh();}).catch(error=>notify(error.message,true));
      }
      return prior!==state.app?.status;
    });
  }
  render();
}
async function setup(){
  if(demo){
    if(role==='customer') await loadBrowse();
    if(role==='merchant'){
      state.store=structuredClone(samples[0]);
      state.items=structuredClone(products.filter(item=>item.storeId===state.store.id));
      state.orders=[{id:'ED-M105',storeName:state.store.name,mode:'delivery',destination:'Sample address, Red Deer',status:'pending',createdAt:Date.now(),totalCents:2234,
        lines:[{quantity:1,name:'Double Smash Burger',addons:[{name:'Extra cheese'}]}]}];
    }
    if(role==='admin') state.applications=[{...samples[2],id:'merchant-sample',batch:'sample',contactName:'Casey Sample',email:'sample@example.test',phone:'555-0101',gst:'123456789RT0001'}];
    render();return;
  }
  try{
    const base='https://www.gstatic.com/firebasejs/11.10.0/';
    const [appSdk,authSdk,db,storageSdk,fn]=await Promise.all(['app','auth','firestore','storage','functions'].map(label=>import(base+'firebase-'+label+'.js')));
    const app=appSdk.initializeApp(firebaseConfig), auth=authSdk.getAuth(app), store=db.getFirestore(app), storage=storageSdk.getStorage(app);
    const functions=fn.getFunctions(app,'northamerica-northeast1');
    api={authSdk,auth,db,store,storageSdk,storage,call:async(name,data)=>(await fn.httpsCallable(functions,name)(data)).data};
    authSdk.onAuthStateChanged(auth,user=>session(user).catch(error=>{
      state.failed=true;state.authReady=true;render();notify(error.message,true);
    }));
    if(role==='customer'){await loadBrowse();refresh();}
  }catch(error){state.authReady=true;state.failed=true;render();notify('Firebase could not connect. Check the portal configuration.',true);}
}
function moneyInput(value,allowZero=false){
  if(!/^\d{1,4}(\.\d{1,2})?$/.test(value.trim())) throw Error('Enter a valid Canadian dollar amount.');
  const [dollars,cents='']=value.trim().split('.');
  const amount=Number(dollars)*100+Number(cents.padEnd(2,'0'));
  if(!allowZero&&amount===0) throw Error('Price must be greater than zero.');
  return amount;
}
function localDate(value){
  if(!value) return null;
  const tz=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const utc=Date.parse(value+'Z');
  const candidate=[-6,-7].map(offset=>new Date(utc-offset*3600000)).find(instant=>{
    const p=Object.fromEntries(tz.formatToParts(instant).map(part=>[part.type,part.value]));
    return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute===value;
  });
  if(!candidate) throw Error('Choose a valid Alberta date and time.');
  return candidate.getTime();
}
function hoursData(fields){
  const hours={};
  for(const day of days){
    const open=fields.get(day+'_open'),close=fields.get(day+'_close');
    if(!open&&!close) continue;
    if(!open||!close||open>=close) throw Error('Enter opening and closing times for '+day+'.');
    hours[day]={open,close};
  }
  if(!Object.keys(hours).length) throw Error('Enter at least one day of operating hours.');
  return hours;
}
function businessData(fields){
  return {...Object.fromEntries(['name','category','city','address','description'].map(key=>[key,fields.get(key)])),hours:hoursData(fields)};
}
async function upload(path,file,photo=false){
  const allowed=['image/jpeg','image/png','image/webp',...(photo?[]:['application/pdf'])];
  if(!file?.size||file.size>(photo?5242880:10485760)||!allowed.includes(file.type)) throw Error('Check the file type and size.');
  const {storageSdk,storage}=api;
  const reference=storageSdk.ref(storage,path);
  await storageSdk.uploadBytes(reference,file,{contentType:file.type});
  return path;
}
async function photoPath(file,existing){
  if(!file?.size) return existing||'';
  if(demo){if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880) throw Error('Upload a JPG, PNG or WebP photo under 5 MB.');return existing||'';}
  return upload('merchant-photo-staging/'+state.user.uid+'/'+crypto.randomUUID(),file,true);
}
function requireCustomer(view){
  if(demo||state.user) return true;
  state.returnTo=view;state.screen='auth';render();return false;
}
function checkoutFields(form){
  const fields=new FormData(form);
  state.checkoutDraft={destination:fields.get('destination')||state.checkoutDraft?.destination||'',when:fields.get('when')||'',instructions:fields.get('instructions')||''};
  return fields;
}
async function addCart(item,fields){
  if(!item?.stock) throw Error('This item is sold out.');
  if(state.cartStore&&state.cartStore.id!==item.storeId) throw Error('Finish or empty your cart before shopping with another business.');
  if(!state.cartStore){
    state.cartStore=demo?samples.find(store=>store.id===item.storeId):await read('marketStores',item.storeId);
    if(!state.cartStore?.acceptingOrders){state.cartStore=null;throw Error('This store is not accepting orders right now.');}
    state.mode=state.cartStore.delivery?'delivery':'pickup';
  }
  const addons=item.addons.filter(addon=>fields.has('addon_'+addon.id)), key=item.id+'_'+addons.map(addon=>addon.id).join('');
  if(state.cart.filter(line=>line.itemId===item.id).reduce((sum,line)=>sum+line.quantity,0)>=item.stock) throw Error('No more inventory is available.');
  const existing=state.cart.find(line=>line.key===key);
  if(existing){
    if(existing.quantity>=25) throw Error('Use up to 25 units per order line.');
    existing.quantity++;
  }else{
    if(state.cart.length>=20) throw Error('Use up to 20 order lines per cart.');
    state.cart.push({key,itemId:item.id,name:item.name,addons:addons.map(addon=>addon.id),addonNames:addons.map(addon=>addon.name),quantity:1,
      unit:item.priceCents+addons.reduce((sum,addon)=>sum+addon.priceCents,0),taxable:item.taxable,stock:item.stock});
  }
  render();notify(item.name+' added to your cart.');
}
async function placeOrder(form){
  const fields=checkoutFields(form);
  if(!requireCustomer('cart')) return;
  const store=state.cartStore, mode=fields.get('mode');
  const schedule=localDate(state.checkoutDraft.when);
  if(schedule&&(schedule<Date.now()+15*60000||schedule>Date.now()+14*86400000)) throw Error('Schedule between 15 minutes and 14 days from now.');
  const amount=totals(store,mode).total;
  const data={storeId:store.id,mode,destination:state.checkoutDraft.destination.trim(),instructions:state.checkoutDraft.instructions.trim(),
    scheduledAt:schedule,expectedTotal:amount,lines:state.cart.map(({itemId,quantity,addons})=>({itemId,quantity,addons}))};
  const fingerprint=JSON.stringify(data);
  if(checkoutAttempt?.fingerprint!==fingerprint) checkoutAttempt={fingerprint,id:crypto.randomUUID()};
  if(demo){
    state.orders.unshift({id:checkoutAttempt.id,storeName:store.name,pickupAddress:store.address,createdAt:Date.now(),status:'pending',mode,
      scheduledAt:schedule,totalCents:amount,destination:data.destination,instructions:data.instructions,
      lines:state.cart.map(line=>({name:line.name,quantity:line.quantity,addons:line.addonNames.map(name=>({name}))}))});
  }else{
    try{await api.call('createMarketOrder',{...data,orderId:checkoutAttempt.id});}
    catch(error){
      if(error.code==='functions/failed-precondition'){
        const [fresh,...items]=await Promise.all([read('marketStores',store.id),...state.cart.map(line=>read('marketItems',line.itemId).catch(()=>null))]);
        if(fresh) state.cartStore=fresh;
        if(!state.cartStore[state.mode]) state.mode=state.cartStore.pickup?'pickup':'delivery';
        state.cart=state.cart.flatMap((line,index)=>{
          const item=items[index];
          const addons=item?.addons.filter(addon=>line.addons.includes(addon.id));
          if(!item?.published||item.stock<line.quantity||addons.length!==line.addons.length) return [];
          return [{...line,name:item.name,unit:item.priceCents+addons.reduce((sum,addon)=>sum+addon.priceCents,0),
            addonNames:addons.map(addon=>addon.name),taxable:item.taxable,stock:item.stock}];
        });
        if(!state.cart.length) state.cartStore=null;
        render();
        throw Error(error.message+' Review the refreshed cart before ordering.');
      }
      throw error;
    }
  }
  state.cart=[];state.cartStore=null;state.checkoutDraft=null;checkoutAttempt=null;state.screen='history';
  render();notify('Order placed. Follow its status here.');
}
async function applyMerchant(fields){
  const details={...businessData(fields),...Object.fromEntries(['contactName','phone','gst'].map(key=>[key,fields.get(key)]))};
  if(demo){state.screen='orders';render();notify('Sample application submitted for review. Live businesses require admin approval.');return;}
  const files=Object.fromEntries(Object.keys(docLabels).map(kind=>[kind,fields.get(kind)]));
  const signature=Object.values(files).map(file=>[file.name,file.lastModified,file.size].join(':')).join('|');
  if(submitBatch?.signature!==signature) submitBatch={signature,id:crypto.randomUUID(),uploaded:new Set()};
  for(const [kind,file] of Object.entries(files)){
    if(submitBatch.uploaded.has(kind)) continue;
    const path='merchant-documents/'+state.user.uid+'/'+submitBatch.id+'/'+kind;
    notify('Uploading '+docLabels[kind].toLowerCase()+'…');
    try{await upload(path,file);}catch(error){
      if(error.code!=='storage/unauthorized') throw error;
      const metadata=await api.storageSdk.getMetadata(api.storageSdk.ref(api.storage,path));
      if(metadata.size!==file.size||metadata.contentType!==file.type) throw error;
    }
    submitBatch.uploaded.add(kind);
  }
  await api.call('submitMerchant',{...details,batch:submitBatch.id});
  state.app={status:'pending'};state.screen='orders';submitBatch=null;render();notify('Application submitted for review.');
}
async function saveItem(fields){
  const old=state.items.find(item=>item.id===editingItem);
  const addons=fields.get('addons').split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{
    const parts=line.split('|').map(value=>value.trim());
    if(parts.length!==2||!parts[0]) throw Error('Format each add-on as name | CAD price.');
    return {name:parts[0],priceCents:moneyInput(parts[1],true)};
  });
  if(addons.length>8) throw Error('Use up to eight add-ons.');
  const id=old?.id||crypto.randomUUID();
  const data={id,name:fields.get('name'),section:fields.get('section'),description:fields.get('description'),combo:fields.get('combo'),
    addons,priceCents:moneyInput(fields.get('price')),stock:Number(fields.get('stock')),taxable:fields.has('taxable'),published:fields.has('published'),
    stockRevision:old?.stockRevision??0,photoPath:await photoPath(fields.get('photo'),old?.photoPath)};
  if(demo){
    const photo=fields.get('photo');
    if(photo?.size&&old?.photoPreview) URL.revokeObjectURL(old.photoPreview);
    state.items=merge(state.items,[{...old,...data,...(photo?.size?{photoPreview:URL.createObjectURL(photo)}:{}),storeId:state.store.id,addons:addons.map((addon,i)=>({...addon,id:String(i+1)}))}]);
  }else{
    try{await api.call('saveMarketItem',data);}
    catch(error){if(error.code==='functions/aborted'){await merchantItems();render();}throw error;}
    await merchantItems();
  }
  editingItem=id;render();notify('Menu item saved.');
}
async function saveSettings(fields){
  const data={...businessData(fields),...Object.fromEntries(['delivery','pickup','scheduled','acceptingOrders'].map(key=>[key,fields.has(key)])),
    deliveryFeeCents:moneyInput(fields.get('fee'),true),discountPercent:Number(fields.get('discount')),promotion:fields.get('promotion'),
    photoPath:await photoPath(fields.get('photo'),state.store.photoPath)};
  if(!data.delivery&&!data.pickup) throw Error('Enable pickup, delivery, or both.');
  if(!demo){await api.call('saveMarketStore',data);state.store=await read('marketStores',state.user.uid);delete data.photoPath;}
  const photo=fields.get('photo');
  if(demo&&photo?.size){if(state.store.photoPreview) URL.revokeObjectURL(state.store.photoPreview);data.photoPreview=URL.createObjectURL(photo);}
  state.store={...state.store,...data};render();notify('Store settings saved.');
}
async function favor(key){
  if(!requireCustomer('favorites')) return;
  if(demo){
    if(state.favorites.has(key))state.favorites.delete(key);else state.favorites.add(key);
  }else{
    const {db,store}=api;
    const ref=db.doc(store,'marketCustomers',state.user.uid,'favorites',key);
    const existing=await db.getDoc(ref);
    if(existing.exists){await db.deleteDoc(ref);state.favorites.delete(key);}
    else{await db.setDoc(ref,{createdAt:db.serverTimestamp()});state.favorites.add(key);}
  }
  if(state.screen==='favorites') await favoritePage();
  render();notify(state.favorites.has(key)?'Saved to favourites.':'Removed from favourites.');
}
async function view(name){
  if(role==='customer'){
    if(['favorites','history'].includes(name)&&!requireCustomer(name)) return;
    stopTracking();state.screen=name;
    if(name==='browse') await loadBrowse();
    if(name==='favorites') await favoritePage();
  }else{
    if(role==='merchant'&&name==='menu'&&!demo&&state.store) await merchantItems();
    state.screen=name;
  }
  render();
}
async function track(id){
  if(state.trackId===id){stopTracking();render();return;}
  stopTracking();state.trackId=id;render();
  const update=(latitude,longitude,updatedAt)=>{
    if(state.trackId!==id) return;
    const output=root.querySelector('[data-position]');
    if(!output) return;
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)){output.textContent='Waiting for driver coordinates…';return;}
    const link=document.createElement('a');
    link.className='market-link';link.target='_blank';link.rel='noopener noreferrer';
    link.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(latitude+','+longitude);
    link.textContent='View driver location on map';
    output.replaceChildren(link,document.createTextNode(updatedAt?' · Updated '+date(updatedAt):''));
  };
  if(demo){update(52.27,-113.81,Date.now());return;}
  const {db,store}=api;
  trackStop=db.onSnapshot(db.doc(store,'trips',id,'live','position'),snapshot=>{
    const location=snapshot.data();update(location?.latitude,location?.longitude,location?.updatedAt);
  },()=>{stopTracking();render();notify('The driver’s location is currently unavailable.',true);});
}
async function getDocument(key){
  if(demo){notify('The demo has no private documents.');return;}
  const documentRef=state.applications.find(app=>app.id===selectedReview)?.documents?.[key];
  if(!documentRef) throw Error('Document unavailable.');
  const {storageSdk,storage}=api;
  const blob=await storageSdk.getBlob(storageSdk.ref(storage,documentRef.path),10485760);
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url;a.download='ED-merchant-'+key+({'application/pdf':'.pdf','image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'}[blob.type]||'.bin');
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function click(button){
  const {action,id,stage,view:page}=button.dataset;
  if(page){await view(page);return;}
  switch(action){
    case 'register':state.register=!state.register;render();return;
    case 'logout':await api.authSdk.signOut(api.auth);return;
    case 'google':await api.authSdk.signInWithPopup(api.auth,new api.authSdk.GoogleAuthProvider());return;
    case 'reset':{
      const email=root.querySelector('[name=email]');
      if(email.reportValidity()){await api.authSdk.sendPasswordResetEmail(api.auth,email.value.trim());notify('If that account exists, a reset link will arrive.');}
      return;
    }
    case 'verify-send':await api.authSdk.sendEmailVerification(state.user);notify('Verification email sent.');return;
    case 'verify-reload':await api.authSdk.reload(state.user);await api.authSdk.getIdToken(state.user,true);await session(state.user);return;
    case 'filter':state.filter=id;await loadBrowse();render();return;
    case 'more-stores':await loadBrowse('stores');render();return;
    case 'more-items':await loadBrowse('items');render();return;
    case 'more-menu':await openStore(state.store.id,true);render();return;
    case 'more-favorites':await favoritePage(true);render();return;
    case 'older-orders':await olderOrders();render();return;
    case 'more-merchant-items':await merchantItems(true);render();return;
    case 'store':await openStore(id);state.screen='store';render();return;
    case 'favorite':await favor(id);return;
    case 'qty':{
      const form=root.querySelector('[data-form=order]');
      if(form) checkoutFields(form);
      const line=state.cart.find(item=>item.key===id), step=Number(button.dataset.step);
      if(!line) return;
      const total=state.cart.filter(item=>item.itemId===line.itemId).reduce((sum,item)=>sum+item.quantity,0);
      if(step>0&&(line.quantity>=25||total>=line.stock)) throw Error('No more units are available for this item.');
      line.quantity+=step;
      state.cart=state.cart.filter(item=>item.quantity>0);
      if(!state.cart.length){state.cartStore=null;state.checkoutDraft=null;}
      render();return;
    }
    case 'track':await track(id);return;
    case 'demo-progress':{
      const order=state.orders.find(item=>item.id===id);
      if(!order) return;
      if(order.status==='pending') order.status='accepted';
      else if(order.status==='accepted') order.status='preparing';
      else if(order.status==='preparing'){order.status='ready';if(order.mode==='delivery') order.tripId='sample-driver-order';}
      else if(order.mode==='pickup')order.status='completed';
      else order.deliveryStatus=({assigned:'en_route',en_route:'in_progress',in_progress:'completed'})[order.deliveryStatus]||'assigned';
      render();return;
    }
    case 'advance':{
      const order=state.orders.find(item=>item.id===id);
      if(!order) return;
      if(stage==='rejected'&&!confirm('Decline this order?')) return;
      if(!demo) await api.call('advanceMarketOrder',{id,status:stage});
      order.status=stage;render();notify(stageNames[stage]+'.');return;
    }
    case 'edit':
      if(!demo){const item=await read('marketItems',id);if(item) state.items=merge(state.items,[item]);}
      editingItem=id;render();return;
    case 'new-item':editingItem=null;render();return;
    case 'review':selectedReview=id;render();return;
    case 'document':await getDocument(id);return;
  }
}
async function submit(form,submitter){
  const fields=new FormData(form);
  switch(form.dataset.form){
    case 'auth': {
      const email=fields.get('email').trim(),password=fields.get('password');
      if(state.register){
        const result=await api.authSdk.createUserWithEmailAndPassword(api.auth,email,password);
        if(role==='merchant') await api.authSdk.sendEmailVerification(result.user);
      }else await api.authSdk.signInWithEmailAndPassword(api.auth,email,password);
      return;
    }
    case 'search':state.term=fields.get('term').trim();await loadBrowse();render();return;
    case 'add':await addCart(state.items.find(item=>item.id===form.dataset.id),fields);return;
    case 'order':await placeOrder(form);return;
    case 'rate':{
      const order=state.orders.find(item=>item.id===form.dataset.id);
      if(!order) return;
      const rating=Number(fields.get('rating'));
      if(!demo) await api.call('rateMarketOrder',{id:order.id,rating,text:fields.get('text')});
      order.rating=rating;render();notify('Thanks for rating your order.');return;
    }
    case 'application':await applyMerchant(fields);return;
    case 'settings':await saveSettings(fields);return;
    case 'item':await saveItem(fields);return;
    case 'review':{
      const application=state.applications.find(item=>item.id===selectedReview), decision=submitter?.value;
      if(!application||!decision) return;
      const checks=Object.fromEntries(Object.keys(checkLabels).map(key=>[key,fields.has(key)]));
      const note=fields.get('note').trim();
      if(decision==='approved'&&!Object.values(checks).every(Boolean)) throw Error('Confirm all six verification checks.');
      if(decision==='needs_changes'&&!note) throw Error('Enter the changes the business needs to make.');
      if(!confirm(decision==='approved'?'Approve this merchant storefront?':'Return this application for changes?')) return;
      if(!demo) await api.call('reviewMerchant',{uid:application.id,batch:application.batch,decision,note,checks});
      state.applications=state.applications.filter(item=>item.id!==application.id);selectedReview=null;
      render();notify(decision==='approved'?'Merchant approved. The owner can now publish a menu and enable orders.':'Changes requested.');return;
    }
  }
}
async function handle(operation,control){
  if(locked) return;
  locked=true;
  if(control) control.disabled=true;
  notify('');
  try{await operation();}
  catch(error){notify(error.message||'Unable to complete the request.',true);}
  finally{locked=false;if(control?.isConnected) control.disabled=false;}
}
root.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action],button[data-view]');
  if(button) handle(()=>click(button),button);
});
root.addEventListener('submit',event=>{
  event.preventDefault();handle(()=>submit(event.target,event.submitter),event.submitter);
});
root.addEventListener('change',event=>{
  if(event.target.name==='mode'&&event.target.closest('[data-form=order]')){
    checkoutFields(event.target.form);state.mode=event.target.value;render();
    root.querySelector('[name=mode]')?.focus();
  }
});
addEventListener('pagehide',stopTracking);
setup();

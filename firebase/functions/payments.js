const Stripe=require('stripe');
const {createHash}=require('node:crypto');
const {zones,normalizePostal,zoneFor,routeFare}=require('./ride-fares');
const {FieldValue,Timestamp,AggregateField}=require('firebase-admin/firestore');
const {defineSecret}=require('firebase-functions/params');
const {onCall,onRequest,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');

const stripeKey=defineSecret('ED_STRIPE_SECRET');
const stripeHook=defineSecret('ED_STRIPE_WEBHOOK');
const paypalSecret=defineSecret('ED_PAYPAL_SECRET');
const providers=[stripeKey,paypalSecret];
const groups=['transportation','food','grocery','parcel'];
const methods=['stripe','paypal','etransfer','invoice','cash','interac','samsung'];
const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
const validId=value=>typeof value==='string'&&idPattern.test(value);
const stamp=()=>FieldValue.serverTimestamp();
const fail=(code,message)=>{throw new HttpsError(code,message);};
const cents=(value,max=1000000)=>{
  if(!Number.isSafeInteger(value)||value<0||value>max) fail('invalid-argument','Enter a valid CAD amount.');
  return value;
};
const clip=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const attach=(kind,ref)=>kind+'_'+ref;
const approvedMethod=method=>method==='stripe'?process.env.ED_ENABLE_STRIPE==='true':
  method==='paypal'?process.env.ED_ENABLE_PAYPAL==='true':true;
const stripe=()=>new Stripe(stripeKey.value(),{timeout:15000,maxNetworkRetries:1});
function appOrigin(){
  try{const url=new URL(process.env.ED_PAYMENT_ORIGIN);if(url.protocol==='https:'&&url.href===url.origin+'/') return url.origin;}catch{}
  fail('failed-precondition','Configure the payment website’s HTTPS origin.');
}
const cad=amount=>(amount/100).toFixed(2);
// Alberta GST on taxable ED’S trip fares, including mandatory fees.
const albertaTripGst=baseCents=>Math.round(baseCents/20);
const fromCad=value=>typeof value==='string'&&/^\d+\.\d{2}$/.test(value)?Number(value.replace('.','')):NaN;
const moneyMatches=(amount,currency,expected)=>amount===expected&&currency?.toLowerCase()==='cad';
const finance=auth=>auth.token.paymentAdmin===true;
const online=method=>method==='stripe'||method==='paypal';
const expires=(created,ms)=>!created||Date.now()-created.toMillis()>ms;
const maxRetry=5*3600000;
const payoutRetry=18*3600000;
let oauth;
async function paypal(path,{method='GET',body,key}={}){
  const origin=process.env.ED_PAYPAL_LIVE==='true'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com';
  if(!oauth||oauth.until<Date.now()){
    const auth=Buffer.from(process.env.ED_PAYPAL_CLIENT_ID+':'+paypalSecret.value()).toString('base64');
    const response=await fetch(origin+'/v1/oauth2/token',{method:'POST',headers:{authorization:'Basic '+auth,'content-type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(12000)});
    if(!response.ok) fail('unavailable','PayPal sign-in failed. Try again later.');
    const token=await response.json();
    oauth={token:token.access_token,until:Date.now()+(token.expires_in-60)*1000};
  }
  const response=await fetch(origin+path,{method,signal:AbortSignal.timeout(15000),headers:{
    authorization:'Bearer '+oauth.token,'content-type':'application/json',
    ...(key?{'PayPal-Request-Id':key,prefer:'return=representation'}:{})
  },...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){
    const issue=result.details?.[0]?.issue;
    if(issue==='ORDER_NOT_APPROVED'||issue==='ORDER_ALREADY_CAPTURED') return {issue};
    fail('unavailable','PayPal could not complete this step. Check the provider record before trying again.');
  }
  return result;
}
const shortKey=(action,paymentId)=>createHash('sha256').update(action+':'+paymentId).digest('hex').slice(0,32);

function payments(db,region){
  const records=db.collection('payments'),allocations=db.collection('paymentAllocations'),recipients=db.collection('paymentRecipients');
  const config=db.doc('paymentSettings/default');
  const fareConfig=db.doc('paymentSettings/rideFares');
  const call=(handler,{admin=false,secrets=[]}={})=>onCall({region,secrets},request=>{
    if(!request.auth) fail('unauthenticated','Sign in to continue.');
    if(admin&&!finance(request.auth)) fail('permission-denied','Payments administrator access is required.');
    return handler(request.data||{},request.auth);
  });
  function source(kind,ref){
    if(!['trip','order'].includes(kind)||!validId(ref)) fail('invalid-argument','Enter a valid booking or order reference.');
    return db.collection(kind==='trip'?'trips':'marketOrders').doc(ref);
  }
  function stateFor(kind,record){
    return kind==='trip'?record.status:(record.mode==='pickup'?record.status:record.deliveryStatus||record.status);
  }
  function collectible(kind,record){
    if(['rejected','cancelled'].includes(stateFor(kind,record))) fail('failed-precondition','This booking was cancelled or declined.');
  }
  function tripGroup(trip){
    return trip.category==='ride'?'transportation':trip.service==='Grocery delivery'?'grocery':'parcel';
  }
  async function getOrCreate(kind,ref,auth,quote){
    const origin=source(kind,ref), payment=records.doc(attach(kind,ref));
    return db.runTransaction(async tx=>{
      const [objectDoc,paymentDoc,settingsDoc]=await tx.getAll(origin,payment,config);
      const object=objectDoc.data(), prior=paymentDoc.data();
      if(!object||(quote?!finance(auth):object.customerId!==auth.uid)) fail('permission-denied','This payment is unavailable.');
      if(prior&&!quote){
        if(kind!=='trip'||prior.status!=='quoted') return {id:payment.id,...prior};
        collectible(kind,object);
        const taxCents=albertaTripGst(prior.baseCents);
        const totalCents=prior.baseCents+taxCents+prior.tipCents;
        if(prior.taxCents!==taxCents||prior.totalCents!==totalCents){
          tx.update(payment,{taxCents,totalCents,updatedAt:stamp()});
        }
        return {id:payment.id,...prior,taxCents,totalCents};
      }
      collectible(kind,object);
      if(prior&&prior.status!=='quoted') fail('failed-precondition','The quote is locked after payment starts.');
      const settings=settingsDoc.data();
      if(!settings) fail('failed-precondition','ED’S has not configured commissions or payment methods yet.');
      let group,baseCents,taxCents,driverBase,merchantBase,merchantId=null,fare=null;
      if(kind==='trip'){
        if(object.marketOrderId) fail('failed-precondition','Pay for this delivery from the marketplace order.');
        group=tripGroup(object);
        if(object.category==='ride'){
          const settings=(await tx.get(fareConfig)).data()||{};
          const mapping=settings.postalZones||{};
          const from=quote?.fromZone||zoneFor(object.pickupPostal,object.pickup,mapping);
          const to=quote?.toZone||zoneFor(object.destinationPostal,object.destination,mapping);
          const route=routeFare(from,to);
          if(!route){
            fail('failed-precondition','ED’S must verify the pickup and destination zones before pricing this ride.');
          }
          const fixed=route.routeBaseCents!==null&&!route.minimum;
          if(!quote&&!fixed){
            fail('failed-precondition','ED’S must confirm your ride fare before payment.');
          }
          if(fixed&&quote?.baseCents!=null&&quote.baseCents!==route.routeBaseCents){
            fail('failed-precondition','This route uses a fixed base fare. Clear the manual fare to apply it.');
          }
          const routeBaseCents=fixed?route.routeBaseCents:cents(quote?.baseCents);
          if(!routeBaseCents||(route.minimum&&routeBaseCents<route.routeBaseCents)){
            fail('failed-precondition','The quoted base fare must meet the listed starting price.');
          }
          baseCents=routeBaseCents+route.redDeerPickupCents+route.regionalSurchargeCents;
          taxCents=albertaTripGst(baseCents);
          fare={...route,routeBaseCents};
        }else{
          if(!quote) fail('failed-precondition','ED’S is preparing your fare. Try again after receiving your quote.');
          baseCents=cents(quote.baseCents);taxCents=albertaTripGst(baseCents);
        }
        driverBase=baseCents;merchantBase=0;
      }else{
        merchantId=object.storeId;
        const store=(await tx.get(db.collection('marketStores').doc(merchantId))).data();
        group=store?.category==='Grocery Stores'?'grocery':['Restaurants','Coffee Shops'].includes(store?.category)?'food':'parcel';
        merchantBase=cents(object.subtotalCents-object.discountCents);driverBase=cents(object.feeCents);
        baseCents=merchantBase+driverBase;taxCents=cents(object.taxCents);
      }
      if(baseCents<=0) fail('failed-precondition','Payment amount is unavailable.');
      const methodList=Array.isArray(settings.methods)?settings.methods.filter(approvedMethod):[];
      const rate=settings.commissions?.[group];
      if(!Number.isSafeInteger(rate)) fail('failed-precondition','ED’S must configure this commission first.');
      const commissionCents=Math.round((kind==='order'?merchantBase:baseCents)*rate/10000);
      const data={kind,ref,customerId:object.customerId,group,status:'quoted',currency:'cad',baseCents,taxCents,tipCents:0,
        totalCents:baseCents+taxCents,commissionCents,commissionRateBps:rate,merchantId,driverBase,merchantBase,
        fulfillment:kind==='trip'?(object.category==='ride'?'ride':'delivery'):object.mode,
        methods:methodList,paymentNotes:settings.paymentNotes||{},...(fare?{fare}:{}),createdAt:prior?.createdAt||stamp(),updatedAt:stamp()};
      tx.set(payment,data);
      return {id:payment.id,...data};
    });
  }
  function customerView(record){
    const {id,kind,ref,status,baseCents,taxCents,tipCents,totalCents,method,methods,paymentNotes,fulfillment,invoice,fare}=record;
    return {id,kind,ref,status,baseCents,taxCents,tipCents,totalCents,method:method||null,methods,paymentNotes,fulfillment,invoice:invoice||null,fare:fare||null};
  }
  const quoteEdFare=call(async(data,auth)=>customerView(await getOrCreate('trip',data.ref,auth,data)),{admin:true});
  const getEdPayment=call(async(data,auth)=>customerView(await getOrCreate(data.kind,data.ref,auth)),{});
  const setEdPaymentSettings=call(async(data,auth)=>{
    if(!Array.isArray(data.methods)||data.methods.some(method=>!methods.includes(method))) fail('invalid-argument','Choose supported payment methods.');
    const commissions=Object.fromEntries(groups.map(group=>[group,cents(data.commissions?.[group],10000)]));
    const notes=Object.fromEntries(['etransfer','invoice','cash','interac','samsung'].map(method=>[method,clip(data.paymentNotes?.[method],400)]));
    await config.set({methods:[...new Set(data.methods)],commissions,paymentNotes:notes,changedBy:auth.uid,updatedAt:stamp()});
    return {saved:true};
  },{admin:true});

  const inspectEdRideRoute=call(async(data)=>{
    const ref=source('trip',data.ref);
    const [doc,configDoc]=await db.getAll(ref,fareConfig);
    const trip=doc.data();
    if(!trip) fail('not-found','Booking unavailable.');
    const mapping=configDoc.data()?.postalZones||{};
    const from=zoneFor(trip.pickupPostal,trip.pickup,mapping);
    const to=zoneFor(trip.destinationPostal,trip.destination,mapping);
    return {pickup:trip.pickup,destination:trip.destination,pickupPostal:trip.pickupPostal||null,
      destinationPostal:trip.destinationPostal||null,from,to,fare:routeFare(from,to)};
  },{admin:true});

  const setEdRideFares=call(async(data,auth)=>{
    if(!Array.isArray(data.postalZones)||data.postalZones.length>500){
      fail('invalid-argument','Enter up to 500 verified postal-code mappings.');
    }
    const postalZones={};
    for(const entry of data.postalZones){
      const code=normalizePostal(entry?.postal);
      if(!code||!zones.includes(entry?.zone)||Object.hasOwn(postalZones,code)){
        fail('invalid-argument','Use a unique full Alberta postal code and a valid fare zone on every line.');
      }
      postalZones[code]=entry.zone;
    }
    await fareConfig.set({postalZones,changedBy:auth.uid,updatedAt:stamp()});
    return {saved:true};
  },{admin:true});

  async function reserve(data,auth){
    if(!validId(data.id)||!methods.includes(data.method)) fail('invalid-argument','Choose a payment and method.');
    const ref=records.doc(data.id);
    return db.runTransaction(async tx=>{
      const payment=(await tx.get(ref)).data();
      if(!payment||payment.customerId!==auth.uid) fail('permission-denied','Payment unavailable.');
      const object=(await tx.get(source(payment.kind,payment.ref))).data();
      if(!object) fail('not-found','Booking unavailable.');
      collectible(payment.kind,object);
      if(payment.status==='paid'||payment.status==='awaiting_collection') return {id:ref.id,...payment};
      if(payment.status==='checkout'&&payment.method===data.method){
        if(expires(payment.checkoutStarted,maxRetry)) fail('failed-precondition','This checkout needs staff reconciliation before it can be retried.');
        return {id:ref.id,...payment};
      }
      if(payment.status!=='quoted') fail('failed-precondition','This payment is locked to an existing checkout. Contact ED’S if the link no longer works.');
      if(payment.kind==='trip'&&payment.taxCents!==albertaTripGst(payment.baseCents)){
        fail('failed-precondition','GST has been updated. Select Find payment to review your new total before continuing.');
      }
      const currentSettings=(await tx.get(config)).data();
      if(!payment.methods.includes(data.method)||!currentSettings?.methods.includes(data.method)||!approvedMethod(data.method)){
        fail('failed-precondition','This payment method is unavailable.');
      }
      const tipCents=cents(data.tipCents,50000);
      const daily=db.collection('paymentVelocity').doc(auth.uid+'_'+new Date().toISOString().slice(0,10));
      const attempts=(await tx.get(daily)).data()?.attempts||0;
      if(attempts>=20) fail('resource-exhausted','Too many payment attempts. Contact ED’S for help.');
      tx.set(daily,{attempts:attempts+1,expiresAt:Timestamp.fromMillis(Date.now()+2*86400000)});
      const status=online(data.method)?'checkout':'awaiting_collection';
      const changes={method:data.method,tipCents,totalCents:payment.baseCents+payment.taxCents+tipCents,status,checkoutStarted:Timestamp.now(),updatedAt:stamp(),
        reviewRequired:payment.baseCents+tipCents>=50000};
      tx.update(ref,changes);
      if(payment.kind==='order') tx.update(source('order',payment.ref),{paymentStatus:status});
      return {id:ref.id,...payment,...changes};
    });
  }
  function link(payment,state){
    return appOrigin()+'/pay/?kind='+payment.kind+'&ref='+encodeURIComponent(payment.ref)+'&return='+state;
  }
  const beginEdPayment=call(async(data,auth)=>{
    if(online(data.method)) appOrigin();
    const payment=await reserve(data,auth);
    if(payment.status!=='checkout') return {status:payment.status,method:payment.method,notes:payment.paymentNotes?.[payment.method]||''};
    if(payment.checkoutUrl) return {status:'checkout',url:payment.checkoutUrl};
    const ref=records.doc(payment.id);
    let providerId,url;
    if(payment.method==='stripe'){
      const session=await stripe().checkout.sessions.create({
        mode:'payment',payment_method_types:['card'],client_reference_id:payment.id,metadata:{edPaymentId:payment.id},
        payment_intent_data:{metadata:{edPaymentId:payment.id}},
        line_items:[{quantity:1,price_data:{currency:'cad',unit_amount:payment.totalCents,product_data:{name:'ED’S '+(payment.kind==='trip'?'booking':'order')+' '+payment.ref}}}],
        success_url:link(payment,'stripe'),cancel_url:link(payment,'cancel')
      },{idempotencyKey:shortKey('stripe-checkout',payment.id)});
      providerId=session.id;url=session.url;
    }else{
      const order=await paypal('/v2/checkout/orders',{method:'POST',key:shortKey('paypal-checkout',payment.id),body:{
        intent:'CAPTURE',purchase_units:[{custom_id:payment.id,invoice_id:payment.id,amount:{currency_code:'CAD',value:cad(payment.totalCents)}}],
        payment_source:{paypal:{experience_context:{return_url:link(payment,'paypal'),cancel_url:link(payment,'cancel'),user_action:'PAY_NOW'}}}
      }});
      providerId=order.id;url=order.links?.find(item=>['payer-action','approve'].includes(item.rel))?.href;
    }
    if(!providerId||!url) fail('unavailable','The payment provider did not return a checkout link.');
    await ref.update({providerId,checkoutUrl:url,updatedAt:stamp()});
    return {status:'checkout',url};
  },{secrets:providers});
  async function settle(id,method,providerId,transactionId,amount,currency,extra={}){
    if(!validId(id)) return;
    const ref=records.doc(id);
    await db.runTransaction(async tx=>{
      const payment=(await tx.get(ref)).data();
      if(!payment||payment.method!==method||payment.providerId!==providerId||!moneyMatches(amount,currency,payment.totalCents)){
        fail('failed-precondition','Payment reconciliation needs attention.');
      }
      if(payment.status==='paid'&&payment.transactionId===transactionId) return;
      if(!['checkout','awaiting_collection'].includes(payment.status)) return;
      if(!online(method)){
        const receipt=db.collection('paymentReceipts').doc(shortKey(method,transactionId.toLowerCase()));
        const existing=(await tx.get(receipt)).data();
        if(existing&&existing.paymentId!==id) fail('already-exists','This receipt was already used on another payment.');
        tx.set(receipt,{paymentId:id,method,createdAt:stamp()});
      }
      tx.update(ref,{status:'paid',transactionId,paidAt:stamp(),updatedAt:stamp(),...extra});
      if(payment.kind==='order') tx.update(source('order',payment.ref),{paymentStatus:'paid'});
    });
  }
  const confirmEdOffline=call(async(data,auth)=>{
    if(!validId(data.id)) fail('invalid-argument','Enter a payment ID.');
    const payment=(await records.doc(data.id).get()).data(), note=clip(data.reference,160);
    if(!payment||!['awaiting_collection','paid'].includes(payment.status)||!payment.method||online(payment.method)||!note||data.treasury!==true) fail('failed-precondition','Enter the verified receipt, invoice settlement or terminal reference.');
    await settle(data.id,payment.method,payment.providerId,note,payment.totalCents,'cad',{verifiedBy:auth.uid});
    return {status:'paid'};
  },{admin:true});

  const issueEdBusinessInvoice=call(async(data,auth)=>{
    const number=clip(data.number,60), dueDate=clip(data.dueDate,10);
    if(!validId(data.id)||!number||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Number.isFinite(Date.parse(dueDate))
      ||new Date(dueDate).toISOString().slice(0,10)!==dueDate) fail('invalid-argument','Enter an invoice number and valid due date.');
    const ref=records.doc(data.id);
    await db.runTransaction(async tx=>{
      const payment=(await tx.get(ref)).data();
      if(payment?.method!=='invoice'||payment.status!=='awaiting_collection') fail('failed-precondition','This payment is not awaiting business billing.');
      if(payment.invoice&&(payment.invoice.number!==number||payment.invoice.dueDate!==dueDate)) fail('failed-precondition','An invoice is already assigned.');
      tx.update(ref,{invoice:{number,dueDate},invoiceBy:auth.uid,updatedAt:stamp()});
    });
    return {issued:true};
  },{admin:true});
  async function capturePayPal(id,providerId){
    if(!/^[A-Z0-9-]{8,50}$/.test(providerId||'')) fail('invalid-argument','Invalid PayPal order reference.');
    const payment=(await records.doc(id).get()).data();
    if(!payment||payment.providerId!==providerId||payment.method!=='paypal') fail('permission-denied','PayPal order unavailable.');
    if(payment.status==='paid') return 'paid';
    if(payment.status!=='checkout') return payment.status;
    let order=await paypal('/v2/checkout/orders/'+providerId+'/capture',{method:'POST',key:shortKey('paypal-capture',id),body:{}});
    if(order.issue==='ORDER_NOT_APPROVED') return 'checkout';
    if(order.issue==='ORDER_ALREADY_CAPTURED') order=await paypal('/v2/checkout/orders/'+providerId);
    const unit=order.purchase_units?.[0], capture=unit?.payments?.captures?.[0];
    if(unit?.custom_id!==id||capture?.status!=='COMPLETED') return 'checkout';
    await settle(id,'paypal',providerId,capture.id,fromCad(capture.amount?.value),capture.amount?.currency_code);
    return 'paid';
  }
  const captureEdPayPal=call(async(data,auth)=>{
    if(!validId(data.id)) fail('invalid-argument','Invalid payment reference.');
    const payment=(await records.doc(data.id).get()).data();
    if(payment?.customerId!==auth.uid) fail('permission-denied','Payment unavailable.');
    return {status:await capturePayPal(data.id,data.token)};
  },{secrets:[paypalSecret]});

  const stripeEdWebhook=onRequest({region,secrets:[stripeKey,stripeHook]},async(req,res)=>{
    if(req.method!=='POST') return res.sendStatus(405);
    let event;
    try{event=stripe().webhooks.constructEvent(req.rawBody,req.get('stripe-signature'),stripeHook.value());}
    catch{return res.sendStatus(400);}
    try{
      const object=event.data.object;
      if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&object.payment_status==='paid'){
        if(!validId(object.metadata?.edPaymentId)) return res.sendStatus(200);
        const intent=await stripe().paymentIntents.retrieve(object.payment_intent,{expand:['latest_charge']});
        const risk=intent.latest_charge?.outcome?.risk_level;
        await settle(object.metadata.edPaymentId,'stripe',object.id,object.payment_intent,object.amount_total,object.currency,
          ['elevated','highest'].includes(risk)?{reviewRequired:true,providerRisk:risk}:{});
      }
      if(['charge.dispute.created','charge.dispute.closed'].includes(event.type)){
        const intent=await stripe().paymentIntents.retrieve(object.payment_intent);
        const id=intent.metadata.edPaymentId;
        if(validId(id)){
          const cleared=event.type==='charge.dispute.closed'&&object.status==='won';
          await records.doc(id).update({reviewRequired:true,disputeId:cleared?FieldValue.delete():object.id,updatedAt:stamp()});
        }
      }
      return res.sendStatus(200);
    }catch(error){console.error('Stripe event needs reconciliation',event.id,error.code);return res.sendStatus(500);}
  });
  const paypalEdWebhook=onRequest({region,secrets:[paypalSecret]},async(req,res)=>{
    if(req.method!=='POST') return res.sendStatus(405);
    if(!process.env.ED_PAYPAL_WEBHOOK_ID) return res.sendStatus(503);
    try{
      const event=req.body;
      const verified=await paypal('/v1/notifications/verify-webhook-signature',{method:'POST',body:{
        auth_algo:req.get('paypal-auth-algo'),cert_url:req.get('paypal-cert-url'),transmission_id:req.get('paypal-transmission-id'),
        transmission_sig:req.get('paypal-transmission-sig'),transmission_time:req.get('paypal-transmission-time'),
        webhook_id:process.env.ED_PAYPAL_WEBHOOK_ID,webhook_event:event
      }});
      if(verified.verification_status!=='SUCCESS') return res.sendStatus(400);
      if(event.event_type==='CHECKOUT.ORDER.APPROVED'){
        const id=event.resource?.purchase_units?.[0]?.custom_id;
        if(validId(id)) await capturePayPal(id,event.resource.id);
        else if(event.resource?.id){
          const order=await paypal('/v2/checkout/orders/'+encodeURIComponent(event.resource.id));
          const key=order.purchase_units?.[0]?.custom_id;
          if(validId(key)) await capturePayPal(key,order.id);
        }
      }
      if(event.event_type==='PAYMENT.CAPTURE.COMPLETED'){
        const orderId=event.resource.supplementary_data?.related_ids?.order_id;
        if(orderId){
          const order=await paypal('/v2/checkout/orders/'+encodeURIComponent(orderId));
          const id=order.purchase_units?.[0]?.custom_id;
          if(validId(id)) await settle(id,'paypal',orderId,event.resource.id,fromCad(event.resource.amount?.value),event.resource.amount?.currency_code);
        }
      }
      return res.sendStatus(200);
    }catch(error){console.error('PayPal event needs reconciliation',req.body?.id,error.code);return res.sendStatus(500);}
  });
  const findAllocations=id=>['driver','merchant'].map(role=>allocations.doc(id+'_'+role));
  const createEdAllocations=call(async(data)=>{
    if(!validId(data.id)) fail('invalid-argument','Enter a payment ID.');
    const ref=records.doc(data.id);
    await db.runTransaction(async tx=>{
      const [record,...prior]=await tx.getAll(ref,...findAllocations(ref.id));
      const payment=record.data();
      if(!payment||payment.status!=='paid'||payment.reviewRequired) fail('failed-precondition','Clear payment and fraud review before releasing earnings.');
      if(prior.some(doc=>doc.exists)) return;
      const object=(await tx.get(source(payment.kind,payment.ref))).data();
      if(!object||stateFor(payment.kind,object)!=='completed') fail('failed-precondition','Mark the ride or order completed first.');
      let driverId=object.driverId||null;
      if(payment.kind==='order'&&object.tripId) driverId=(await tx.get(source('trip',object.tripId))).data()?.driverId||null;
      const driverAmount=payment.driverBase-(payment.kind==='trip'?payment.commissionCents:0)+(driverId?payment.tipCents:0);
      const merchantAmount=payment.merchantBase-(payment.kind==='order'?payment.commissionCents:0)+(driverId?0:payment.tipCents);
      if((driverAmount>0&&!driverId)||(merchantAmount>0&&!payment.merchantId)) fail('failed-precondition','A payout recipient is missing.');
      const dues=[['driver',driverId,driverAmount],['merchant',payment.merchantId,merchantAmount]].filter(entry=>entry[2]>0);
      const accounts=dues.length?await tx.getAll(...dues.map(([role,uid])=>recipients.doc(role+'_'+uid))):[];
      for(let index=0;index<dues.length;index++){
        const [role,uid,amountCents]=dues[index], account=accounts[index].data();
        tx.create(allocations.doc(ref.id+'_'+role),{paymentId:ref.id,role,uid,amountCents,currency:'cad',status:'available',weekly:account?.weekly===true,
          createdAt:stamp(),updatedAt:stamp()});
      }
    });
    return {released:true};
  },{admin:true});
  const clearEdRiskReview=call(async(data,auth)=>{
    if(!validId(data.id)||!clip(data.note,250)) fail('invalid-argument','Record a review note.');
    const ref=records.doc(data.id);
    await db.runTransaction(async tx=>{
      const payment=(await tx.get(ref)).data();
      if(payment?.status!=='paid'||payment.disputeId) fail('failed-precondition','Resolve open disputes at the provider before payout.');
      tx.update(ref,{reviewRequired:false,reviewNote:clip(data.note,250),reviewedBy:auth.uid,updatedAt:stamp()});
    });
    return {cleared:true};
  },{admin:true});

  const refundEdPayment=call(async(data,auth)=>{
    if(!validId(data.id)) fail('invalid-argument','Enter a payment ID.');
    const ref=records.doc(data.id), note=clip(data.reason,250);
    if(!note) fail('invalid-argument','Enter a refund reason or proof.');
    const payment=await db.runTransaction(async tx=>{
      const [doc,...dues]=await tx.getAll(ref,...findAllocations(ref.id));
      const prior=doc.data();
      if(!prior||!['paid','refunding','refunded'].includes(prior.status)||prior.disputeId) fail('failed-precondition','This payment requires reconciliation.');
      if(prior.status==='refunded') return prior;
      if(dues.some(entry=>entry.exists&&!['available','void'].includes(entry.data().status))) fail('failed-precondition','Resolve paid or processing earnings before refunding.');
      if(prior.status==='refunding') return prior;
      tx.update(ref,{status:'refunding',refundStarted:Timestamp.now(),refundReason:note,refundBy:auth.uid,updatedAt:stamp()});
      if(prior.kind==='order') tx.update(source('order',prior.ref),{paymentStatus:'refunding'});
      return prior;
    });
    if(payment.status==='refunded') return {status:'refunded'};
    if(online(payment.method)&&payment.status==='refunding'&&!payment.refundProviderId&&expires(payment.refundStarted,maxRetry)){
      fail('failed-precondition','Check the original provider refund before retrying.');
    }
    let refundId=payment.refundProviderId, completed=!online(payment.method);
    if(payment.method==='stripe'){
      const api=stripe();
      const refund=refundId?await api.refunds.retrieve(refundId):await api.refunds.create(
        {payment_intent:payment.transactionId,metadata:{edPaymentId:ref.id}},{idempotencyKey:shortKey('refund',ref.id)});
      refundId=refund.id;completed=refund.status==='succeeded';
    }else if(payment.method==='paypal'){
      const refund=refundId?await paypal('/v2/payments/refunds/'+refundId):await paypal('/v2/payments/captures/'+payment.transactionId+'/refund',
        {method:'POST',key:shortKey('refund',ref.id),body:{amount:{currency_code:'CAD',value:cad(payment.totalCents)}}});
      refundId=refund.id;completed=refund.status==='COMPLETED';
    }else refundId=note;
    await db.runTransaction(async tx=>{
      const [latest,...dues]=await tx.getAll(ref,...findAllocations(ref.id));
      if(latest.data()?.status!=='refunding') return;
      tx.update(ref,{refundProviderId:refundId,status:completed?'refunded':'refunding',updatedAt:stamp(),...(completed?{refundedAt:stamp()}:{})});
      if(completed){
        dues.filter(entry=>entry.exists).forEach(entry=>tx.update(entry.ref,{status:'void',updatedAt:stamp()}));
        if(payment.kind==='order') tx.update(source('order',payment.ref),{paymentStatus:'refunded'});
      }
    });
    return {status:completed?'refunded':'refunding'};
  },{admin:true,secrets:providers});

  const linkEdPayoutAccount=call(async(data,auth)=>{
    if(!['driver','merchant'].includes(data.role)||!validId(data.uid)||!/^acct_[A-Za-z0-9]{6,}$/.test(data.account||'')) fail('invalid-argument','Enter a valid connected account and recipient.');
    const collection=data.role==='driver'?'drivers':'marketStores';
    const ref=recipients.doc(data.role+'_'+data.uid);
    if(!(await db.collection(collection).doc(data.uid).get()).exists) fail('not-found','Recipient does not exist.');
    const account=await stripe().accounts.retrieve(data.account);
    if(account.country!=='CA'||!account.payouts_enabled||account.capabilities?.transfers!=='active') fail('failed-precondition','The Canadian connected account is not ready for transfers and payouts.');
    await ref.set({role:data.role,uid:data.uid,account:data.account,weekly:data.weekly===true,updatedBy:auth.uid,updatedAt:stamp()});
    return {linked:true};
  },{admin:true,secrets:[stripeKey]});

  async function runPayout(id,method){
    if(!validId(id)||!['standard','instant'].includes(method)) fail('invalid-argument','Choose a valid payout.');
    if(process.env.ED_ENABLE_PAYOUTS!=='true') fail('failed-precondition','Payouts are disabled.');
    const ref=allocations.doc(id);
    const due=await db.runTransaction(async tx=>{
      const entry=(await tx.get(ref)).data();
      if(!entry||entry.status==='void') fail('failed-precondition','Payout unavailable.');
      if(entry.status==='paid'||entry.payoutId) return entry;
      const [paymentDoc,accountDoc]=await tx.getAll(records.doc(entry.paymentId),recipients.doc(entry.role+'_'+entry.uid));
      const payment=paymentDoc.data(), account=accountDoc.data();
      if(payment?.status!=='paid'||payment.reviewRequired||!account?.account) fail('failed-precondition','Clear the payment review and link an eligible connected account.');
      if(entry.status==='processing'){
        if(entry.payoutMethod!==method||expires(entry.processingAt,payoutRetry)) fail('failed-precondition','Reconcile the existing payout before retrying.');
        return entry;
      }
      if(entry.status!=='available') fail('failed-precondition','Payout unavailable.');
      const changes={status:'processing',account:account.account,payoutMethod:method,processingAt:Timestamp.now(),updatedAt:stamp()};
      tx.update(ref,changes);return {...entry,...changes};
    });
    if(due.status==='paid') return {status:'paid',payoutId:due.payoutId};
    const api=stripe();
    const options={stripeAccount:due.account};
    let transferId=due.transferId, payout;
    if(due.payoutId) payout=await api.payouts.retrieve(due.payoutId,options);
    else{
      if(!transferId){
        const transfer=await api.transfers.create({amount:due.amountCents,currency:'cad',destination:due.account,
          transfer_group:due.paymentId,metadata:{edAllocationId:id}},{idempotencyKey:shortKey('transfer',id)});
        transferId=transfer.id;
        await ref.update({transferId,updatedAt:stamp()});
      }
      payout=await api.payouts.create({amount:due.amountCents,currency:'cad',method:due.payoutMethod,metadata:{edAllocationId:id}},
        {...options,idempotencyKey:shortKey('payout',id)});
    }
    const status=payout.status==='paid'?'paid':['failed','canceled'].includes(payout.status)?'payout_failed':'processing';
    await db.runTransaction(async tx=>{
      const latest=(await tx.get(ref)).data();
      if(latest?.status==='paid') return;
      tx.update(ref,{payoutId:payout.id,status,transferId,updatedAt:stamp(),...(status==='paid'?{paidAt:stamp()}:{})});
    });
    return {status,payoutId:payout.id};
  }
  const sendEdPayout=call(async data=>runPayout(data.id,data.method),{admin:true,secrets:[stripeKey]});
  const weeklyEdPayouts=onSchedule({region,schedule:'0 9 * * 1',timeZone:'America/Edmonton',timeoutSeconds:540,secrets:[stripeKey]},async()=>{
    if(process.env.ED_ENABLE_PAYOUTS!=='true') return;
    const page=await allocations.where('status','==','available').where('weekly','==',true).orderBy('createdAt').limit(100).get();
    for(const entry of page.docs){
      const {role,uid}=entry.data();
      const account=(await recipients.doc(role+'_'+uid).get()).data();
      if(!account?.weekly)continue;
      try{await runPayout(entry.id,'standard');}catch(error){console.error('Weekly payout needs review',entry.id,error.code);}
    }
  });
  const edPaymentTotals=call(async()=>{
    const sums=await Promise.all([
      ...Object.entries({gross:'totalCents',commissions:'commissionCents',taxes:'taxCents',tips:'tipCents'}).map(async ([name,field])=>
        [name,(await records.where('status','==','paid').aggregate({cents:AggregateField.sum(field)}).get()).data().cents]),
      ...['driver','merchant'].map(async role=>[role,(await allocations.where('status','==','paid').where('role','==',role)
        .aggregate({cents:AggregateField.sum('amountCents')}).get()).data().cents])
    ]);
    return Object.fromEntries(sums);
  },{admin:true});
  return {quoteEdFare,getEdPayment,setEdPaymentSettings,setEdRideFares,inspectEdRideRoute,beginEdPayment,confirmEdOffline,issueEdBusinessInvoice,captureEdPayPal,stripeEdWebhook,paypalEdWebhook,
    createEdAllocations,clearEdRiskReview,refundEdPayment,linkEdPayoutAccount,sendEdPayout,weeklyEdPayouts,edPaymentTotals};
}
module.exports={payments};

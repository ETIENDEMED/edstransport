const {getStorage}=require('firebase-admin/storage');
const {FieldValue,Timestamp}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const categories=['Restaurants','Coffee Shops','Grocery Stores','Pharmacies','Convenience Stores','Local Businesses'];
const evidence=['license','banking','menu'];
const approval=['license','gst','banking','contact','hours','menu'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const id=/^[a-zA-Z0-9_-]{1,128}$/;
const stamp=()=>FieldValue.serverTimestamp();
const fail=(code,message)=>{throw new HttpsError(code,message);};
const string=(value,max,required=true)=>{
  if(typeof value!=='string'||value.length>max||(required&&!value.trim())) fail('invalid-argument','Check the required text fields and their lengths.');
  return value.trim();
};
const integer=(value,min,max)=>{
  if(!Number.isSafeInteger(value)||value<min||value>max) fail('invalid-argument','Check quantity, price or discount limits.');
  return value;
};
const clock=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Edmonton',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function available(hours,timestamp){
  const parts=Object.fromEntries(clock.formatToParts(new Date(timestamp)).map(part=>[part.type,part.value]));
  const today=hours?.[parts.weekday];
  const time=parts.hour+':'+parts.minute;
  return !!today && today.open<=time && time<today.close;
}
function cleanHours(value){
  const out={};
  for(const day of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']){
    const period=value?.[day];
    if(period==null) continue;
    const pattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if(!pattern.test(period.open)||!pattern.test(period.close)||period.open>=period.close) fail('invalid-argument','Set a valid opening and closing time for '+day+'.');
    out[day]={open:period.open,close:period.close};
  }
  if(!Object.keys(out).length) fail('invalid-argument','Enter operating hours for at least one day.');
  return out;
}
function searchTokens(...texts){
  const tokens=new Set();
  for(const word of texts.join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]{2,}/g)||[]){
    for(let size=2;size<=Math.min(word.length,32)&&tokens.size<240;size++) tokens.add(word.slice(0,size));
  }
  return [...tokens];
}
function storefront(data){
  const name=string(data.name,100), description=string(data.description??'',450,false), city=string(data.city,75);
  if(!categories.includes(data.category)) fail('invalid-argument','Choose a merchant category.');
  const address=string(data.address,250), hours=cleanHours(data.hours);
  return {name,description,city,address,category:data.category,hours,searchTokens:searchTokens(name,city,description)};
}
function storeSettings(data){
  const delivery=data.delivery===true,pickup=data.pickup===true;
  if(!delivery&&!pickup) fail('invalid-argument','Enable at least one fulfillment option.');
  return {delivery,pickup,scheduled:data.scheduled===true,deliveryFeeCents:integer(data.deliveryFeeCents,0,10000),
    acceptingOrders:data.acceptingOrders===true,discountPercent:integer(data.discountPercent,0,90),promotion:string(data.promotion??'',120,false)};
}
const bucket=()=>getStorage().bucket(process.env.MERCHANT_DOCUMENTS_BUCKET||process.env.DRIVER_DOCUMENTS_BUCKET||undefined);
async function verifyFile(path,photo=false){
  try{
    const [meta]=await bucket().file(path).getMetadata();
    if(!['image/jpeg','image/png','image/webp',...(photo?[]:['application/pdf'])].includes(meta.contentType)
      || Number(meta.size)<1 || Number(meta.size)>(photo?5242880:10485760)) fail('invalid-argument','An uploaded file has an unsupported type or size.');
    return {path,generation:meta.generation};
  }catch(error){if(error.code===404) fail('failed-precondition','A required upload is missing.'); throw error;}
}
function marketplace(db,region){
  const applications=db.collection('merchantApplications'),stores=db.collection('marketStores');
  const items=db.collection('marketItems'),orders=db.collection('marketOrders'),trips=db.collection('trips');
  const call=(run,admin=false)=>onCall({region},request=>{
    if(!request.auth) fail('unauthenticated','Sign in to continue.');
    if(admin&&request.auth.token.merchantAdmin!==true) fail('permission-denied','Merchant administrator access is required.');
    return run(request.data||{},request.auth);
  });
  const submitMerchant=call(async(data,auth)=>{
    if(!auth.token.email_verified) fail('failed-precondition','Verify your email before applying.');
    if(typeof data.batch!=='string'||!uuid.test(data.batch)) fail('invalid-argument','Invalid upload batch.');
    const business=storefront(data), contactName=string(data.contactName,100), phone=string(data.phone,35);
    const gst=string(data.gst,25).toUpperCase().replace(/\s+/g,'');
    if(!/^\d{9}(RT\d{4})?$/.test(gst)) fail('invalid-argument','Enter a nine-digit business number or full GST account number.');
    const app=applications.doc(auth.uid);
    const existing=(await app.get()).data();
    if(existing?.batch===data.batch) return {status:existing.status};
    if(existing&&existing.status!=='needs_changes') fail('failed-precondition','An application is already on file.');
    const documents=Object.fromEntries(await Promise.all(evidence.map(async kind=>[kind,await verifyFile('merchant-documents/'+auth.uid+'/'+data.batch+'/'+kind)])));
    return db.runTransaction(async tx=>{
      const prior=(await tx.get(app)).data();
      if(prior?.batch===data.batch) return {status:prior.status};
      if(prior&&prior.status!=='needs_changes') fail('failed-precondition','An application is already on file.');
      tx.set(app,{...business,contactName,phone,gst,email:auth.token.email||'',batch:data.batch,documents,status:'pending',submittedAt:stamp()});
      return {status:'pending'};
    });
  });
  const reviewMerchant=call(async(data,auth)=>{
    if(!id.test(data.uid||'')||!['approved','needs_changes'].includes(data.decision)) fail('invalid-argument','Choose an application and decision.');
    const approved=data.decision==='approved';
    const note=approved?'':string(data.note,600);
    if(approved&&!approval.every(key=>data.checks?.[key]===true)) fail('failed-precondition','Confirm all six application checks.');
    await db.runTransaction(async tx=>{
      const ref=applications.doc(data.uid), current=(await tx.get(ref)).data();
      if(!current||current.status!=='pending'||current.batch!==data.batch) fail('failed-precondition','The application changed. Refresh the queue.');
      tx.update(ref,{status:data.decision,note,reviewedBy:auth.uid,reviewedAt:stamp(),verifiedChecks:approved?approval:[]});
      if(approved) {
        const {name,description,city,address,category,hours,searchTokens}=current;
        tx.create(stores.doc(data.uid),{name,description,city,address,category,hours,searchTokens,published:true,pickup:true,delivery:true,
          scheduled:false,acceptingOrders:false,deliveryFeeCents:0,discountPercent:0,promotion:'',ratingCount:0,ratingSum:0,updatedAt:stamp()});
      }
    });
    return {status:data.decision};
  },true);
  async function publishPhoto(path,uid){
    if(!path) return '';
    const segments=path.split('/');
    if(segments.length!==3||segments[1]!==uid||!uuid.test(segments[2])) fail('invalid-argument','Invalid catalogue photo reference.');
    if(segments[0]==='merchant-photos'){
      await verifyFile(path,true);
      return path;
    }
    if(segments[0]!=='merchant-photo-staging') fail('invalid-argument','Invalid catalogue photo reference.');
    if(!(await stores.doc(uid).get()).data()?.published) fail('permission-denied','An approved business is required to publish photos.');
    const {generation}=await verifyFile(path,true);
    const source=bucket().file(path,{generation});
    const [metadata]=await source.getMetadata();
    const [contents]=await source.download({validation:false});
    const destination='merchant-photos/'+uid+'/'+segments[2];
    try {
      await bucket().file(destination).save(contents,{resumable:false,metadata:{contentType:metadata.contentType,
        cacheControl:'public,max-age=86400'},preconditionOpts:{ifGenerationMatch:0}});
    }catch(error){
      if(error.code!==412) throw error;
      await verifyFile(destination,true);
    }
    return destination;
  }
  const saveMarketStore=call(async(data,auth)=>{
    const ref=stores.doc(auth.uid), business=storefront(data), settings=storeSettings(data);
    const photoPath=await publishPhoto(string(data.photoPath??'',240,false),auth.uid);
    await db.runTransaction(async tx=>{
      const current=(await tx.get(ref)).data();
      if(!current?.published) fail('permission-denied','An approved business is required.');
      if(current.category!==business.category) fail('failed-precondition','The approved business category cannot be changed in store settings.');
      tx.update(ref,{...business,...settings,photoPath,updatedAt:stamp()});
    });
    return {saved:true};
  });
  const saveMarketItem=call(async(data,auth)=>{
    const key=string(data.id,36);
    if(!uuid.test(key)) fail('invalid-argument','Invalid menu item reference.');
    const ref=items.doc(key), name=string(data.name,110), description=string(data.description??'',400,false), section=string(data.section,60);
    const combo=string(data.combo??'',300,false);
    if(!Array.isArray(data.addons)||data.addons.length>8) fail('invalid-argument','Use up to eight add-ons.');
    const addons=data.addons.map((addon,index)=>({id:String(index+1),name:string(addon.name,70),priceCents:integer(addon.priceCents,0,10000)}));
    const priceCents=integer(data.priceCents,1,100000), stock=integer(data.stock,0,100000);
    const photoPath=await publishPhoto(string(data.photoPath??'',240,false),auth.uid);
    await db.runTransaction(async tx=>{
      const [store,current]=await tx.getAll(stores.doc(auth.uid),ref);
      if(!store.data()?.published||(current.exists&&current.data().storeId!==auth.uid)) fail('permission-denied','This menu is unavailable.');
      // The stock revision blocks stale inventory edits racing a customer checkout.
      if(current.exists&&(current.data().stockRevision??0)!==data.stockRevision) fail('aborted','Stock changed. Reload the item before saving.');
      tx.set(ref,{name,description,section,combo,addons,priceCents,stock,taxable:data.taxable===true,published:data.published===true,photoPath,
        storeId:auth.uid,storeName:store.data().name,storeCity:store.data().city,category:store.data().category,
        searchTokens:searchTokens(name,description,section,combo),stockRevision:(current.data()?.stockRevision??0)+1,updatedAt:stamp()});
    });
    return {id:key};
  });
  const createMarketOrder=call(async(data,auth)=>{
    const {storeId,orderId,mode}=data;
    if(!id.test(storeId||'')||!uuid.test(orderId||'')||!['delivery','pickup'].includes(mode)
      || !Array.isArray(data.lines)||!data.lines.length||data.lines.length>20) fail('invalid-argument','Check the order details.');
    if(storeId===auth.uid) fail('failed-precondition','Use a customer account to place orders with your store.');
    const destination=mode==='delivery'?string(data.destination,250):'';
    const instructions=string(data.instructions??'',450,false);
    const now=Date.now(), scheduled=data.scheduledAt==null?null:integer(data.scheduledAt,now+15*60000,now+14*86400000);
    const lines=data.lines.map(line=>{
      if(!uuid.test(line.itemId||'')||!Array.isArray(line.addons)||line.addons.length>8
        ||line.addons.some(addon=>typeof addon!=='string'||!/^[1-8]$/.test(addon))) fail('invalid-argument','Invalid menu selection.');
      return {itemId:line.itemId,quantity:integer(line.quantity,1,25),addons:[...new Set(line.addons)]};
    });
    const ids=[...new Set(lines.map(line=>line.itemId))], orderRef=orders.doc(orderId);
    return db.runTransaction(async tx=>{
      const existing=(await tx.get(orderRef)).data();
      if(existing){
        if(existing.customerId!==auth.uid) fail('already-exists','Order reference unavailable.');
        return {id:orderId,totalCents:existing.totalCents};
      }
      const [storeDoc,...itemDocs]=await tx.getAll(stores.doc(storeId),...ids.map(item=>items.doc(item)));
      const store=storeDoc.data();
      if(!store?.published||!store.acceptingOrders||!store[mode]||(scheduled&&!store.scheduled)||!available(store.hours,scheduled||now)){
        fail('failed-precondition','This store is unavailable at that time or for that option.');
      }
      const stock=new Map(itemDocs.map(doc=>[doc.id,doc.data()]));
      let subtotal=0,taxable=0;
      const records=lines.map(line=>{
        const item=stock.get(line.itemId);
        if(!item?.published||item.storeId!==storeId||item.stock<line.quantity) fail('failed-precondition','An item is unavailable or has insufficient inventory.');
        const addons=line.addons.map(key=>{
          const addon=item.addons.find(entry=>entry.id===key);
          if(!addon) fail('failed-precondition','An add-on changed. Review the cart and try again.');
          return addon;
        });
        item.stock-=line.quantity;
        const unitCents=item.priceCents+addons.reduce((total,addon)=>total+addon.priceCents,0);
        subtotal+=unitCents*line.quantity;
        if(item.taxable) taxable+=unitCents*line.quantity;
        return {itemId:line.itemId,name:item.name,quantity:line.quantity,addons,unitCents};
      });
      const discountCents=Math.round(subtotal*store.discountPercent/100);
      const feeCents=mode==='delivery'?store.deliveryFeeCents:0;
      const taxCents=Math.round((taxable-Math.round(taxable*store.discountPercent/100)+feeCents)*.05);
      const totalCents=subtotal-discountCents+feeCents+taxCents;
      if(data.expectedTotal!==totalCents) fail('failed-precondition','Menu prices changed. Review the updated total before ordering.');
      itemDocs.forEach(doc=>tx.update(doc.ref,{stock:stock.get(doc.id).stock,stockRevision:FieldValue.increment(1)}));
      tx.create(orderRef,{storeId,storeName:store.name,pickupAddress:store.address,customerId:auth.uid,destination,instructions,mode,
        scheduledAt:scheduled===null?null:Timestamp.fromMillis(scheduled),status:'pending',lines:records,subtotalCents:subtotal,
        discountCents,feeCents,taxCents,totalCents,currency:'CAD',createdAt:stamp(),updatedAt:stamp()});
      return {id:orderId,totalCents};
    });
  });
  const advanceMarketOrder=call(async(data,auth)=>{
    if(!uuid.test(data.id||'')) fail('invalid-argument','Invalid order reference.');
    await db.runTransaction(async tx=>{
      const ref=orders.doc(data.id), order=(await tx.get(ref)).data();
      if(!order||order.storeId!==auth.uid) fail('permission-denied','Order unavailable.');
      if(order.status===data.status) return;
      const transitions={pending:['accepted','rejected'],accepted:['preparing','rejected'],preparing:['ready','rejected'],
        ready:order.mode==='pickup'?['completed']:[]};
      if(!transitions[order.status]?.includes(data.status)) fail('failed-precondition','This order cannot move to that status.');
      if(data.status==='rejected'){
        const counts=new Map();
        for(const line of order.lines) counts.set(line.itemId,(counts.get(line.itemId)||0)+line.quantity);
        [...counts].forEach(([key,count])=>tx.update(items.doc(key),{stock:FieldValue.increment(count),stockRevision:FieldValue.increment(1)}));
      }
      const update={status:data.status,updatedAt:stamp()};
      if(data.status==='ready'&&order.mode==='delivery'){
        const trip=trips.doc('m_'+ref.id);
        tx.create(trip,{customerId:order.customerId,merchantId:order.storeId,marketOrderId:ref.id,category:'delivery',service:'Merchant delivery',
          pickup:order.pickupAddress,destination:order.destination,status:'requested',createdAt:stamp(),
          pickupDetails:'Collect ED’S order '+ref.id+(order.instructions?' · '+order.instructions.slice(0,220):''),
          ...(order.scheduledAt?{scheduledAt:order.scheduledAt}:{})});
        update.tripId=trip.id;
      }
      tx.update(ref,update);
    });
    return {status:data.status};
  });
  const rateMarketOrder=call(async(data,auth)=>{
    if(!uuid.test(data.id||'')) fail('invalid-argument','Invalid order reference.');
    const rating=integer(data.rating,1,5), text=string(data.text??'',600,false);
    await db.runTransaction(async tx=>{
      const orderRef=orders.doc(data.id), order=(await tx.get(orderRef)).data();
      if(!order||order.customerId!==auth.uid) fail('permission-denied','Order unavailable.');
      if(order.rating) fail('already-exists','This order already has a rating.');
      const trip=order.tripId?(await tx.get(trips.doc(order.tripId))).data():null;
      if(order.mode==='pickup'?order.status!=='completed':trip?.status!=='completed') fail('failed-precondition','Rate your order after fulfillment.');
      tx.update(orderRef,{rating,ratingText:text,ratedAt:stamp()});
      tx.update(stores.doc(order.storeId),{ratingSum:FieldValue.increment(rating),ratingCount:FieldValue.increment(1)});
    });
    return {rated:true};
  });
  return {submitMerchant,reviewMerchant,saveMarketStore,saveMarketItem,createMarketOrder,advanceMarketOrder,rateMarketOrder};
}
module.exports={marketplace,available,searchTokens};

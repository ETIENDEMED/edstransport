const {randomUUID}=require('node:crypto');
const { getStorage } = require('firebase-admin/storage');
const { FieldValue, Timestamp, AggregateField } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

const kinds = ['photo','license','registration','insurance','record','inspection'];
const checks = ['identity','license','registration','insurance','criminalRecord','vehicleInspection'];
const inspection = ['brakes','tires','lights','restraints','interior'];
const availabilityMs = 120000;
const offerMs = 65000;
const dispatchAheadMs = 45 * 60000;
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const moneyTypes = ['ride','delivery','tip','bonus'];
const fail = (code, message) => { throw new HttpsError(code, message); };
const stamp = () => FieldValue.serverTimestamp();
const validId = (value) => typeof value === 'string' && idPattern.test(value);
const dayParts = new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/Edmonton', year:'numeric', month:'2-digit', day:'2-digit'
});
function dayKey(date) {
  const p = Object.fromEntries(dayParts.formatToParts(date).map(part => [part.type,part.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
function reportingPeriods(date) {
  const day = dayKey(date);
  const monday = new Date(day+'T12:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay()+6)%7);
  return {daily:day,weekly:monday.toISOString().slice(0,10),monthly:day.slice(0,7)+'-01'};
}
function publicDriver(driver) {
  return {name:driver.name,vehicle:driver.vehicle,plate:driver.plate || ''};
}
function finishTrip(tx, tripRef, trip, driverRef, driver, status) {
  tx.delete(tripRef.collection('live').doc('position'));
  if (driver?.currentTripId === tripRef.id) {
    tx.update(driverRef,{busy:false,currentTripId:FieldValue.delete()});
  }
  if (status === 'completed' && driverRef) {
    tx.set(driverRef.collection('ledger').doc('trip_'+tripRef.id), {
      type:trip.category==='delivery'?'completed_delivery':'completed_ride',tripId:tripRef.id,
      amountCents:0,day:dayKey(new Date()),createdAt:stamp()
    });
  }
}

function driverManagement(db, region) {
  const apps = db.collection('driverApplications');
  const drivers = db.collection('drivers');
  const trips = db.collection('trips');
  const queue = db.collection('dispatchQueue');
  const admin = auth => auth.token.driverAdmin === true;
  const call = (run, allowed = () => true) => onCall({region}, async request => {
    if (!request.auth) fail('unauthenticated','Sign in to continue.');
    if (!allowed(request.auth)) fail('permission-denied','Your account does not have this permission.');
    return run(request.data || {}, request.auth);
  });
  function online(driver, now) {
    return driver?.active === true && driver.online === true && driver.onlineUntil?.toMillis() > now;
  }
  function usableDriver(driver) {
    if (!driver?.active) fail('permission-denied','An approved driver account is required.');
  }
  function clean(value, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid-argument','Enter all required application information.');
    return value.trim();
  }

  const submitDriverApplication = call(async (data, auth) => {
    if (!auth.token.email_verified) fail('failed-precondition','Verify your email before uploading or submitting your application.');
    const {batch} = data;
    if (typeof batch !== 'string' || !uuid.test(batch)) fail('invalid-argument','Invalid document batch.');
    const name = clean(data.name,100), vehicle = clean(data.vehicle,100), plate = clean(data.plate,20);
    const inspectedBy = clean(data.inspectedBy,100);
    const inspectedAt = clean(data.inspectedAt,10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inspectedAt) || !Number.isFinite(Date.parse(inspectedAt))
        || new Date(inspectedAt).toISOString().slice(0,10) !== inspectedAt
        || inspectedAt > dayKey(new Date()) || !inspection.every(item=>data.inspection?.[item] === true)) {
      fail('invalid-argument','Complete the inspection details and checklist.');
    }
    const appRef = apps.doc(auth.uid);
    const existing = (await appRef.get()).data();
    if (existing?.batch === batch) return {status:existing.status};
    if (existing && existing.status !== 'needs_changes') fail('failed-precondition','Your application is already submitted.');
    const bucket = getStorage().bucket(process.env.DRIVER_DOCUMENTS_BUCKET || undefined);
    const documents = {};
    await Promise.all(kinds.map(async kind => {
      const path = 'driver-documents/'+auth.uid+'/'+batch+'/'+kind;
      try {
        const [meta] = await bucket.file(path).getMetadata();
        const allowed = ['image/jpeg','image/png','image/webp',...(kind==='photo'?[]:['application/pdf'])];
        if (!allowed.includes(meta.contentType) || Number(meta.size) < 1 || Number(meta.size) > 10485760) {
          fail('invalid-argument','Invalid document type or size for '+kind+'.');
        }
        documents[kind]={path,generation:meta.generation};
      } catch (error) {
        if (error.code === 404) fail('failed-precondition','Upload the '+kind+' document.');
        throw error;
      }
    }));
    return db.runTransaction(async tx => {
      const current = (await tx.get(appRef)).data();
      if (current?.batch === batch) return {status:current.status};
      if (current && current.status !== 'needs_changes') fail('failed-precondition','Your application is already submitted.');
      tx.set(appRef,{name,vehicle,plate,inspectedBy,inspectedAt,checklist:inspection,documents,batch,
        status:'pending',submittedAt:stamp()});
      return {status:'pending'};
    });
  });

  const reviewDriverApplication = call(async (data, auth) => {
    if (!validId(data.uid) || !['approved','needs_changes'].includes(data.decision)) fail('invalid-argument','Select an application and a decision.');
    const decision = data.decision;
    const note = decision==='needs_changes' ? clean(data.note,600) : '';
    if (decision==='approved' && !checks.every(check => data.checks?.[check] === true)) {
      fail('failed-precondition','Confirm all six checks before approving.');
    }
    await db.runTransaction(async tx => {
      const appRef=apps.doc(data.uid);
      const application=(await tx.get(appRef)).data();
      if (!application || application.batch!==data.batch || application.status!=='pending') {
        fail('failed-precondition','This application changed. Refresh the queue.');
      }
      tx.update(appRef,{status:decision,note,reviewedAt:stamp(),reviewedBy:auth.uid,
        verifiedChecks:decision==='approved'?checks:[]});
      if (decision==='approved') {
        tx.set(drivers.doc(data.uid),{
          ...publicDriver(application),active:true,online:false,busy:false,lastOfferedAt:Timestamp.fromMillis(0),activatedAt:stamp()
        },{merge:true});
      }
    });
    return {status:decision};
  },admin);

  const setDriverAvailability = call(async (data, auth) => {
    if (typeof data.online!=='boolean') fail('invalid-argument','Choose online or offline.');
    const ref=drivers.doc(auth.uid);
    const renew=data.renew===true;
    const session=renew?data.session:(data.online?randomUUID():null);
    return db.runTransaction(async tx => {
      const driver=(await tx.get(ref)).data();
      usableDriver(driver);
      const now=Date.now();
      if (renew && (!data.online || typeof session!=='string' || driver.availabilitySession!==session || !online(driver,now))) {
        fail('failed-precondition','Your availability expired or changed. Go online again when you’re ready.');
      }
      const until=data.online?now+availabilityMs:0;
      tx.update(ref,{online:data.online,onlineUntil:Timestamp.fromMillis(until),availabilitySession:session});
      return {online:data.online,until,session};
    });
  });

  async function allocate(tripId) {
    const now=Date.now();
    const candidates=await drivers.where('active','==',true).where('online','==',true)
      .where('busy','==',false).where('onlineUntil','>',Timestamp.fromMillis(now))
      .orderBy('onlineUntil').limit(50).get();
    const tripRef=trips.doc(tripId), item=queue.doc(tripId);
    await db.runTransaction(async tx => {
      const [tripDoc,itemDoc]=await tx.getAll(tripRef,item);
      const trip=tripDoc.data(), pending=itemDoc.data();
      if (!pending || pending.nextAt.toMillis()>now) return;
      if (!trip || trip.status!=='requested') { tx.delete(item); return; }
      const currentId=pending.offeredTo;
      const currentRef=currentId?drivers.doc(currentId):null;
      const current=currentRef?(await tx.get(currentRef)).data():null;
      const recent=new Set(pending.skipped || []);
      if (currentId) recent.add(currentId);
      const declined = new Set(pending.declined || []);
      const eligible=candidates.docs.filter(doc=>!recent.has(doc.id)&&!declined.has(doc.id))
        .sort((a,b)=>(a.data().lastOfferedAt?.toMillis()||0)-(b.data().lastOfferedAt?.toMillis()||0));
      const fresh=eligible.length?await tx.getAll(...eligible.map(doc=>doc.ref)):[];
      const selected=fresh.find(doc=>{
        const d=doc.data();
        return online(d,now) && !d.busy && !(d.offerUntil?.toMillis()>now);
      });
      if (currentRef) {
        tx.delete(currentRef.collection('offers').doc(tripId));
        if (current?.offerTripId===tripId) tx.update(currentRef,{offerTripId:FieldValue.delete(),offerUntil:FieldValue.delete()});
      }
      if (!selected) {
        tx.update(item,{offeredTo:FieldValue.delete(),nextAt:Timestamp.fromMillis(now+60000),skipped:[]});
        return;
      }
      const expiresAt=Timestamp.fromMillis(now+offerMs);
      tx.set(selected.ref.collection('offers').doc(tripId),{
        tripId,category:trip.category,service:trip.service,scheduledAt:trip.scheduledAt || null,expiresAt
      });
      tx.update(selected.ref,{offerTripId:tripId,offerUntil:expiresAt,lastOfferedAt:Timestamp.fromMillis(now)});
      tx.update(item,{offeredTo:selected.id,nextAt:expiresAt,skipped:[...recent].slice(-50)});
    });
  }

  const enqueueTrip = onDocumentCreated({region,document:'trips/{tripId}',retry:true},async event => {
    const {tripId}=event.params;
    const ref=trips.doc(tripId), item=queue.doc(tripId);
    await db.runTransaction(async tx=>{
      const [tripDoc,itemDoc]=await tx.getAll(ref,item);
      const trip=tripDoc.data();
      if (trip?.status!=='requested' || itemDoc.exists) return;
      const now=Date.now();
      tx.create(item,{nextAt:Timestamp.fromMillis(Math.max(now,(trip.scheduledAt?.toMillis()||now)-dispatchAheadMs)),skipped:[]});
    });
    await allocate(tripId);
  });
  const processDispatchQueue = onSchedule({region,schedule:'every 1 minutes'}, async () => {
    const due=await queue.where('nextAt','<=',Timestamp.now()).orderBy('nextAt').limit(50).get();
    for(let i=0;i<due.size;i+=5) await Promise.all(due.docs.slice(i,i+5).map(doc=>allocate(doc.id)));
  });

  const answerOffer = call(async (data, auth) => {
    const {tripId,accept}=data;
    if (!validId(tripId)||typeof accept!=='boolean') fail('invalid-argument','Choose a valid offer.');
    const driverRef=drivers.doc(auth.uid), tripRef=trips.doc(tripId), item=queue.doc(tripId);
    await db.runTransaction(async tx=>{
      const [driverDoc,tripDoc,itemDoc]=await tx.getAll(driverRef,tripRef,item);
      const driver=driverDoc.data(), trip=tripDoc.data(), pending=itemDoc.data();
      usableDriver(driver);
      if (accept && trip?.driverId===auth.uid && trip.status==='assigned') return;
      if (trip?.status!=='requested' || pending?.offeredTo!==auth.uid || driver.offerTripId!==tripId
          || pending.nextAt.toMillis()<=Date.now()) fail('failed-precondition','This offer has expired.');
      if (accept && (!online(driver,Date.now())||driver.busy)) fail('failed-precondition','Go online and finish your current assignment first.');
      const clear={offerTripId:FieldValue.delete(),offerUntil:FieldValue.delete()};
      tx.delete(driverRef.collection('offers').doc(tripId));
      if (accept) {
        tx.update(tripRef,{status:'assigned',driverId:auth.uid,driver:publicDriver(driver),updatedAt:stamp()});
        if (trip.marketOrderId) tx.update(db.collection('marketOrders').doc(trip.marketOrderId),{deliveryStatus:'assigned',updatedAt:stamp()});
        tx.update(driverRef,{...clear,busy:true,currentTripId:tripId});
        tx.delete(item);
      } else {
        tx.update(driverRef,clear);
        tx.update(item,{offeredTo:FieldValue.delete(),nextAt:Timestamp.now(),declined:[...new Set([...(pending.declined || []),auth.uid])].slice(-100)});
      }
    });
    if (!accept) await allocate(tripId).catch(error=>console.error('Dispatch retry scheduled',error.code));
    return {accepted:accept};
  });

  const recordDriverPayment = call(async (data,auth)=>{
    const {uid,tripId,type,amountCents,entryId}=data;
    if (!validId(uid)||typeof entryId!=='string'||!uuid.test(entryId)||!moneyTypes.includes(type)
        || !Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>1000000
        || (type!=='bonus'&&!validId(tripId)) || (tripId&&!validId(tripId))) fail('invalid-argument','Enter a valid CAD amount and booking reference.');
    const driverRef=drivers.doc(uid);
    const entry=driverRef.collection('ledger').doc(['ride','delivery'].includes(type)?'revenue_'+tripId:entryId);
    await db.runTransaction(async tx=>{
      const refs=[driverRef,entry,...(tripId?[trips.doc(tripId)]:[])];
      const [driverDoc,previous,tripDoc]=await tx.getAll(...refs);
      if (previous.exists) {
        const old=previous.data();
        if (old.amountCents===amountCents&&old.type===type&&old.tripId===(tripId||null)) return;
        fail('already-exists','A different payment already uses that reference.');
      }
      const trip=tripDoc?.data();
      if (!driverDoc.exists || (tripId && (trip?.driverId!==uid||trip.status!=='completed'))
          || (['ride','delivery'].includes(type)&&trip?.category!==type)) fail('failed-precondition','Select an eligible completed booking for this driver.');
      tx.create(entry,{type,amountCents,tripId:tripId||null,createdAt:stamp(),day:dayKey(new Date()),recordedBy:auth.uid});
    });
    return {recorded:true};
  },admin);

  const setDriverActivation = call(async (data,auth)=>{
    if (!validId(data.uid) || typeof data.active!=='boolean') fail('invalid-argument','Select a driver and activation status.');
    const ref=drivers.doc(data.uid);
    await db.runTransaction(async tx=>{
      const [driverDoc,appDoc]=await tx.getAll(ref,apps.doc(data.uid));
      const driver=driverDoc.data();
      if (!driver || appDoc.data()?.status!=='approved') fail('failed-precondition','This application needs approval first.');
      if (driver.active===data.active) return;
      if (driver.busy) fail('failed-precondition','Finish or cancel the assigned job before suspending this driver.');
      tx.update(ref,{active:data.active,online:false,onlineUntil:Timestamp.fromMillis(0),
        activationChangedAt:stamp(),activationChangedBy:auth.uid});
    });
    return {active:data.active};
  },admin);

  const driverEarnings = call(async (_,auth)=>{
    const ref=drivers.doc(auth.uid);
    usableDriver((await ref.get()).data());
    const ledger=ref.collection('ledger');
    const now=new Date(), end=dayKey(now);
    return Object.fromEntries(await Promise.all(Object.entries(reportingPeriods(now)).map(async ([period,start])=>{
      const results=await Promise.all([...moneyTypes,'completed_ride','completed_delivery'].map(async type=>{
        const results=await ledger.where('day','>=',start).where('day','<=',end).where('type','==',type)
          .aggregate({cents:AggregateField.sum('amountCents'),count:AggregateField.count()}).get();
        return [type,results.data()];
      }));
      return [period,Object.fromEntries(results)];
    })));
  });
  return {submitDriverApplication,reviewDriverApplication,setDriverAvailability,enqueueTrip,processDispatchQueue,answerOffer,recordDriverPayment,driverEarnings,setDriverActivation};
}

module.exports={driverManagement,finishTrip,publicDriver,reportingPeriods};

const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {getMessaging} = require('firebase-admin/messaging');
const {onDocumentUpdated} = require('firebase-functions/v2/firestore');
const {onCall, HttpsError} = require('firebase-functions/v2/https');
initializeApp();
const db = getFirestore();
const region = 'northamerica-northeast1';
const {driverManagement,finishTrip,publicDriver} = require('./driver-management');
Object.assign(exports, driverManagement(db, region));
Object.assign(exports, require("./marketplace").marketplace(db, region));
Object.assign(exports, require("./payments").payments(db, region));

const next = {
  requested: ['assigned','cancelled'],
  assigned: ['en_route','cancelled'],
  en_route: ['in_progress','cancelled'],
  in_progress: ['completed','cancelled']
};
exports.updateTrip = onCall({region}, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated','Sign in.');
  const {tripId, status, driverId} = request.data || {};
  if (typeof tripId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tripId) || typeof status !== 'string') {
    throw new HttpsError('invalid-argument','Invalid trip or status.');
  }
  const ref = db.collection('trips').doc(tripId);
  const queueRef = db.collection('dispatchQueue').doc(tripId);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) throw new HttpsError('not-found','Trip unavailable.');
    const trip = snapshot.data();
    const dispatcher = request.auth.token.dispatcher === true || request.auth.token.driverAdmin === true;
    if (status==='assigned' && (typeof driverId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(driverId))) {
      throw new HttpsError('invalid-argument','Select a driver.');
    }
    const uid=status==='assigned'?driverId:trip.driverId;
    const driverRef=uid?db.collection('drivers').doc(uid):null;
    const driver=driverRef?(await tx.get(driverRef)).data():null;
    const isAssignedDriver=driver?.active && trip.driverId===request.auth.uid;
    if (!dispatcher && !(isAssignedDriver && ['en_route','in_progress','completed'].includes(status))) {
      throw new HttpsError('permission-denied','This trip is not available to your account.');
    }
    if (trip.status === status && (status !== 'assigned' || trip.driverId === driverId)) return;
    if (!next[trip.status]?.includes(status)) throw new HttpsError('failed-precondition','Invalid trip transition.');
    const pending=trip.status==='requested'?(await tx.get(queueRef)).data():null;
    const offeredRef=pending?.offeredTo?db.collection('drivers').doc(pending.offeredTo):null;
    const offered=offeredRef?(offeredRef.id===driverRef?.id?driver:(await tx.get(offeredRef)).data()):null;
    const update={status,updatedAt:FieldValue.serverTimestamp()};
    if (status==='assigned') {
      if (!driver?.active || driver.busy || (driver.offerUntil?.toMillis()>Date.now() && driver.offerTripId!==tripId)) {
        throw new HttpsError('failed-precondition','Driver is unavailable.');
      }
      Object.assign(update,{driverId,driver:publicDriver(driver)});
      tx.update(driverRef,{busy:true,currentTripId:tripId});
    }
    if (pending) tx.delete(queueRef);
    if (offeredRef) {
      tx.delete(offeredRef.collection('offers').doc(tripId));
      if (offered?.offerTripId===tripId) tx.update(offeredRef,{offerTripId:FieldValue.delete(),offerUntil:FieldValue.delete()});
    }
    tx.update(ref,update);
    if (trip.marketOrderId) tx.update(db.collection('marketOrders').doc(trip.marketOrderId),{deliveryStatus:status,updatedAt:FieldValue.serverTimestamp()});
    if (['completed','cancelled'].includes(status)) finishTrip(tx,ref,trip,driverRef,driver,status);
  });
  return {status};
});
exports.tripNotification = onDocumentUpdated({region, document:'trips/{tripId}'}, async event => {
  const {before,after} = event.data;
  const trip = after.data();
  if (before.data().status === trip.status) return;
  const devices = db.collection('customers').doc(trip.customerId).collection('devices');
  let page = await devices.orderBy('__name__').limit(500).get();
  while (!page.empty) {
    const entries = page.docs;
    const result = await getMessaging().sendEachForMulticast({
      tokens: entries.map(doc => doc.data().token),
      notification: {title:'ED’s Transport & Delivery', body:'Your booking status has changed.'},
      data: {tripId: event.params.tripId, status: trip.status}
    });
    await Promise.all(result.responses.map((response,index) => {
      if (response.error?.code !== 'messaging/registration-token-not-registered') return;
      return entries[index].ref.delete({lastUpdateTime:entries[index].updateTime});
    }));
    if (entries.length < 500) break;
    page = await devices.orderBy('__name__').startAfter(entries.at(-1)).limit(500).get();
  }
});

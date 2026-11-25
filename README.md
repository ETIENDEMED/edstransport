# ED’s Transport & Delivery

Three components share one Firebase project.

| Directory | Purpose |
| --- | --- |
| `website/` | Eight responsive pages and a Google-authenticated web booking and inquiry flow |
| `customer/` | Flutter customer app for Android and iOS |
| `firebase/` | Firestore rules and indexes, a role-checked trip lifecycle, and booking notifications |

## Firebase

Create or select the business-owned Firebase project with billing enabled for Cloud Functions. Create Firestore in the desired region. The Functions default is Montréal (`northamerica-northeast1`). If you choose another region, adjust the Function and callable-client settings accordingly.

1. Register the Android package `ca.edstransport.eds_transport`, iOS bundle `ca.edstransport.edsTransport`, and a web app in the same project.
2. Enable Email/Password, Phone, Google, Apple, and Facebook providers in Firebase Authentication. Set the Canada SMS region policy and add allowed Android SHA-1 and SHA-256 fingerprints for the debug and release signing keys. Configure Apple and Facebook OAuth credentials and redirect URLs in the provider dashboards and Firebase console.
3. From `firebase/`, run `npm ci --prefix functions` and `firebase deploy --project YOUR_PROJECT_ID --only firestore,functions` using the Firebase CLI.
4. Keep Google, Apple and Facebook provider credentials and APNs keys in their provider consoles. The per-platform Firebase client config is distinct from the server credentials.

## Website

Set `website/config.js` to the Firebase web SDK configuration and add your website host to Firebase Authentication’s authorized domains. Serve `website/` at the site root on an HTTPS static host. The hosted Sites copy ships in browse-only mode until a Firebase project is connected. Form submissions require Google sign-in and share the app’s trip records. Inquiries are written to Firestore for authorized staff to retrieve.

## Flutter

Use Flutter 3.47 or later with Dart 3.13 or later for the included lockfile.

1. Place `google-services.json` at `customer/android/app/google-services.json`. Android Gradle applies the Google Services plugin when the file is present.
2. Add `GoogleService-Info.plist` to the iOS Runner target in Xcode. Add the Firebase Phone Auth URL scheme and any Google reversed client ID required by your provider configuration. In Xcode, enable Sign in with Apple, Push Notifications, and Background Modes → Remote notifications. Upload your APNs key in Firebase Cloud Messaging.
3. Configure the Facebook SDK on each platform using the registered Meta app ID and client token. On Android, add the Facebook app ID and client token string resources and application metadata, and register your signing key hashes in the Meta dashboard. On iOS, add `FacebookAppID`, `FacebookClientToken`, `FacebookDisplayName`, and the `fb<APP_ID>` URL scheme in the Runner target, plus the scheme queries documented by the plugin. The app uses Facebook Limited Login on iOS.
4. From `customer/`, run `flutter pub get` and `flutter run`. iOS builds need Xcode and signing. For app-store builds, configure release signing and verify each sign-in method on a real device.
5. The app displays pickup times in the phone’s local time. The website uses America/Edmonton and both store UTC Firestore timestamps.
6. For fleet use, configure a tile provider with `--dart-define=MAP_TILES='https://your-provider/{z}/{x}/{y}.png'` and `--dart-define=MAP_ATTRIBUTION='Required provider attribution'`. The default OpenStreetMap tiles are for light development use subject to the service’s tile usage policy.

## Dispatch and GPS integration

The deliverable includes customer screens and backend endpoints. The browser-based driver and dispatch portals are described below.

- Provision staff with Firebase Admin custom claims `dispatcher: true` or `driver: true`. After changing claims, refresh the user's ID token. Create trusted driver documents at `drivers/{uid}` with `active: true`, `name`, `vehicle`, and optional `plate`.
- Dispatch staff use the Admin SDK to read queued trip requests or inquiries. The callable `updateTrip` accepts `{ tripId, status, driverId? }`. Assignment requires a dispatcher and an active driver. An assigned driver can advance an assigned trip to `en_route`, then `in_progress`, then `completed`. A dispatcher can cancel open trips.
- An approved authenticated assigned driver publishes `{ latitude, longitude, updatedAt: serverTimestamp() }` to `trips/{tripId}/live/position` when there is a meaningful location change, typically every 10–15 seconds during an active trip. The customer map subscribes to this one document. Finalizing a trip removes the live document in the status transaction.
- When a status changes, Cloud Functions sends a generic notification to registered devices. Opening it loads the trip under its existing Firestore permissions. The notification contains no address.

## Data model

Trips use Firestore-generated IDs and a customer/time composite index. History uses bounded cursor queries, and only the newest page stays subscribed. Current GPS positions are stored independently from trip history to keep trip reads and indexes narrow. Devices and reviews use subcollections. One review per customer booking is allowed after completion. Dispatcher state changes run in transactions and use custom claims checked by the backend. Staff access to the Admin SDK is controlled by Google Cloud IAM.

Before launch, verify real sign-in and push delivery on each platform and confirm a driver GPS feed, service coverage, and the business’s retention rules for location and contact information.

## Driver Portal and Admin Console

The responsive driver portal is at `/driver/` and the admin console is at `/admin/`. They use the same Firebase project and trip collection as the customer app. With a null web configuration, both show labeled demo data and never upload documents or save payments. A Firebase configuration enables live mode.

### Connect the live system

1. Enable Firebase Authentication Email/Password and Cloud Storage in the same project. In web `config.js`, set the Firebase web app configuration, including `storageBucket`. Add the website origin to Authentication's authorized domains and configure the storage bucket to allow browser reads from the portal's HTTPS origin. The console uses authenticated Storage downloads for private documents.
2. Install dependencies with `npm ci --prefix functions` from the `firebase/` directory. Deploy the updated components using `firebase deploy --project YOUR_PROJECT_ID --only firestore,storage,functions`. Firebase deploys the schedule that revisits offers and upcoming bookings. If Functions resolves a different bucket, set `DRIVER_DOCUMENTS_BUCKET` in `firebase/functions/.env.YOUR_PROJECT_ID` to the same bucket used by the portal.
3. Assign the dispatch and admin roles through a trusted Firebase Admin SDK environment. Use the `driverAdmin: true` custom claim for application review, activation, payment entry and dispatch. Use `dispatcher: true` for dispatch alone. Preserve existing claims when granting roles. Role changes require signing in again or refreshing the user's ID token.
4. Serve the portal from an authorized HTTPS origin. The deployed Sites copy is owner-private, so a live rollout to drivers and staff requires an approved site audience or an alternate static host.

### Operating the driver workflow

- Drivers verify their email, upload a photo plus licence, registration, insurance, criminal record verification evidence and a vehicle inspection document, and complete the inspection checklist. Each batch is immutable and access uses Firebase Auth with Storage Security Rules. Administrators review the actual documents and independently verify the criminal record check. The portal records the verification decision and reviewer. It does not query an external criminal records service.
- An approved driver can go online, accept or decline offers, navigate to the pickup or destination, and complete bookings. Availability expires after roughly two minutes without renewal and the driver dashboard renews it while open. Browser-based GPS sharing requires location permission and an open driver page. Navigation opens installed or web Google Maps with the active leg's destination.
- New immediate requests are queued on creation. Scheduled rides enter the offer window 45 minutes before pickup. The queue matches approved drivers who are online and available, offers one driver at a time, and retries expired offers on a one-minute schedule. Dispatchers can manually assign unassigned bookings, including requests entered before deployment, from the dispatch console. Assignment and acceptance lock the trip and driver transactionally.
- Completing a job creates a completion record automatically. Admin staff record ride and delivery revenue, tips, and bonuses in CAD cents. One revenue entry per completed booking is enforced. Earnings are grouped by Alberta business day, Monday-to-date week, and calendar month. The ledger tracks recorded earnings and does not move funds or collect payments.

### Reference documents

| Path | Purpose |
| --- | --- |
| `driverApplications/{uid}` | Application details, document references and stamped admin review |
| `drivers/{uid}` | Activation, driver profile, availability lease and assignment lock |
| `drivers/{uid}/offers/{tripId}` | Driver-scoped expiring offer with no customer address |
| `drivers/{uid}/ledger/{entryId}` | Completion counts and immutable monetary entries |
| `dispatchQueue/{tripId}` | Server-only queue for scheduled and retryable dispatch |
| `driver-documents/{uid}/{batch}/{kind}` | Private uploaded evidence in Firebase Storage |

## ED’S Marketplace

The customer storefront is `/marketplace/`, the merchant portal is `/merchant/`, and merchant verification is at `/merchant-admin/`. These are responsive web pages. The Flutter customer app continues to show the associated delivery trip in its trip history when customers use the same Firebase account.

### Enable live operation

1. Configure the Firebase web SDK through `website/config.js`, including `storageBucket`, and enable Email/Password Authentication. Enable Google sign-in if you intend to offer Google login in the customer storefront. Add the HTTPS host as an authorized Firebase Authentication domain and configure the Storage bucket's CORS policy for authenticated document downloads from it.
2. Deploy the included Firebase rules, indexes, functions, and existing dispatch scheduler with `firebase deploy --project YOUR_PROJECT_ID --only firestore,storage,functions`. If Functions uses a custom bucket, set `MERCHANT_DOCUMENTS_BUCKET` to the same bucket as the web SDK. The functions default to the configured Firebase bucket.
3. A trusted operator adds the `merchantAdmin: true` Firebase custom claim to authorized reviewers, retaining their existing claims. An administrator verifies six application checks before approval. Business licence, banking evidence and menu files are held under private authenticated Storage paths. The GST number and contact details stay in the private application record. Submit a void cheque or direct deposit form for the banking evidence and never collect banking passwords.
4. Approved merchants create catalog entries in the editor using their source menu. They set pickup and delivery options, delivery fee, Alberta hours and scheduling, optional automatic percentage discount, photos, and available stock. When their catalog is ready, they enable order intake. The onboarding menu attachment is review evidence and is not imported automatically.
5. Customers browse by category, search businesses and menu items, save favourites, choose add-ons and combos, and order from one business at a time. Scheduled checkout accepts open-store times from 15 minutes to 14 days ahead. Server transactions validate inventory and the current total, reserve stock, and restore it when the merchant declines. The software defaults to 5% GST for marked taxable lines and the delivery fee, with a merchant-controlled taxable toggle for each item. Configure taxability before going live.
6. Merchants accept, prepare, and mark orders ready. Ready deliveries create an ED’S dispatch request and share assigned driver and fulfillment progress with the customer and merchant. Ready pickup orders are completed by the merchant. Customers can post one rating after fulfillment.

The private hosted copy displays labeled sample data without Firebase configuration. For live onboarding, use a site audience authorized for the intended customers and merchants, or serve the static source on a business-managed host. Customer payment is arranged with the merchant in the current checkout. Banking documentation enables onboarding review; this version does not submit payments or payouts. The pharmacy category can list ordinary retail products. Prescription processing and regulated-goods checkout are outside this marketplace workflow.

### Data layout

| Path | Purpose |
| --- | --- |
| `merchantApplications/{uid}` | Private business details, submitted evidence and stamped review |
| `marketStores/{uid}` | Approved storefront, settings, search tokens and rating totals |
| `marketItems/{id}` | Searchable catalogue, options, photos and versioned stock |
| `marketOrders/{id}` | Access-scoped purchases, immutable item-price snapshots and order lifecycle |
| `marketCustomers/{uid}/favorites/{storeId}` | Account-scoped favourite businesses |
| `trips/m_{orderId}` | Driver dispatch request for a ready marketplace delivery |
| `merchant-documents/{uid}/{batch}/{kind}` | Immutable private files used in approval |
| `merchant-photo-staging/{uid}/{id}` | Private merchant photo uploads before server publishing |
| `merchant-photos/{uid}/{id}` | Public images published by approved merchants |

## Community photography

The Springbrook and Penhold photographs retain their CC BY-SA 4.0 license. The website copies were resized and converted to WebP.

- Ribbet32, [Springbrook, Red Deer County](https://commons.wikimedia.org/wiki/File:Springbrook,_Red_Deer_County.jpg), 2021.
- Ribbet32, [Penhold Museum](https://commons.wikimedia.org/wiki/File:Penhold_Museum.jpg), 2019.
- [Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).

## Launch verification

Begin with a private staging Firebase project and a small Springbrook and Penhold pilot. Confirm service boundaries, dispatch coverage and a monitored customer support channel before accepting live bookings. Publish reviewed pricing, cancellation and refund terms before collecting money. Decide how to collect customer payments and reconcile merchant and driver payouts before a public marketplace launch.

Use staging accounts to verify one scheduled ride, one merchant pickup, and one merchant delivery through completion and a dispatcher cancellation. Test Android and iOS sign-in and push notifications on real devices, including sign-out and account switching. Review who can access onboarding documents and how long financial, identity and location records are retained before collecting real documents.

An updated driver dashboard renews the current availability session. Drivers who were online before that feature was deployed can start a fresh session with Go offline, then Go online.

## Ride-first launch capacity

Plan the initial Springbrook and Penhold rollout for approximately 500 customer accounts. This is a launch cohort estimate. The application does not enforce a 500-account cap. The number of rides ED’S can serve at once depends on the number of available drivers and the peak booking rate. Each driver has one active assignment, and the scheduled backup dispatch worker currently processes up to 50 due queue entries per minute. Initial dispatch is also triggered when a request arrives.

Before opening registration to the full cohort, estimate bookings per peak hour and the available driver roster. Use a dedicated staging Firebase project and synthetic accounts to exercise the expected burst of requests, driver accept/decline, and live GPS updates. Observe how long requests wait for a driver, the oldest unassigned booking, functions errors, and Firestore read/write volume. Compare those with the pilot before increasing coverage or tuning dispatch. These production capacity metrics have not been validated.

## ED’S Payments

Open `/pay/` for customer checkout and `/payments-admin/` for the finance console. The private Sites preview is a simulation. No preview action sends money. Live checkout is linked from booking confirmations, marketplace orders, and Flutter trip details. The Flutter app opens the HTTPS checkout in the device browser. Set `--dart-define=ED_PAYMENT_ORIGIN=https://YOUR_HOST` when the live host changes.

### Live setup

1. Connect the web app to the ED’S Firebase project, configure its HTTPS origin with `ED_PAYMENT_ORIGIN` and deploy the included Firestore indexes, rules, and Functions. Use Firebase Secret Manager for `ED_STRIPE_SECRET`, `ED_STRIPE_WEBHOOK`, and `ED_PAYPAL_SECRET`. Functions bind these secrets at deployment. Never place provider secrets in the web config or mobile app.
2. In the Functions environment, set `ED_ENABLE_STRIPE=true` and/or `ED_ENABLE_PAYPAL=true` only for the providers ready to accept payments. For PayPal set `ED_PAYPAL_CLIENT_ID` and `ED_PAYPAL_WEBHOOK_ID`, and leave `ED_PAYPAL_LIVE` off until live activation. Use Stripe test credentials and PayPal sandbox credentials for test transactions. Add ED’S web origin to the Firebase Authentication authorized domains.
3. Register the `stripeEdWebhook` endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.dispute.created`, and `charge.dispute.closed`. Register `paypalEdWebhook` for `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED`. Provider signatures and exact CAD amounts are checked before marking an online payment paid. Use the finance console to reconcile externally initiated refunds and disputes with the provider.
4. A trusted Firebase administrator grants the `paymentAdmin: true` custom claim to approved finance staff. Set commission rates for transportation, food delivery, grocery delivery, and parcel delivery. Enable only available methods and supply approved offline payment instructions. Fixed ride fares can be calculated from verified postal-code zones. Staff confirm starting-price routes, unmapped rides, and direct delivery fares. Marketplace orders use their server-priced totals. Tips are separate from the commission base.
5. Stripe-hosted Checkout handles credit cards and eligible Apple Pay and Google Pay wallets. PayPal uses hosted approval. Interac Debit and Samsung Pay are recorded as external, in-person terminal payments and require compatible equipment and an enabled acquiring account. Interac e-Transfer uses ED’S transfer instructions, business billing allows staff to record an approved invoice number and due date, and cash is confirmed manually for rides, pickup, or deliveries. Reconcile the receipt and funds received before marking any offline payment paid. Funds held by a driver or merchant must first be remitted to ED’S before recording the receipt and paying out earnings.
6. Link approved Canadian Stripe Connect recipients and configure their provider payout accounts for manual scheduling. Review funds availability and instant eligibility at Stripe. Turn on `ED_ENABLE_PAYOUTS=true` only after sandbox verification. Release earnings only after fulfillment, confirmed collection, and risk review. Manual payouts support standard or eligible instant speed. The opt-in weekly worker initiates up to 100 eligible standard allocations each Monday at 9 a.m. Alberta time. Recheck processing payouts from the admin console. Stripe payouts are funded from the platform balance, so PayPal and offline receipts must be reconciled and the Stripe balance funded separately. Provider processing fees and treasury transfers need separate accounting reconciliation.
7. Full refunds are supported. Automatic refunds are blocked once related payouts have begun. Reconcile any transfers or payouts in the provider console before handling such refunds. Offline refunds are recorded after staff return the funds through the original offline channel. Provider responses can be asynchronous. Use the same refund action to refresh pending refunds. Checkout creation stops making ambiguous provider retries after five hours and requires staff reconciliation.

### Security and reporting

Card details are entered on provider-hosted pages and never stored in ED’S Firestore. Hosted checkout reduces card-data exposure. ED’S still needs to confirm its PCI DSS scope and complete the applicable assessment with its acquiring provider before launch. Stripe Radar and PayPal account controls handle provider risk. ED’S limits new payment attempts per customer per UTC day, flags amounts of CAD 500 or more before tax for payout review, and holds Stripe elevated-risk and disputed payments. Firestore reporting is restricted to finance staff. Gross collected, commissions, tax and tips reflect currently paid records. Payout totals include amounts confirmed paid by Stripe. Set TTL on the Firestore `paymentVelocity.expiresAt` field to remove expired counters.

The Firebase emulator can verify role checks, amount calculations, duplicate receipt protection, risk holds, and refund and allocation state transitions. Card and wallet eligibility, PayPal webhooks, card-present devices, and actual payouts require launch-account sandbox and hardware verification.

### Location-based ride pricing

In Payments Admin → Ride Pricing, enter verified full Alberta postal codes and their fare zones. Format each line as `POSTAL CODE | zone`. Verify the exact codes used for ED’S service addresses, including the North and South Red Deer split and each airport. No unverified postal-code assignments ship with the site. ED’S checkout applies the 5% Alberta GST rate to taxable Alberta trip fares.

The server first matches both postal codes to the configured zones. Customers can enter them in the web or Flutter booking form. Existing bookings can use full postal codes embedded in their address lines. If a typed code conflicts with the code in the address, or either zone is missing, staff verify both ends and use **Look up route** and the verified zone selectors on the finance quote form. Customers cannot set fare amounts. Checkout uses the stored fare and itemizes the base, any pickup fee or regional surcharge, tax, and optional tip.

- Springbrook ↔ Penhold and Springbrook ↔ Gasoline Alley use a $7 base. North or South Red Deer rides within the same zone use a $10 base. North ↔ South uses a $15 base. Springbrook ↔ South Red Deer is $15, Springbrook ↔ North is $20, Penhold ↔ South is $20, and Penhold ↔ North is $25.
- Rides with both ends in Red Deer add the $2 pickup fee once. That makes the fixed same-zone fare $12 and North ↔ South $17 before tax or tip.
- Rides involving Innisfail, Blackfalds, or Lacombe add $5 once per trip. Springbrook ↔ Innisfail and Red Deer ↔ any of those towns have a $25 starting base, making the starting fare $30 before tax or tip. Staff confirm the base before collecting payment.
- Calgary and Edmonton airport rides have a $175 starting base and require a confirmed quote. The $5 regional surcharge also applies if the verified other end of an airport ride is in Innisfail, Blackfalds, or Lacombe.
- New fixed fares with two verified zones are priced when the customer opens checkout. The 5% GST applies to the trip fare and required fees for rides and direct delivery bookings. Voluntary tips are added separately. Existing unpaid quotes refresh on lookup. Payment attempts already started keep the amount sent to the provider and should be reviewed if tax was originally omitted. Marketplace orders still use their existing item and delivery tax calculations.

## Netlify, Supabase and FCM setup

This is the transition setup. The current website and client apps still use the existing Firebase backend. Avoid changing the Firebase configuration or moving production traffic during provider setup. The local Supabase configuration was initialized with CLI 3.4.0. Netlify CLI 27.20.1 parsed the hosting manifest in an offline dry run.

### Netlify hosting

The included `netlify.toml` publishes only `website/` from the platform root. Keep the backend source, local environment files, credentials, and mobile signing assets outside that directory.

- In a trusted working environment, run `netlify login` and authorize the intended ED’S account in the provider’s browser. For automation use a protected `NETLIFY_AUTH_TOKEN` and an explicit `NETLIFY_SITE_ID` in the environment. Keep both outside source.
- If an ED’S staging site already exists, run `netlify link --id SITE_ID` and `netlify status` from this platform root. Link the intended site before a deploy. Use `netlify deploy --no-build` for a draft after selecting the authorized audience. Check ride booking, account sign-in, payment return links and admin access on that origin.
- Store this complete platform in an ED’S-controlled Git repository for continuous deployment. Use isolated preview and production environments, enforce server permissions even if a preview is private, and keep the current site available until cutover is explicitly approved.

### Supabase project access

Create or select your Supabase project before running migrations. This source still uses Firebase for its active application backend.

- For command-line access from a trusted environment, run `supabase login`, confirm the expected project with `supabase projects list`, then link the intended project from this platform root using `supabase link --project-ref YOUR_PROJECT_REF`. Linking credentials are local. This step is separate from connector access.
- Deploy versioned SQL migrations locally and in staging before touching the production database. Make RLS tests cover anonymous users, customers reading only their own activity, drivers reading only their assignments and earnings, and admins acting only under appropriately scoped privileges.
- Choose Supabase Auth for a fresh user base. If Firebase already has real user accounts, use the supported Firebase Auth integration as a bridge and preserve identity mappings during migration. Derive product roles from server-controlled records. Client bundles may contain the project URL and publishable key only. Keep service-role or secret keys and database credentials in the server environment.
- FCM remains the notification delivery channel. Keep device registrations in Supabase and send through a server-side worker using FCM HTTP v1. An outbox row saved with each ride state transition makes notification delivery retryable. Android needs the registered Firebase app configuration. iOS also needs APNs setup, entitlements, signing and real-device verification.

### Architecture review baseline

For the approximately 500-customer pilot, use one backend organized by domain with shared server rules. Netlify hosts the browser app. Supabase/PostgreSQL owns accounts, rides, assignments, activity, and financial records. The web admin uses role-checked APIs. Android and iOS should share Flutter components across customer and driver experiences. The driver app owns active-trip GPS and offer notifications. Location and earnings records should have explicit retention and visibility rules.

Keep the working transaction patterns and signed provider webhooks. Before launch, put booking, fare finalization, dispatch and payment transitions behind authenticated server operations. Verify and normalize addresses before applying fare zones. Dispatch candidates must meet service-area and ETA requirements. Model checkout attempts separately from the payment ledger so verified expired or cancelled sessions can be replaced safely. Secure the data cutover with staging parity checks for fares, tax, refunds, and payouts, and keep one system authoritative for each state transition.

Code review was against the website source at revision `6a0e5f5e6c22222d37a94626f709eda6db9ba231` and the accompanying Flutter and Firebase source. Demo workflow checks, fare and GST emulator checks, and Flutter static analysis passed. Android release signing currently uses the debug configuration. Native builds, background driver location, live pay-provider reconciliation, and real push delivery have not been verified.

#### Findings to address before the pilot

| Priority | Finding | Evidence and change |
| --- | --- | --- |
| High | Fare zones are derived from rider-entered postal codes. | `firebase/functions/ride-fares.js:17` checks postal format and conflicting text. It does not verify that the address belongs to that postal code. Resolve addresses on the server against the same map used for dispatch before finalizing automatic prices. |
| High | Dispatch has no distance or service-area filter. | `firebase/functions/driver-management.js:155` reads the first 50 online, eligible-by-status drivers by lease expiry. It ranks that subset by last offer without checking distance. Filter by zone and location freshness, rank by pickup ETA, and use transaction-safe assignment. Validate dispatch under burst load. |
| High | An abandoned online checkout can block all later payment methods. | `firebase/functions/payments.js:210` locks the payment to one method and eventually rejects stale resumes. Persist each checkout attempt independently. Check the provider terminal status before expiring it and creating another attempt. Reconcile in-progress money events before cutover. |
| High | Driver background tracking and offer push are not implemented on mobile. | The driver portal uses browser geolocation at `website/operations.js:367` and stops on page hide at line 559. The existing FCM sender at `firebase/functions/index.js:67` targets customers. Add a native driver experience and verify foreground/background tracking, driver offers, stale coordinates, and notification retries on devices. |
| Release gate | Android release uses debug signing. | `customer/android/app/build.gradle.kts:36` needs a protected release signing setup. Verify iOS identifiers, entitlements, signing and APNs before distribution. |
| Scale and maintainability | Firestore details reach directly into UI and business transitions. | Customer trip reads begin at `customer/lib/main.dart:822`; several portal screens also access Firestore directly. Extract shared client interfaces, replace mutating calls with versioned authenticated operations, and move ownership and lifecycle controls to PostgreSQL policies and transactions. |

Protect the migration with a CI workflow for web smoke checks, Flutter lint and tests, SQL policy tests, and provider-event replay cases. The current smoke scripts are workspace fixtures, so move the critical paths into the eventual project repository once the owner selects it.

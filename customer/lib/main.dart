import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
// Keep the Flutter Material API available across Flutter SDK releases.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_facebook_auth/flutter_facebook_auth.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:google_sign_in/google_sign_in.dart';

const blue = Color(0xff003da5);
const gold = Color(0xffffd100);
const rides = [
  'Local ride',
  'Scheduled ride',
  'Medical ride',
  'Airport ride',
  'Out-of-town ride',
];
const deliveries = [
  'Grocery delivery',
  'Parcel delivery',
  'Prescription pickup',
  'Document delivery',
];
const liveStatuses = ['assigned', 'en_route', 'in_progress'];
final auth = FirebaseAuth.instance;
final db = FirebaseFirestore.instance;
typedef Data = Map<String, dynamic>;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp();
    runApp(const EdsApp());
  } catch (_) {
    runApp(
      const MaterialApp(
        home: Scaffold(
          body: Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('This build needs the ED’s Firebase configuration.'),
            ),
          ),
        ),
      ),
    );
  }
}

class EdsApp extends StatelessWidget {
  const EdsApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'ED’s Transport & Delivery',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: blue,
        primary: blue,
        secondary: gold,
      ),
      scaffoldBackgroundColor: const Color(0xfff4f7fc),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        filled: true,
        fillColor: Colors.white,
      ),
    ),
    home: StreamBuilder<User?>(
      stream: auth.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }
        final user = snapshot.data;
        return user == null
            ? const SignIn()
            : Dashboard(key: ValueKey(user.uid), user: user);
      },
    ),
  );
}

String message(Object error) => error is FirebaseAuthException
    ? (error.message ?? 'Sign-in failed. Please try again.')
    : 'Something went wrong. Please try again.';

final Future<void> googleInitialization = GoogleSignIn.instance.initialize();

Future<void> googleLogin() async {
  await googleInitialization;
  final account = await GoogleSignIn.instance.authenticate();
  await auth.signInWithCredential(
    GoogleAuthProvider.credential(idToken: account.authentication.idToken),
  );
}

Future<void> appleLogin() async {
  await auth.signInWithProvider(
    AppleAuthProvider()
      ..addScope('email')
      ..addScope('name'),
  );
}

Future<void> facebookLogin() async {
  final random = Random.secure();
  final nonce = base64UrlEncode(
    List<int>.generate(32, (_) => random.nextInt(256)),
  ).replaceAll('=', '');
  final hash = sha256.convert(utf8.encode(nonce)).toString();
  final result = await FacebookAuth.instance.login(nonce: hash);
  if (result.status == LoginStatus.cancelled) return;
  final token = result.accessToken;
  if (result.status != LoginStatus.success || token == null) {
    throw FirebaseAuthException(
      code: 'facebook-login-failed',
      message: 'Facebook sign-in failed. Please try again.',
    );
  }
  final credential = token.type == AccessTokenType.limited
      ? OAuthProvider(
          'facebook.com',
        ).credential(idToken: token.tokenString, rawNonce: nonce)
      : FacebookAuthProvider.credential(token.tokenString);
  await auth.signInWithCredential(credential);
}

class SignIn extends StatefulWidget {
  const SignIn({super.key});
  @override
  State<SignIn> createState() => _SignInState();
}

class _SignInState extends State<SignIn> {
  final email = TextEditingController();
  final password = TextEditingController();
  final phone = TextEditingController();
  final code = TextEditingController();
  String? verification;
  String status = '';
  bool busy = false;
  bool create = false;
  bool byPhone = false;

  @override
  void dispose() {
    for (final controller in [email, password, phone, code]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> action(Future<void> Function() job) async {
    if (busy) return;
    setState(() {
      busy = true;
      status = '';
    });
    try {
      await job();
    } catch (error) {
      if (mounted) setState(() => status = message(error));
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> submit() async {
    if (!byPhone) {
      if (create) {
        await auth.createUserWithEmailAndPassword(
          email: email.text.trim(),
          password: password.text,
        );
      } else {
        await auth.signInWithEmailAndPassword(
          email: email.text.trim(),
          password: password.text,
        );
      }
      return;
    }
    final id = verification;
    if (id != null) {
      await auth.signInWithCredential(
        PhoneAuthProvider.credential(
          verificationId: id,
          smsCode: code.text.trim(),
        ),
      );
      return;
    }
    if (!RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(phone.text.trim())) {
      setState(
        () => status =
            'Enter a phone number with its country code, such as +1 for Canada.',
      );
      return;
    }
    final done = Completer<void>();
    await auth.verifyPhoneNumber(
      phoneNumber: phone.text.trim(),
      verificationCompleted: (credential) async {
        try {
          await auth.signInWithCredential(credential);
        } catch (error) {
          if (mounted) setState(() => status = message(error));
        } finally {
          if (!done.isCompleted) done.complete();
        }
      },
      verificationFailed: (error) {
        if (mounted) setState(() => status = message(error));
        if (!done.isCompleted) done.complete();
      },
      codeSent: (id, _) {
        if (mounted) {
          setState(() {
            verification = id;
            status = 'Enter the code sent to your phone.';
          });
        }
        if (!done.isCompleted) done.complete();
      },
      codeAutoRetrievalTimeout: (id) {
        if (mounted && verification == null) setState(() => verification = id);
        if (!done.isCompleted) done.complete();
      },
    );
    await done.future.timeout(const Duration(seconds: 90));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 410),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Brand(),
                const SizedBox(height: 28),
                Text(
                  byPhone
                      ? 'Continue with your phone'
                      : create
                      ? 'Create your account'
                      : 'Welcome to ED’s',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 16),
                if (!byPhone) ...[
                  Field('Email', email, keyboard: TextInputType.emailAddress),
                  Field('Password', password, secret: true),
                ] else if (verification == null)
                  Field('Phone number', phone, keyboard: TextInputType.phone)
                else
                  Field(
                    'Verification code',
                    code,
                    keyboard: TextInputType.number,
                  ),
                FilledButton(
                  onPressed: busy ? null : () => action(submit),
                  child: Text(
                    byPhone
                        ? (verification == null ? 'Send code' : 'Verify code')
                        : (create ? 'Sign up' : 'Sign in'),
                  ),
                ),
                if (!byPhone)
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => setState(() {
                            create = !create;
                            status = '';
                          }),
                    child: Text(
                      create
                          ? 'Already have an account? Sign in'
                          : 'Create an account',
                    ),
                  ),
                TextButton(
                  onPressed: busy
                      ? null
                      : () => setState(() {
                          byPhone = !byPhone;
                          verification = null;
                          status = '';
                        }),
                  child: Text(byPhone ? 'Use email' : 'Use phone'),
                ),
                const Divider(),
                for (final entry in <String, Future<void> Function()>{
                  'Google': googleLogin,
                  'Apple': appleLogin,
                  'Facebook': facebookLogin,
                }.entries)
                  OutlinedButton(
                    onPressed: busy ? null : () => action(entry.value),
                    child: Text('Continue with ${entry.key}'),
                  ),
                if (busy) const LinearProgressIndicator(),
                if (status.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(status, semanticsLabel: status),
                  ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

class Brand extends StatelessWidget {
  const Brand({super.key});
  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(5),
    child: Image.asset(
      'assets/eds-logo.webp',
      width: 104,
      height: 50,
      fit: BoxFit.contain,
      semanticLabel: 'ED’s Transport & Delivery',
    ),
  );
}

class Field extends StatelessWidget {
  const Field(
    this.label,
    this.controller, {
    this.keyboard,
    this.secret = false,
    this.max,
    this.lines = 1,
    super.key,
  });
  final String label;
  final TextEditingController controller;
  final TextInputType? keyboard;
  final bool secret;
  final int? max;
  final int lines;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: TextField(
      controller: controller,
      keyboardType: keyboard,
      obscureText: secret,
      maxLength: max,
      maxLines: lines,
      decoration: InputDecoration(labelText: label, counterText: ''),
    ),
  );
}

class Dashboard extends StatefulWidget {
  const Dashboard({required this.user, super.key});
  final User user;
  @override
  State<Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<Dashboard> {
  int tab = 0;
  String? token;
  Future<void> tokenWrite = Future<void>.value();
  StreamSubscription<String>? refresh;
  StreamSubscription<RemoteMessage>? notifications;
  StreamSubscription<RemoteMessage>? opened;
  bool signingOut = false;

  @override
  void initState() {
    super.initState();
    notifications = FirebaseMessaging.onMessage.listen((event) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              event.notification?.body ?? 'Your booking has an update.',
            ),
          ),
        );
      }
    });
    opened = FirebaseMessaging.onMessageOpenedApp.listen(openTrip);
    FirebaseMessaging.instance
        .getInitialMessage()
        .then((event) {
          if (event != null) openTrip(event);
        })
        .catchError((Object _) {});
    FirebaseMessaging.instance
        .getNotificationSettings()
        .then((settings) async {
          if (mounted &&
              [
                AuthorizationStatus.authorized,
                AuthorizationStatus.provisional,
              ].contains(settings.authorizationStatus)) {
            await registerNotifications(prompt: false);
          }
        })
        .catchError((Object _) {});
  }

  void openTrip(RemoteMessage event) {
    final id = event.data['tripId'];
    if (mounted && id is String && RegExp(r'^[\w-]{1,128}$').hasMatch(id)) {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => TripDetails(uid: widget.user.uid, id: id),
        ),
      );
    }
  }

  DocumentReference<Data> device(String value) => db
      .collection('customers')
      .doc(widget.user.uid)
      .collection('devices')
      .doc(sha256.convert(utf8.encode(value)).toString());

  Future<void> saveToken(String value) {
    if (!mounted || signingOut) return Future<void>.value();
    final write = tokenWrite.catchError((Object _) {}).then((_) async {
      if (!mounted || signingOut || token == value) return;
      final old = token;
      final batch = db.batch()..set(device(value), {'token': value});
      if (old != null) batch.delete(device(old));
      await batch.commit();
      token = value;
    });
    tokenWrite = write;
    return write;
  }

  Future<void> registerNotifications({bool prompt = true}) async {
    try {
      final fcm = FirebaseMessaging.instance;
      if (prompt) {
        final permission = await fcm.requestPermission();
        if (![
          AuthorizationStatus.authorized,
          AuthorizationStatus.provisional,
        ].contains(permission.authorizationStatus)) {
          if (mounted) {
            notify(context, 'Notifications are disabled in device settings.');
          }
          return;
        }
      }
      final value = await fcm.getToken();
      if (value == null) throw StateError('Notification token unavailable');
      await saveToken(value);
      if (!mounted || signingOut) return;
      refresh ??= fcm.onTokenRefresh.listen((updated) {
        saveToken(updated).catchError((Object _) {});
      });
      if (prompt) notify(context, 'Booking notifications enabled.');
    } catch (error) {
      if (prompt && mounted) notify(context, message(error));
    }
  }

  Future<void> signOut() async {
    if (signingOut) return;
    signingOut = true;
    try {
      await tokenWrite.catchError((Object _) {});
      final value = token;
      if (value != null) {
        await device(value).delete();
        token = null;
      }
      final providers = widget.user.providerData
          .map((item) => item.providerId)
          .toSet();
      if (providers.contains('google.com')) {
        await googleInitialization;
        await GoogleSignIn.instance.signOut();
      }
      if (providers.contains('facebook.com')) {
        await FacebookAuth.instance.logOut();
      }
      await auth.signOut();
    } catch (error) {
      if (mounted) notify(context, message(error));
    } finally {
      signingOut = false;
    }
  }

  @override
  void dispose() {
    refresh?.cancel();
    notifications?.cancel();
    opened?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Brand()),
    body: IndexedStack(
      index: tab,
      children: [
        Booking(uid: widget.user.uid, onBooked: () => setState(() => tab = 1)),
        History(uid: widget.user.uid),
        Profile(
          user: widget.user,
          notifications: registerNotifications,
          signOut: signOut,
        ),
      ],
    ),
    bottomNavigationBar: NavigationBar(
      selectedIndex: tab,
      onDestinationSelected: (index) => setState(() => tab = index),
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.directions_car_outlined),
          label: 'Book',
        ),
        NavigationDestination(icon: Icon(Icons.history), label: 'Trips'),
        NavigationDestination(
          icon: Icon(Icons.person_outline),
          label: 'Profile',
        ),
      ],
    ),
  );
}

void notify(BuildContext context, String text) =>
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

class Booking extends StatefulWidget {
  const Booking({required this.uid, required this.onBooked, super.key});
  final String uid;
  final VoidCallback onBooked;
  @override
  State<Booking> createState() => _BookingState();
}

class _BookingState extends State<Booking> {
  bool delivery = false;
  bool pending = false;
  String service = rides.first;
  final pickup = TextEditingController();
  final destination = TextEditingController();
  final pickupPostal = TextEditingController();
  final destinationPostal = TextEditingController();
  final details = TextEditingController();
  DateTime? scheduled;
  DocumentReference<Data>? draft;
  bool get needsTime =>
      ['Scheduled ride', 'Medical ride', 'Airport ride'].contains(service);

  @override
  void dispose() {
    pickup.dispose();
    destination.dispose();
    pickupPostal.dispose();
    destinationPostal.dispose();
    details.dispose();
    super.dispose();
  }

  Future<void> pickTime() async {
    final now = DateTime.now();
    final day = await showDatePicker(
      context: context,
      firstDate: now,
      initialDate: scheduled ?? now,
      lastDate: DateTime(now.year + 1, now.month, now.day),
    );
    if (day == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(scheduled ?? now),
    );
    if (time != null && mounted) {
      setState(
        () => scheduled = DateTime(
          day.year,
          day.month,
          day.day,
          time.hour,
          time.minute,
        ),
      );
    }
  }

  Future<void> submit() async {
    final from = pickup.text.trim();
    final to = destination.text.trim();
    final postalPattern = RegExp(
      r'^T[0-9][ABCEGHJ-NPRSTV-Z][0-9][ABCEGHJ-NPRSTV-Z][0-9]$',
    );
    String normalized(TextEditingController field) =>
        field.text.replaceAll(RegExp(r'[ -]'), '').toUpperCase();
    final fromPostal = delivery ? '' : normalized(pickupPostal);
    final toPostal = delivery ? '' : normalized(destinationPostal);
    if ([
      fromPostal,
      toPostal,
    ].any((code) => code.isNotEmpty && !postalPattern.hasMatch(code))) {
      return notify(context, 'Enter valid Alberta postal codes for the ride.');
    }
    final at = scheduled;
    if (from.isEmpty || to.isEmpty) {
      return notify(context, 'Enter a pickup address and a destination.');
    }
    if (needsTime && (at == null || !at.isAfter(DateTime.now()))) {
      return notify(context, 'Choose a future pickup time.');
    }
    setState(() => pending = true);
    final ref = draft ??= db.collection('trips').doc();
    try {
      final data = {
        'customerId': widget.uid,
        'category': delivery ? 'delivery' : 'ride',
        'service': service,
        'pickup': from,
        'destination': to,
        if (fromPostal.isNotEmpty) 'pickupPostal': fromPostal,
        if (toPostal.isNotEmpty) 'destinationPostal': toPostal,
        'pickupDetails': details.text.trim(),
        'status': 'requested',
        'createdAt': FieldValue.serverTimestamp(),
        if (needsTime && at != null) 'scheduledAt': Timestamp.fromDate(at),
      };
      try {
        await ref.set(data);
      } on FirebaseException {
        // A retry may encounter a create-only document already accepted by the server.
        if (!(await ref.get(const GetOptions(source: Source.server))).exists) {
          rethrow;
        }
      }
      if (!mounted) return;
      pickup.clear();
      destination.clear();
      pickupPostal.clear();
      destinationPostal.clear();
      details.clear();
      scheduled = null;
      draft = null;
      notify(context, 'Booking requested.');
      widget.onBooked();
    } catch (error) {
      if (mounted) notify(context, message(error));
    } finally {
      if (mounted) setState(() => pending = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: blue,
          image: const DecorationImage(
            image: AssetImage('assets/eds-corolla.webp'),
            fit: BoxFit.cover,
            alignment: Alignment(0.08, 0.35),
            colorFilter: ColorFilter.mode(Color(0xA007172E), BlendMode.darken),
          ),
          borderRadius: BorderRadius.circular(18),
        ),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'ALBERTA, CANADA',
              style: TextStyle(
                color: gold,
                letterSpacing: 1.5,
                fontWeight: FontWeight.w800,
              ),
            ),
            SizedBox(height: 5),
            Text(
              'Where to?',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w900,
                fontSize: 34,
              ),
            ),
            Text(
              'Book a local ride or schedule your next trip.',
              style: TextStyle(color: Colors.white),
            ),
          ],
        ),
      ),
      const SizedBox(height: 18),
      IgnorePointer(
        ignoring: pending,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                  value: false,
                  label: Text('Ride'),
                  icon: Icon(Icons.directions_car),
                ),
                ButtonSegment(
                  value: true,
                  label: Text('Delivery'),
                  icon: Icon(Icons.inventory_2_outlined),
                ),
              ],
              selected: {delivery},
              onSelectionChanged: (values) => setState(() {
                delivery = values.first;
                service = (delivery ? deliveries : rides).first;
                scheduled = null;
              }),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              key: ValueKey(delivery),
              initialValue: service,
              decoration: const InputDecoration(labelText: 'Service'),
              items: (delivery ? deliveries : rides)
                  .map(
                    (value) =>
                        DropdownMenuItem(value: value, child: Text(value)),
                  )
                  .toList(),
              onChanged: (value) {
                if (value != null) setState(() => service = value);
              },
            ),
            const SizedBox(height: 12),
            Field('Pickup address', pickup, max: 250),
            Field(
              delivery ? 'Delivery address' : 'Destination',
              destination,
              max: 250,
            ),
            if (!delivery) ...[
              Field('Pickup postal code (optional)', pickupPostal, max: 7),
              Field(
                'Destination postal code (optional)',
                destinationPostal,
                max: 7,
              ),
            ],
            Field('Pickup instructions (optional)', details, max: 300),
            if (needsTime)
              OutlinedButton.icon(
                onPressed: pickTime,
                icon: const Icon(Icons.schedule),
                label: Text(
                  scheduled == null
                      ? 'Choose pickup time (device time)'
                      : '${MaterialLocalizations.of(context).formatShortDate(scheduled!)} · ${TimeOfDay.fromDateTime(scheduled!).format(context)}',
                ),
              ),
          ],
        ),
      ),
      const SizedBox(height: 8),
      FilledButton(
        style: FilledButton.styleFrom(
          backgroundColor: gold,
          foregroundColor: Colors.black,
        ),
        onPressed: pending ? null : submit,
        child: Text(pending ? 'Submitting…' : 'Request booking'),
      ),
    ],
  );
}

class History extends StatefulWidget {
  const History({required this.uid, super.key});
  final String uid;
  @override
  State<History> createState() => _HistoryState();
}

class _HistoryState extends State<History> {
  Query<Data> get query => db
      .collection('trips')
      .where('customerId', isEqualTo: widget.uid)
      .orderBy('createdAt', descending: true)
      .limit(20);
  late final Stream<QuerySnapshot<Data>> recent = query.snapshots();
  final older = <QueryDocumentSnapshot<Data>>[];
  bool loading = false;
  bool more = true;

  Future<void> loadNext(List<QueryDocumentSnapshot<Data>> first) async {
    if (loading || first.isEmpty) return;
    setState(() => loading = true);
    try {
      final last = older.isEmpty ? first.last : older.last;
      final page = await query.startAfterDocument(last).get();
      if (mounted) {
        setState(() {
          older.addAll(page.docs);
          more = page.docs.length == 20;
        });
      }
    } catch (error) {
      if (mounted) notify(context, message(error));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => StreamBuilder<QuerySnapshot<Data>>(
    stream: recent,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return const Center(child: Text('Trips could not be loaded.'));
      }
      final first = snapshot.data?.docs;
      if (first == null) {
        return const Center(child: CircularProgressIndicator());
      }
      final trips = {
        ...{for (final doc in older) doc.id: doc},
        ...{for (final doc in first) doc.id: doc},
      };
      final ids = <dynamic>{
        ...first.map((doc) => doc.id),
        ...older.map((doc) => doc.id),
      }.toList();
      return ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Your trips', style: Theme.of(context).textTheme.headlineMedium),
          if (ids.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 16),
              child: Text('Your ride and delivery requests will appear here.'),
            ),
          for (final id in ids)
            Card(
              child: ListTile(
                leading: Icon(
                  trips[id]!.data()['category'] == 'ride'
                      ? Icons.directions_car
                      : Icons.inventory_2_outlined,
                  color: blue,
                ),
                title: Text(trips[id]!.data()['service'] as String),
                subtitle: Text(
                  '${trips[id]!.data()['destination']}\n${statusLabel(trips[id]!.data()['status'])}',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => TripDetails(uid: widget.uid, id: id),
                  ),
                ),
              ),
            ),
          if (first.length == 20 && more)
            TextButton(
              onPressed: loading ? null : () => loadNext(first),
              child: Text(loading ? 'Loading…' : 'Load older trips'),
            ),
        ],
      );
    },
  );
}

String statusLabel(dynamic status) => switch (status) {
  'requested' => 'Requested',
  'assigned' => 'Driver assigned',
  'en_route' => 'Driver en route',
  'in_progress' => 'In progress',
  'completed' => 'Completed',
  'cancelled' => 'Cancelled',
  _ => 'Pending',
};

class TripDetails extends StatefulWidget {
  const TripDetails({required this.uid, required this.id, super.key});
  final String uid;
  final String id;
  @override
  State<TripDetails> createState() => _TripDetailsState();
}

class _TripDetailsState extends State<TripDetails> {
  late final trip = db.collection('trips').doc(widget.id);
  late final Stream<DocumentSnapshot<Data>> updates = trip.snapshots();
  late final Stream<DocumentSnapshot<Data>> position = trip
      .collection('live')
      .doc('position')
      .snapshots();
  late final review = trip.collection('reviews').doc(widget.uid);
  late final Stream<DocumentSnapshot<Data>> reviews = review.snapshots();

  Future<void> openPayment(String? orderId) async {
    const configured = String.fromEnvironment(
      'ED_PAYMENT_ORIGIN',
      defaultValue: 'https://eds-transport-alberta.seasonalkrill3.chatgpt.site',
    );
    final origin = Uri.tryParse(configured);
    if (origin == null || origin.scheme != 'https' || origin.host.isEmpty) {
      notify(context, 'The payment website is unavailable.');
      return;
    }
    final uri = origin.replace(
      path: '/pay/',
      queryParameters: {
        'kind': orderId == null ? 'trip' : 'order',
        'ref': orderId ?? widget.id,
      },
    );
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
    } catch (_) {
      // Keep the booking visible when the device cannot open a browser.
    }
    if (mounted) notify(context, 'Could not open the payment website.');
  }

  Future<void> addReview() async {
    final result = await showDialog<Data>(
      context: context,
      builder: (_) => const ReviewDialog(),
    );
    if (result == null || !mounted) return;
    try {
      await review.set({...result, 'createdAt': FieldValue.serverTimestamp()});
      if (mounted) notify(context, 'Review submitted.');
    } catch (error) {
      if (mounted) notify(context, message(error));
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Booking details')),
    body: StreamBuilder<DocumentSnapshot<Data>>(
      stream: updates,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const Center(child: Text('This booking is unavailable.'));
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final data = snapshot.data?.data();
        if (data == null) {
          return const Center(child: Text('Booking unavailable.'));
        }
        final driver = data['driver'] as Map<String, dynamic>?;
        final scheduled = data['scheduledAt'] as Timestamp?;
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              data['service'] as String,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            Text(
              statusLabel(data['status']),
              style: const TextStyle(color: blue, fontWeight: FontWeight.w800),
            ),
            Text('Reference ${widget.id}'),
            if (data['status'] != 'cancelled')
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(
                  onPressed: () =>
                      openPayment(data['marketOrderId'] as String?),
                  child: const Text('Payment options'),
                ),
              ),
            const SizedBox(height: 16),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: const Icon(Icons.my_location),
                    title: Text(data['pickup'] as String),
                    subtitle: const Text('Pickup'),
                  ),
                  ListTile(
                    leading: const Icon(Icons.location_on_outlined),
                    title: Text(data['destination'] as String),
                    subtitle: const Text('Destination'),
                  ),
                  if (scheduled != null)
                    ListTile(
                      leading: const Icon(Icons.schedule),
                      title: Text(
                        '${MaterialLocalizations.of(context).formatMediumDate(scheduled.toDate())} · ${TimeOfDay.fromDateTime(scheduled.toDate()).format(context)}',
                      ),
                      subtitle: const Text('Scheduled pickup (device time)'),
                    ),
                  if ((data['pickupDetails'] as String? ?? '').isNotEmpty)
                    ListTile(
                      leading: const Icon(Icons.notes),
                      title: Text(data['pickupDetails'] as String),
                      subtitle: const Text('Pickup instructions'),
                    ),
                ],
              ),
            ),
            if (driver != null)
              Card(
                child: ListTile(
                  leading: const CircleAvatar(
                    child: Icon(Icons.person_outline),
                  ),
                  title: Text(driver['name'] as String),
                  subtitle: Text(
                    [
                      driver['vehicle'],
                      driver['plate'],
                    ].where((x) => x != null && x != '').join(' · '),
                  ),
                ),
              ),
            if (liveStatuses.contains(data['status'])) ...[
              const SizedBox(height: 14),
              const Text(
                'Live driver location',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19),
              ),
              StreamBuilder<DocumentSnapshot<Data>>(
                stream: position,
                builder: (context, snapshot) {
                  final point = snapshot.data?.data();
                  if (snapshot.hasError) {
                    return const Text('Location is unavailable.');
                  }
                  if (point == null) {
                    return const Text(
                      'Waiting for a location update from your driver.',
                    );
                  }
                  return DriverMap(point: point);
                },
              ),
            ],
            if (data['status'] == 'completed')
              StreamBuilder<DocumentSnapshot<Data>>(
                stream: reviews,
                builder: (context, snapshot) {
                  if (snapshot.hasError) {
                    return const Text('Review could not be loaded.');
                  }
                  if (!snapshot.hasData) return const LinearProgressIndicator();
                  final item = snapshot.data?.data();
                  return item == null
                      ? FilledButton(
                          onPressed: addReview,
                          child: const Text('Rate your trip'),
                        )
                      : Card(
                          child: ListTile(
                            leading: const Icon(Icons.star, color: blue),
                            title: Text('Your review · ${item['rating']}/5'),
                            subtitle: Text(item['comment'] as String),
                          ),
                        );
                },
              ),
          ],
        );
      },
    ),
  );
}

class DriverMap extends StatefulWidget {
  const DriverMap({required this.point, super.key});
  final Data point;
  @override
  State<DriverMap> createState() => _DriverMapState();
}

class _DriverMapState extends State<DriverMap> {
  final controller = MapController();
  bool ready = false;
  LatLng get position => LatLng(
    (widget.point['latitude'] as num).toDouble(),
    (widget.point['longitude'] as num).toDouble(),
  );
  static const tileUrl = String.fromEnvironment(
    'MAP_TILES',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );
  static const attribution = String.fromEnvironment(
    'MAP_ATTRIBUTION',
    defaultValue: '© OpenStreetMap contributors',
  );

  @override
  void didUpdateWidget(covariant DriverMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (ready &&
        (oldWidget.point['latitude'] != widget.point['latitude'] ||
            oldWidget.point['longitude'] != widget.point['longitude'])) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && ready) controller.move(position, controller.camera.zoom);
      });
    }
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final last = widget.point['updatedAt'] as Timestamp?;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (last != null)
          Text(
            'Last update ${TimeOfDay.fromDateTime(last.toDate()).format(context)}',
          ),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            height: 260,
            child: FlutterMap(
              mapController: controller,
              options: MapOptions(
                initialCenter: position,
                initialZoom: 15,
                onMapReady: () => ready = true,
              ),
              children: [
                TileLayer(
                  urlTemplate: tileUrl,
                  userAgentPackageName: 'ca.edstransport.customer',
                ),
                MarkerLayer(
                  markers: [
                    Marker(
                      point: position,
                      width: 42,
                      height: 42,
                      child: const CircleAvatar(
                        backgroundColor: blue,
                        foregroundColor: gold,
                        child: Icon(
                          Icons.directions_car,
                          semanticLabel: 'Driver location',
                        ),
                      ),
                    ),
                  ],
                ),
                SimpleAttributionWidget(source: Text(attribution)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class ReviewDialog extends StatefulWidget {
  const ReviewDialog({super.key});
  @override
  State<ReviewDialog> createState() => _ReviewDialogState();
}

class _ReviewDialogState extends State<ReviewDialog> {
  int rating = 5;
  final comment = TextEditingController();
  @override
  void dispose() {
    comment.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Rate your trip'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          DropdownButtonFormField<int>(
            initialValue: rating,
            decoration: const InputDecoration(labelText: 'Stars'),
            items: [
              for (var i = 1; i <= 5; i++)
                DropdownMenuItem(value: i, child: Text('$i of 5')),
            ],
            onChanged: (value) {
              if (value != null) setState(() => rating = value);
            },
          ),
          const SizedBox(height: 12),
          Field('Review (optional)', comment, max: 1000, lines: 3),
        ],
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, {
          'rating': rating,
          'comment': comment.text.trim(),
        }),
        child: const Text('Submit'),
      ),
    ],
  );
}

class Profile extends StatefulWidget {
  const Profile({
    required this.user,
    required this.notifications,
    required this.signOut,
    super.key,
  });
  final User user;
  final Future<void> Function() notifications;
  final Future<void> Function() signOut;
  @override
  State<Profile> createState() => _ProfileState();
}

class _ProfileState extends State<Profile> {
  final fields = <String, TextEditingController>{
    'name': TextEditingController(),
    'address': TextEditingController(),
    'favoriteLocations': TextEditingController(),
    'emergencyContact': TextEditingController(),
  };
  late final ref = db.collection('customers').doc(widget.user.uid);
  bool loading = true;
  bool loaded = false;
  bool saving = false;
  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    for (final field in fields.values) {
      field.dispose();
    }
    super.dispose();
  }

  Future<void> load() async {
    if (!loading) setState(() => loading = true);
    try {
      final data = (await ref.get()).data() ?? {};
      if (!mounted) return;
      for (final entry in fields.entries) {
        entry.value.text =
            (data[entry.key] as String?) ??
            (entry.key == 'name' ? widget.user.displayName ?? '' : '');
      }
      setState(() => loaded = true);
    } catch (error) {
      if (mounted) notify(context, message(error));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> save() async {
    setState(() => saving = true);
    try {
      await ref.set({
        for (final entry in fields.entries) entry.key: entry.value.text.trim(),
      });
      if (mounted) notify(context, 'Profile saved.');
    } catch (error) {
      if (mounted) notify(context, message(error));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(20),
    children: [
      Text('Your profile', style: Theme.of(context).textTheme.headlineMedium),
      Text(widget.user.email ?? widget.user.phoneNumber ?? ''),
      const SizedBox(height: 16),
      if (loading)
        const LinearProgressIndicator()
      else if (!loaded)
        OutlinedButton(
          onPressed: load,
          child: const Text('Retry loading profile'),
        )
      else ...[
        Field('Name', fields['name']!, max: 100),
        Field('Address', fields['address']!, max: 250),
        Field(
          'Favorite locations (one per line)',
          fields['favoriteLocations']!,
          max: 1000,
          lines: 3,
        ),
        Field(
          'Emergency contact name and phone',
          fields['emergencyContact']!,
          max: 250,
        ),
        FilledButton(
          onPressed: saving ? null : save,
          child: Text(saving ? 'Saving…' : 'Save profile'),
        ),
      ],
      OutlinedButton.icon(
        onPressed: widget.notifications,
        icon: const Icon(Icons.notifications_outlined),
        label: const Text('Enable push notifications'),
      ),
      TextButton(onPressed: widget.signOut, child: const Text('Sign out')),
    ],
  );
}

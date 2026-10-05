import { Linking } from 'react-native';
import Constants from 'expo-constants';

// ---------------------------------------------------------------------------
//  Push notifications in the iOS / Android app — OneSignal's native SDK
//  (react-native-onesignal, set up by onesignal-expo-plugin).
//
//  Metro picks this file instead of lib/push.js on iOS and Android, so every
//  `import … from '../lib/push'` keeps working. It has the same exports as the
//  web module (lib/push.js); the web one is untouched.
//
//  It is the SAME OneSignal app as the website, and OneSignal.login() uses the
//  same external id (the Supabase user id), so the database's pushes
//  (include_aliases.external_id, supabase/26_native_push.sql) reach the phone
//  app, the browser, or both, with nothing else to change.
//
//  The permission prompt is never shown on launch — only when the student
//  taps "Turn on notifications" (feed strip / profile), see promptPush().
// ---------------------------------------------------------------------------

// Loaded defensively: in Expo Go, or a build made before the plugin was
// added, the native module is missing — push is then simply off instead of
// the whole app crashing on start.
let OneSignal = null;
try {
  // eslint-disable-next-line global-require
  OneSignal = require('react-native-onesignal').OneSignal || null;
} catch (e) {
  OneSignal = null;
}

const FALLBACK_APP_ID = 'abfc69f5-a74e-45ae-8e4b-0d42369acd05';
const APP_ID = Constants.expoConfig?.extra?.oneSignalAppId || FALLBACK_APP_ID;
export const pushConfigured = !!APP_ID && !String(APP_ID).startsWith('PASTE_') && !!OneSignal;

// Links in pushes from older rows / the web's launch URL.
const WEB_ORIGIN = 'https://tadbirly.expo.app';

const SDK_TIMEOUT_MS = 8000;
const TIMED_OUT = 'timed-out';

function withTimeout(promise, ms = SDK_TIMEOUT_MS) {
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}

async function safe(fn, fallback) {
  try {
    const v = await withTimeout(fn());
    return v === TIMED_OUT ? fallback : v;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
//  Taps and foreground pushes
// ---------------------------------------------------------------------------

// The app path a notification should open: data.link (set by send_push()),
// else the path of its launch URL (pushes sent before 26_native_push.sql).
function linkOf(notification, result) {
  const data = notification?.additionalData || {};
  if (typeof data.link === 'string' && data.link.trim()) return data.link.trim();
  const url = result?.url || notification?.launchURL;
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('/')) return url;
  if (url.startsWith(WEB_ORIGIN)) return url.slice(WEB_ORIGIN.length) || '/';
  return null; // somewhere else entirely — just opening the app is enough
}

// Who opens a tapped push. Registered by components/NotificationToast.js,
// which lives inside the navigator and knows when the router is ready. A tap
// that launched the app arrives before that, so it waits here.
let openHandler = null;
let pendingLink = null;

/**
 * setPushRouter(open) — open(link) navigates to an in-app link.
 * Returns an unregister function. Delivers a tap that arrived earlier.
 */
export function setPushRouter(open) {
  openHandler = typeof open === 'function' ? open : null;
  if (openHandler && pendingLink) {
    const l = pendingLink;
    pendingLink = null;
    try { openHandler(l); } catch (e) { console.warn('[Tadbirly] opening push link failed', e); }
  }
  return () => { if (openHandler === open) openHandler = null; };
}

function onClick(event) {
  const link = linkOf(event?.notification, event?.result);
  if (!link) return;
  if (openHandler) {
    try { openHandler(link); } catch (e) { console.warn('[Tadbirly] opening push link failed', e); }
  } else {
    pendingLink = link;
  }
}

// While the app is open, the in-app toast shows notifications instead of the
// system banner (no double alert). Only while a toast is listening — signed
// out, or before it mounts, the system banner shows as usual.
const foregroundListeners = new Set();

/** onPushForeground(fn) — fn({ title, body, link }) for pushes arriving in the foreground. */
export function onPushForeground(fn) {
  foregroundListeners.add(fn);
  return () => foregroundListeners.delete(fn);
}

function onForeground(event) {
  if (!foregroundListeners.size) return; // let OneSignal display it
  try { event.preventDefault(); } catch { return; }
  const n = typeof event.getNotification === 'function' ? event.getNotification() : event.notification;
  // send_push() fills an empty body with 'Open Tadbirly'; undo that so the
  // toast matches the notification row (and NotificationToast can de-dupe).
  const body = n?.body && n.body !== 'Open Tadbirly' ? n.body : '';
  const item = { title: n?.title || 'Tadbirly', body, link: linkOf(n, null) };
  foregroundListeners.forEach((fn) => { try { fn(item); } catch { /* ignore */ } });
}

// ---------------------------------------------------------------------------
//  Start-up and account
// ---------------------------------------------------------------------------
let started = false;

// Starts the SDK and the listeners. Called once at launch from lib/auth.js.
// Does NOT ask for permission.
export function initPush() {
  if (!pushConfigured) return Promise.resolve(false);
  if (started) return Promise.resolve(true);
  try {
    OneSignal.initialize(APP_ID);
    // Registered straight away, so a tap that launched the app isn't lost.
    OneSignal.Notifications.addEventListener('click', onClick);
    OneSignal.Notifications.addEventListener('foregroundWillDisplay', onForeground);
    started = true;
  } catch (e) {
    console.warn('[Tadbirly] OneSignal init failed', e);
    return Promise.resolve(false);
  }
  return Promise.resolve(true);
}

let loggedInAs = null;

// Ties this phone to the account (external id = Supabase user id) — the link
// the database's pushes target. Works before permission is granted: the
// subscription joins the account as soon as it exists.
export function pushLogin(userId) {
  if (!userId || !pushConfigured) return;
  if (!started) initPush();
  const uid = String(userId);
  if (loggedInAs === uid) return;
  try {
    OneSignal.login(uid);
    loggedInAs = uid;
  } catch (e) {
    console.warn('[Tadbirly] OneSignal login failed', e);
  }
}

export function pushLogout() {
  loggedInAs = null;
  pendingLink = null;
  if (!pushConfigured || !started) return;
  try { OneSignal.logout(); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
//  Permission
// ---------------------------------------------------------------------------

// 'granted' | 'default' (never asked — the system prompt can still show) |
// 'denied' (only Settings can change it) | 'unsupported' (no native module).
export async function pushPermission() {
  if (!pushConfigured) return 'unsupported';
  if (!started) await initPush();
  const granted = await safe(() => OneSignal.Notifications.getPermissionAsync(), null);
  if (granted === true) return 'granted';
  const canAsk = await safe(() => OneSignal.Notifications.canRequestPermission(), null);
  if (canAsk === true) return 'default';
  if (canAsk === false) return 'denied';
  return granted === false ? 'denied' : 'unsupported';
}

// Opens Tadbirly's page in the phone's Settings (to switch notifications back on).
export function openPushSettings() {
  return Linking.openSettings().then(() => true, () => false);
}

// Called from a tap ("Turn on notifications"). Shows the system prompt if it
// can, and links this phone to the account. Already denied → resolves
// 'denied' without showing anything; the caller offers openPushSettings().
// Resolves to 'granted' | 'denied' | 'default' | 'unsupported'.
export async function promptPush(userId) {
  if (!pushConfigured) return 'unsupported';
  if (!started) await initPush();
  if (userId) pushLogin(userId);

  const before = await pushPermission();
  if (before === 'denied' || before === 'unsupported') return before;

  // true = if the OS refuses to show the prompt, OneSignal offers Settings.
  // No timeout here: the system sheet waits for the student as long as needed.
  let granted = null;
  try { granted = await OneSignal.Notifications.requestPermission(true); } catch { granted = null; }
  const after = granted === true ? 'granted' : await pushPermission();
  if (after === 'granted') {
    // Clears a stale "opted out" flag, so the subscription is active.
    try { OneSignal.User.pushSubscription.optIn(); } catch { /* ignore */ }
  }
  return after;
}

// What OneSignal thinks this phone is — the status line on the profile screen.
// Same shape as the web's: nativePermission, sdkReady, permission, optedIn,
// subscriptionId, externalId (+ native: true).
export async function pushDebug() {
  if (!pushConfigured) return { configured: false, native: true };
  if (!started) await initPush();
  const nativePermission = await pushPermission();
  const [permission, optedIn, subscriptionId, externalId] = await Promise.all([
    safe(() => OneSignal.Notifications.getPermissionAsync(), undefined),
    safe(() => OneSignal.User.pushSubscription.getOptedInAsync(), undefined),
    safe(() => OneSignal.User.pushSubscription.getIdAsync(), undefined),
    safe(() => OneSignal.User.getExternalId(), undefined),
  ]);
  return {
    configured: true,
    native: true,
    supported: true,
    nativePermission,
    sdkReady: permission !== undefined,
    permission,
    optedIn,
    subscriptionId: subscriptionId || null,
    externalId: externalId || null,
  };
}

export function pushEnabled() {
  return false; // synchronous answer unknown natively — use pushPermission()
}

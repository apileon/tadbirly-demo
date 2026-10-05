import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { notificationState } from './feedback';

// ---------------------------------------------------------------------------
//  Push notifications via OneSignal — the WEB (PWA) version.
//
//  These reach a phone even when Tadbirly is fully closed. On iPhone this only
//  works once the app has been added to the Home Screen (iOS 16.4+), which is
//  why the install banner matters.
//
//  The iOS / Android app uses lib/push.native.js instead (Metro picks it by
//  platform). Both files have the same exports; keep them in step.
// ---------------------------------------------------------------------------

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

// The App ID is public by design — it ships in the page source of every site
// using OneSignal. Hardcoded because Expo caches app.json's `extra` and the
// value can silently fail to reach the bundle.
const FALLBACK_APP_ID = 'abfc69f5-a74e-45ae-8e4b-0d42369acd05';
const APP_ID = Constants.expoConfig?.extra?.oneSignalAppId || FALLBACK_APP_ID;
export const pushConfigured = !!APP_ID && !String(APP_ID).startsWith('PASTE_');

// OneSignal calls go over the network and through the service worker, and can
// stall on a bad connection. No screen should sit on a spinner because of it.
const SDK_TIMEOUT_MS = 15000;
const TIMED_OUT = 'timed-out';

function withTimeout(promise, ms = SDK_TIMEOUT_MS) {
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); });
  return Promise.race([Promise.resolve(promise), limit]).finally(() => clearTimeout(timer));
}

let readyPromise = null;

function loadScript() {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-onesignal]')) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
    s.defer = true;
    s.setAttribute('data-onesignal', '1');
    s.onload = resolve;
    // Remove the dead tag, otherwise the retry below would see it, assume the
    // SDK is there, and wait forever for it to start.
    s.onerror = (e) => { s.remove(); reject(e); };
    document.head.appendChild(s);
  });
}

// Loads and starts the SDK. Resolves only once init() has actually finished,
// so anything that depends on it (like login) can safely await this.
export function initPush() {
  if (!isWeb || !pushConfigured) return Promise.resolve(false);
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    try {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      await loadScript();
      await new Promise((resolve) => {
        window.OneSignalDeferred.push(async (OneSignal) => {
          try {
            await OneSignal.init({
              appId: APP_ID,
              allowLocalhostAsSecureOrigin: true,
              autoResubscribe: true,
            });
          } catch (e) {
            console.warn('[Tadbirly] OneSignal init failed', e);
          }
          resolve();
        });
      });
      return true;
    } catch (e) {
      readyPromise = null; // allow a retry later
      return false;
    }
  })();

  return readyPromise;
}

// Runs a callback once init has completed and resolves with its result
// (undefined when push isn't available or the call failed).
async function afterReady(fn) {
  if (!isWeb || !pushConfigured) return undefined;
  const ok = await initPush();
  if (!ok) return undefined;
  return new Promise((resolve) => {
    window.OneSignalDeferred.push(async (OneSignal) => {
      try { resolve(await fn(OneSignal)); } catch (e) {
        console.warn('[Tadbirly] OneSignal call failed', e);
        resolve(undefined);
      }
    });
  });
}

// Makes sure this browser has a live, opted-in OneSignal subscription. Only
// acts once the browser has already said yes — it never shows a prompt.
//   force = re-register even if OneSignal thinks all is well (right after the
//           user tapped Allow, when the SDK's own view is often stale).
async function subscribeThisBrowser(OneSignal, force) {
  if (notificationState() !== 'granted') return;
  const sub = () => OneSignal.User && OneSignal.User.PushSubscription;
  if (!force && sub()?.id && sub()?.optedIn) return;

  // Clears a stale "opted out" flag, so the subscription counts as active.
  await withTimeout(sub()?.optIn?.());

  // With permission already granted, optIn() only flips that flag — it does
  // NOT create a missing subscription (v16 SDK, PushSubscriptionNamespace).
  // requestPermission() shows no prompt in that state and goes straight to
  // subscribing this browser and registering it with OneSignal. It also makes
  // the SDK notice a permission we granted outside it, which Safari's
  // permission-change event never reports.
  if (force || !sub()?.id || !sub()?.optedIn) {
    await withTimeout(OneSignal.Notifications?.requestPermission?.());
  }
}

// Subscription first, then login: login() moves an existing subscription onto
// the account, which is the link the database's pushes target.
async function linkDevice(OneSignal, userId, force) {
  await subscribeThisBrowser(OneSignal, force);
  if (userId) await withTimeout(OneSignal.login(String(userId)));
  return true;
}

// Collapses the burst of pushLogin calls at startup (getSession and the auth
// listener both fire) into one run per account.
let linking = null;

// Ties this browser to a Tadbirly account so the database can target them.
// Called on every app launch and sign-in. If the browser allows notifications
// but OneSignal lost its subscription (cleared data, a failed first attempt,
// permission granted outside the SDK), this is where it gets repaired.
export function pushLogin(userId) {
  if (!userId || !isWeb || !pushConfigured) return;
  const uid = String(userId);
  if (linking && linking.uid === uid) return;
  const job = { uid };
  job.done = withTimeout(afterReady((OneSignal) => linkDevice(OneSignal, uid, false)), SDK_TIMEOUT_MS * 3)
    .finally(() => { if (linking === job) linking = null; });
  linking = job;
}

export function pushLogout() {
  linking = null;
  afterReady((OneSignal) => OneSignal.logout());
}

// Native permission request, started synchronously. Handles both the promise
// form and the old callback-only form of Notification.requestPermission.
function askNative() {
  if (!isWeb || typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') {
    return Promise.resolve('unsupported');
  }
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
  return new Promise((resolve) => {
    try {
      const p = Notification.requestPermission((r) => resolve(r));
      if (p && typeof p.then === 'function') p.then(resolve, () => resolve(Notification.permission));
    } catch {
      resolve(Notification.permission);
    }
  });
}

// Asks for permission and, once granted, subscribes this browser and links it
// to the account.
//
// MUST be the first thing a tap handler does — no await before it. iPhones only
// show the permission sheet while the tap is still being handled; OneSignal's
// own requestPermission() gets to the browser prompt only after several awaits
// (SDK load, IndexedDB), by which time Safari has forgotten the tap. So the
// browser is asked directly, right here, and OneSignal is brought in after.
//
// Resolves to 'granted' | 'denied' | 'default' | 'unsupported' once linking has
// finished (or given up waiting — it keeps going in the background, and the
// next launch repairs anything left over).
export function promptPush(userId) {
  const asked = askNative();
  return asked.then(async (result) => {
    if (result === 'granted' && isWeb && pushConfigured) {
      await withTimeout(afterReady((OneSignal) => linkDevice(OneSignal, userId, true)));
    }
    return result;
  });
}

// What OneSignal thinks this device is — shown under the notification button
// on the profile screen, so it's visible which step is missing when pushes
// don't arrive.
export async function pushDebug() {
  if (!isWeb || !pushConfigured) return { configured: false };
  const base = {
    configured: true,
    nativePermission: notificationState(), // 'granted' | 'denied' | 'default' | 'unsupported'
    supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window,
  };
  const info = await withTimeout(afterReady((OneSignal) => ({
    permission: OneSignal?.Notifications?.permission,
    optedIn: OneSignal?.User?.PushSubscription?.optedIn,
    subscriptionId: OneSignal?.User?.PushSubscription?.id,
    externalId: OneSignal?.User?.externalId,
  })), 8000);
  if (!info || info === TIMED_OUT) return { ...base, sdkReady: false };
  return { ...base, sdkReady: true, ...info };
}

export function pushEnabled() {
  if (!isWeb || !pushConfigured) return false;
  try { return !!window.OneSignal?.Notifications?.permission; } catch { return false; }
}

// ---------------------------------------------------------------------------
//  Shared API with lib/push.native.js. On the web these change nothing:
//  OneSignal's service worker opens the push's own URL when it's tapped, and
//  the browser shows pushes itself.
// ---------------------------------------------------------------------------
const noop = () => {};

// Native: who opens a tapped push. Web: not needed.
export function setPushRouter() { return noop; }

// Native: pushes arriving while the app is open. Web: never called.
export function onPushForeground() { return noop; }

// 'granted' | 'default' | 'denied' | 'unsupported' — the browser's answer.
export function pushPermission() {
  return Promise.resolve(notificationState());
}

// Browsers can't be sent to their settings page.
export function openPushSettings() {
  return Promise.resolve(false);
}

import { supabase } from './supabase';
import { t } from './i18n';

// ---------------------------------------------------------------------------
//  Telegram notifications
//
//  A student connects their Telegram once (Profile → Connect Telegram); from
//  then on the database sends each notification to that chat through our bot.
//  Works on any phone — including iPhones, which only get web push once
//  Tadbirly is on the Home Screen. The connecting itself happens inside
//  Telegram: the t.me link carries a one-time code, and pressing Start there
//  hands it to the bot (supabase/24_telegram.sql, functions/telegram-webhook).
//
//  Every call resolves to { data, error } and never throws. Until
//  24_telegram.sql has been run the calls simply return an error, which the
//  screens treat as "Telegram isn't available".
// ---------------------------------------------------------------------------

async function call(fn, args) {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    return { data: data ?? null, error: error ?? null };
  } catch (e) {
    return { data: null, error: { message: e?.message || String(e) } };
  }
}

// data: { available, linked, username, also_push }
//   available — the bot is set up, so the Telegram option should be shown
//   also_push — browser notifications are wanted as well
export function telegramStatus() {
  return call('telegram_status');
}

// data: a https://t.me/<bot>?start=<code> link. The code is single-use and
// valid for an hour.
export async function telegramLinkUrl() {
  const { data, error } = await call('telegram_link_start');
  if (error) return { data: null, error };
  const url = typeof data?.url === 'string' ? data.url : null;
  if (!url) return { data: null, error: { message: t('Telegram link is missing — please try again.') } };
  return { data: url, error: null };
}

export function telegramUnlink() {
  return call('telegram_unlink');
}

export function telegramSetAlsoPush(v) {
  return call('telegram_set_also_push', { v: !!v });
}

// ---------------------------------------------------------------------------
//  The link, fetched before the tap
//
//  A browser only lets a tap open a new tab if nothing is awaited first —
//  otherwise it's a "popup" and gets blocked (iPhone Safari is the
//  strictest). So the Profile screen fetches the link as soon as it's shown,
//  keeps it here, and the Connect button opens it on the spot. Kept per
//  account: a link from one account must never be opened by the next person
//  who signs in on this device — it would connect their Telegram to the
//  first account.
// ---------------------------------------------------------------------------
const LINK_FRESH_MS = 50 * 60 * 1000;   // the code itself expires after 60
const RETRY_AFTER_FAIL_MS = 30 * 1000;  // a failed fetch isn't hammered

let cached = { uid: null, url: null, at: 0 };
let inFlight = null;                    // { uid, promise }
let failed = { uid: null, at: 0, error: null };

// The prefetched link if it's still fresh, else null.
export function readyTelegramLink(uid) {
  if (!uid || cached.uid !== uid || !cached.url) return null;
  return Date.now() - cached.at < LINK_FRESH_MS ? cached.url : null;
}

// Makes sure a fresh link is ready. `force` fetches a new one even if the
// current one is still fresh — used right after a tap, so the next tap gets
// an unused code. The old link stays usable until the new one arrives, and
// stays valid on the server either way.
export function prefetchTelegramLink(uid, { force = false } = {}) {
  if (!uid) return Promise.resolve({ data: null, error: { message: t('Not signed in') } });
  if (!force) {
    const ready = readyTelegramLink(uid);
    if (ready) return Promise.resolve({ data: ready, error: null });
    if (failed.uid === uid && Date.now() - failed.at < RETRY_AFTER_FAIL_MS) {
      return Promise.resolve({ data: null, error: failed.error });
    }
  }
  if (inFlight && inFlight.uid === uid) return inFlight.promise;

  const promise = telegramLinkUrl().then((res) => {
    if (res.data) {
      cached = { uid, url: res.data, at: Date.now() };
      failed = { uid: null, at: 0, error: null };
    } else {
      failed = { uid, at: Date.now(), error: res.error };
    }
    return res;
  });
  const job = { uid, promise };
  inFlight = job;
  promise.finally(() => { if (inFlight === job) inFlight = null; });
  return promise;
}

// Linking spends every code the account had open, so a cached link is dead
// the moment the account is connected.
export function forgetTelegramLink() {
  cached = { uid: null, url: null, at: 0 };
}

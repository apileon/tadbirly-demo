import { Platform, Vibration } from 'react-native';
import { notify } from './notify';
import { t } from './i18n';

// Only true in a real browser. Natively `window` exists too, but it has no
// document / addEventListener / Notification, so never touch it there.
const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
const isNative = Platform.OS !== 'web';

// What notificationState() / askNotificationPermission() return in the native
// app: web Notification permission doesn't apply there — push permission is
// owned by lib/push.js (OneSignal / expo-notifications). Callers should treat
// 'native' as "not a browser — don't show any web instructions".
export const NATIVE_PERMISSION = 'native';

// ---------------------------------------------------------------------------
//  Sound
//  Generated with the Web Audio API so there's no audio file to download —
//  a short two-note "ping", the same shape messengers use.
//  Native: a no-op — the push notification itself plays the system sound,
//  and an in-app toast is accompanied by a haptic buzz() instead.
// ---------------------------------------------------------------------------
let ctx = null;

export function ping(volume = 0.16) {
  if (!isWeb) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1180, t + 0.09);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.start(t);
    osc.stop(t + 0.32);
  } catch { /* audio blocked until the user interacts — fine */ }
}

// Browsers block audio until the user has interacted with the page once.
// Call this on the first tap so later notifications can actually make a sound.
export function unlockAudio() {
  if (!isWeb) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = ctx || new AC();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
//  Vibration
// ---------------------------------------------------------------------------
//  Native: expo-haptics — a "success" notification tap for the default
//  double-buzz pattern, a single impact for a single-number pattern. Falls
//  back to the plain vibrator if haptics aren't available.
export function buzz(pattern = [35, 60, 35]) {
  try {
    if (isWeb) {
      if (navigator.vibrate) navigator.vibrate(pattern);
      return;
    }
    if (!isNative) return;
    let Haptics = null;
    try { Haptics = require('expo-haptics'); } catch { Haptics = null; }
    if (Haptics && Haptics.notificationAsync) {
      const single = typeof pattern === 'number' || (Array.isArray(pattern) && pattern.length <= 1);
      const p = single
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (p && p.catch) p.catch(() => { try { Vibration.vibrate(pattern); } catch { /* ignore */ } });
      return;
    }
    Vibration.vibrate(pattern);
  } catch { /* unsupported, ignore */ }
}

// ---------------------------------------------------------------------------
//  System notifications (the ones that appear outside the app window)
// ---------------------------------------------------------------------------
// Web: 'default' | 'granted' | 'denied' | 'unsupported'.
// Native: always NATIVE_PERMISSION ('native') — ask lib/push.js for the real
// OS push permission.
export function notificationState() {
  if (isNative) return NATIVE_PERMISSION;
  if (!isWeb || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function askNotificationPermission() {
  if (isNative) return NATIVE_PERMISSION; // lib/push.js asks the OS natively
  if (!isWeb || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// Shows a real OS notification. Works whenever Tadbirly is running —
// including when it's in a background tab or minimised.
export function systemNotify(title, body, onClick) {
  if (!isWeb || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, { body: body || '', icon: '/favicon.ico', tag: 'tadbirly' });
    n.onclick = () => {
      try { window.focus(); } catch { /* ignore */ }
      n.close();
      if (onClick) onClick();
    };
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
//  Install state
// ---------------------------------------------------------------------------
export function isInstalled() {
  if (!isWeb) return true;
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch {
    return false;
  }
}

export function isIOS() {
  if (isNative) return Platform.OS === 'ios';
  if (!isWeb) return false;
  try {
    if (/iphone|ipad|ipod/i.test(navigator.userAgent || '')) return true;
    // iPadOS Safari pretends to be a Mac ("Macintosh" UA, MacIntel platform);
    // the touch screen is what gives it away.
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
//  In-app browsers
//  Most Tadbirly links are opened from Telegram, whose built-in browser (like
//  Instagram's, Facebook's and TikTok's) can't do web push, and whose login
//  doesn't carry over to Safari/Chrome. Detect it so we can send people to a
//  real browser instead of showing a notification prompt that can't work.
// ---------------------------------------------------------------------------

// 'Telegram' | 'Instagram' | 'Facebook' | 'TikTok' | 'app' | null
export function inAppBrowser() {
  if (!isWeb) return null;
  try {
    const ua = navigator.userAgent || '';
    if (window.TelegramWebviewProxy || /Telegram/i.test(ua)) return 'Telegram';
    if (/Instagram/i.test(ua)) return 'Instagram';
    if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)) return 'Facebook';
    if (/musical_ly|Bytedance|TikTok/i.test(ua)) return 'TikTok';
    // Android System WebView marks itself with "; wv)".
    if (/Android/i.test(ua) && /; wv\)/i.test(ua)) return 'app';
    // Every real iOS browser (Safari, Chrome, Firefox, Edge) keeps "Safari/" in
    // its UA; a bare WKWebView inside another app doesn't. A Home Screen web
    // app doesn't either, so installed Tadbirly is excluded.
    if (isIOS() && !/Safari\//.test(ua) && !isInstalled()) return 'app';
  } catch { /* ignore */ }
  return null;
}

// The words shown wherever we explain the in-app browser problem, so the
// install banner, the feed strip and the profile button all say the same thing.
export function inAppGuidance(app = inAppBrowser()) {
  // (Natively inAppBrowser() is always null, so this is only reached on the web.)
  const who = !app || app === 'app' ? t('This in-app browser') : t('{app}’s built-in browser', { app });
  const how = isIOS() ? t('Tap ⋯ → Open in Safari') : t('Tap ⋮ → Open in browser');
  return {
    title: t('Open Tadbirly in your browser'),
    body: `${who} can’t send notifications. ${how}.`,
    browser: isIOS() ? 'Safari' : 'Chrome',
  };
}

// Why notifications can't be switched on from here, and what to do instead —
// or null when a normal permission prompt can work.
export function notificationHelp(perm = notificationState()) {
  if (isNative) {
    // In the real app the only fix is the phone's Settings; never show web steps.
    if (perm !== 'denied') return null;
    return {
      title: t('Notifications are blocked'),
      body: Platform.OS === 'ios'
        ? t('Open Settings → Notifications → Tadbirly and switch on Allow Notifications.')
        : t('Open Settings → Apps → Tadbirly → Notifications, and allow them.'),
    };
  }
  const app = inAppBrowser();
  if (app) return inAppGuidance(app);
  if (perm === 'denied') {
    return {
      title: t('Notifications are blocked'),
      body: isIOS()
        ? 'Open Settings → Notifications → Tadbirly on your phone and switch them on.'
        : isInstalled()
          ? 'Long-press the Tadbirly icon → App info → Notifications, and allow them.'
          : t('Tap the padlock next to the web address, set Notifications to “Allow”, then reload this page.'),
    };
  }
  if (perm === 'unsupported') {
    // iPhones only expose notifications to sites saved to the Home Screen.
    if (isIOS() && !isInstalled()) {
      return {
        title: t('Add Tadbirly to your Home Screen first'),
        body: t('iPhones only allow notifications for sites saved to the Home Screen. Tap Share → “Add to Home Screen”, then open Tadbirly from the new icon.'),
      };
    }
    if (isIOS()) {
      return {
        title: t('Update your iPhone'),
        body: t('Notifications need iOS 16.4 or newer: Settings → General → Software Update.'),
      };
    }
    return {
      title: t('This browser can’t show notifications'),
      body: t('Open Tadbirly in Chrome, Safari, Edge or Firefox to get notified.'),
    };
  }
  return null;
}

// For places with a single button (the feed strip, the profile screen): try
// to hand the page to the system browser, copy the link as a fallback, and if
// we're still here a moment later, explain the manual steps.
export function leaveInAppBrowser() {
  if (!isWeb) return;
  const g = inAppGuidance();
  const tried = openInSystemBrowser();
  const copied = copyLink(); // started inside the tap, as clipboards require
  setTimeout(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; // it opened
    copied.then((ok) => notify(
      g.title,
      ok ? `${g.body}\n\nThe link is copied — you can also paste it into ${g.browser}.` : g.body,
    ));
  }, tried ? 1500 : 0);
}

// Best effort: asks the host app to hand the current page to the system
// browser. Many in-app browsers honour these links, some ignore them — so
// always show the manual steps (and "Copy link") alongside.
// Native: returns false — the app is never inside an in-app browser.
export function openInSystemBrowser(url) {
  if (!isWeb) return false;
  try {
    const target = new URL(url || window.location.href);
    if (/android/i.test(navigator.userAgent || '')) {
      // Chrome intent; if Chrome isn't installed Android opens the fallback URL.
      // No #hash in the path part: the intent's own "#Intent;" must be the only '#'.
      const fallback = encodeURIComponent(target.href);
      window.location.href =
        `intent://${target.host}${target.pathname}${target.search}` +
        `#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
      return true;
    }
    if (isIOS()) {
      // Understood by newer iOS versions; older ones just ignore it.
      window.location.href = `x-safari-${target.href}`;
      return true;
    }
    window.open(target.href, '_blank');
    return true;
  } catch {
    return false;
  }
}

// Copies the link to the clipboard. Resolves true when it worked. Must be
// started inside the tap — browsers only allow clipboard writes from a gesture.
// Native: resolves false (no clipboard module is bundled; use Share instead).
export async function copyLink(url) {
  if (!isWeb) return false;
  const text = url || window.location.href;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* blocked in many WebViews — use the old way below */ }
  let ta = null;
  try {
    ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');       // no keyboard pop-up on phones
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.fontSize = '16px';            // stops iOS zooming in on focus
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);  // iOS ignores select() on its own
    return !!document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
  }
}

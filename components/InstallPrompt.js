import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSegments } from 'expo-router';
import { colors, radius, type, shadow } from '../lib/theme';
import {
  isInstalled, isIOS, notificationState, notificationHelp, unlockAudio, ping,
  inAppBrowser, inAppGuidance, openInSystemBrowser, copyLink,
} from '../lib/feedback';
import { promptPush } from '../lib/push';
import { notify } from '../lib/notify';
import { useAuth } from '../lib/auth';
import { t } from '../lib/i18n';

const DISMISS_KEY = 'tdb:install-dismissed';
const FIRST_SEEN_KEY = 'tdb:first-seen';          // localStorage: first visit, ms
const FIRST_SESSION_KEY = 'tdb:first-session';    // sessionStorage: this tab is that visit
const FIRST_SESSION_MAX_MS = 12 * 60 * 60 * 1000; // a tab left open for days still "comes back"
const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

// Not on the very first visit: someone who has just signed up should get to
// look around before being asked to install or allow anything. From the
// second visit on (a new tab / launch, or 12 hours later) the prompt works as
// before. Decided once per page load.
let firstSession = null;
function isFirstSession() {
  if (firstSession !== null) return firstSession;
  firstSession = false;
  try {
    const now = Date.now();
    const seen = Number(window.localStorage.getItem(FIRST_SEEN_KEY) || 0);
    if (!seen) {
      window.localStorage.setItem(FIRST_SEEN_KEY, String(now));
      window.sessionStorage.setItem(FIRST_SESSION_KEY, '1');
      firstSession = true;
    } else {
      firstSession = window.sessionStorage.getItem(FIRST_SESSION_KEY) === '1' && now - seen < FIRST_SESSION_MAX_MS;
    }
  } catch { /* storage blocked: behave as a returning visitor */ }
  return firstSession;
}

// Screens where the banner never covers anything: logging in / signing up,
// password reset and the onboarding steps.
const QUIET_SEGMENTS = ['(auth)', 'onboarding', 'reset-password'];

// One nudge at a time, never two:
//   0. "Open in your browser"  — inside Telegram, Instagram & co., which can't
//                                do notifications (or keep the login) at all
//   1. "Install Tadbirly"      — until it's on their home screen
//   2. "Turn on notifications" — once installed, if they haven't allowed them
//
// 1 and 2 wait for the second visit and never show on the login / sign-up /
// onboarding screens. 0 is the exception on login and sign-up, and on a first
// visit: in those browsers even staying logged in doesn't work.
//
// Web only. The iOS / Android app is already installed and asks for
// notifications through the feed strip (NotifyNudge) and Profile instead —
// none of the Safari / Home Screen / padlock steps here apply to it.
export default function InstallPrompt() {
  if (!isWeb) return null;
  return <WebInstallPrompt />;
}

function WebInstallPrompt() {
  const { uid } = useAuth();
  const segments = useSegments();
  const [newcomer] = useState(isFirstSession);
  const [deferred, setDeferred] = useState(null);   // Android/Chrome install event
  // 'inapp' | 'install' | 'ios' | 'notify' | 'blocked' | null
  // In-app browsers are decided on the very first render — no delay, and the
  // "Later" snooze doesn't apply: until they switch browsers nothing else works.
  const [mode, setMode] = useState(() => (isWeb && inAppBrowser() ? 'inapp' : null));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  useEffect(() => {
    if (!isWeb || inAppBrowser()) return undefined;

    // "Later" hides it for four days rather than forever — people who joined
    // before notifications existed would otherwise never be asked again.
    let dismissed = false;
    try {
      const until = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
      dismissed = Date.now() < until;
    } catch { /* ignore */ }

    const onBefore = (e) => {
      e.preventDefault();
      setDeferred(e);
      if (!dismissed && !isInstalled()) setMode('install');
    };
    const onInstalled = () => { setMode(null); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onBefore);
    window.addEventListener('appinstalled', onInstalled);

    // Decide what to show after a moment, so it doesn't fight the first paint.
    const timer = setTimeout(() => {
      const perm = notificationState();
      if (perm === 'granted' || dismissed) return;         // nothing to nag about

      if (perm === 'denied') { setMode('blocked'); return; }

      // iPhone must install before notifications are even possible.
      if (isIOS() && !isInstalled()) { setMode('ios'); return; }

      // No notifications in this browser at all — an "Allow" button would do nothing.
      if (perm === 'unsupported') return;

      // Android and desktop can subscribe straight from the browser.
      setMode('notify');
    }, 2500);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBefore);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const SNOOZE_MS = 4 * 24 * 60 * 60 * 1000;   // "Later" = ask again in 4 days

  function dismiss() {
    setMode(null);
    try { window.localStorage.setItem(DISMISS_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
  }

  function later() {
    // In an in-app browser "Later" only hides it for this visit: the next
    // time they open a link from Telegram they need to hear it again.
    if (mode === 'inapp') { setMode(null); return; }
    dismiss();
  }

  async function install() {
    unlockAudio();
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* ignore */ }
    setDeferred(null);
    setMode(null);
  }

  function enableNotifications() {
    // The very first thing: iPhones only show the permission prompt while the
    // tap is still being handled, so nothing may run (or await) before it.
    const asked = promptPush(uid); // asks, subscribes this device, links the account
    unlockAudio();
    setBusy(true);
    asked.then((result) => {
      setBusy(false);
      if (result === 'granted') { ping(); setMode(null); }
      else if (result === 'denied') setMode('blocked');   // show how to undo it
      else setMode(null);
    });
  }

  function openBrowser() {
    openInSystemBrowser(); // best effort — the card stays up with the manual steps
  }

  async function copy() {
    const ok = await copyLink(); // starts synchronously, inside the tap
    if (!ok) { notify(t('Copy this link'), window.location.href, { dialog: true }); return; }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 4000);
  }

  if (!mode) return null;
  // Signed out (login / sign-up), the only nudge that matters is "open in your
  // browser". Install and notification banners wait until they're in the app,
  // instead of covering the login form on someone's first visit.
  if (!uid && mode !== 'inapp') return null;
  if (segments[0] === 'onboarding') return null;
  if (mode !== 'inapp' && (newcomer || QUIET_SEGMENTS.includes(segments[0]))) return null;

  const inApp = mode === 'inapp' ? inAppGuidance() : null;

  const content = {
    inapp: inApp && {
      icon: 'globe-outline',
      title: inApp.title,
      body: copied ? t('Link copied. Open {browser} and paste it into the address bar.', { browser: inApp.browser }) : inApp.body,
      cta: t('Open'),
      action: openBrowser,
      secondary: copied ? t('Copied') : t('Copy link'),
      secondaryIcon: copied ? 'checkmark' : 'copy-outline',
      secondaryAction: copy,
    },
    install: {
      icon: 'phone-portrait-outline',
      title: t('Add Tadbirly to your Home Screen'),
      body: t('Save it once and open it with one tap, no typing the link every time.'),
      cta: t('Add'),
      action: install,
    },
    ios: {
      icon: 'phone-portrait-outline',
      title: t('Add Tadbirly to your Home Screen'),
      body: t('Tap the Share button at the bottom of Safari, then choose “Add to Home Screen”. Notifications only work from there.'),
      cta: t('Got it'),
      action: dismiss,
    },
    notify: {
      icon: 'notifications-outline',
      title: t('Turn on notifications'),
      body: t('Get told when you’re accepted to an event, invited to a team or given points.'),
      cta: t('Allow'),
      action: enableNotifications,
    },
    blocked: {
      icon: 'notifications-off-outline',
      title: t('Notifications are blocked'),
      body: notificationHelp('denied')?.body,
      cta: t('Got it'),
      action: dismiss,
    },
  }[mode];

  if (!content) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name={content.icon} size={22} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.body}>{content.body}</Text>
        </View>
        <View style={{ gap: 6 }}>
          <TouchableOpacity style={styles.cta} onPress={content.action} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator size="small" color={colors.onBrand} /> : <Text style={styles.ctaText}>{content.cta}</Text>}
          </TouchableOpacity>
          {content.secondary ? (
            <TouchableOpacity style={styles.ctaGhost} onPress={content.secondaryAction} accessibilityRole="button">
              <Ionicons name={content.secondaryIcon} size={13} color={colors.ink} />
              <Text style={styles.ctaGhostText}>{content.secondary}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={later} accessibilityRole="button">
            <Text style={styles.later}>{t('Later')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 74, paddingHorizontal: 12, zIndex: 900 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 15,
    borderWidth: 1, borderColor: colors.line, ...shadow.lg,
    maxWidth: 560, width: '100%', alignSelf: 'center',
  },
  iconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  title: { ...type.title, fontSize: 14.5 },
  body: { fontSize: 12, color: colors.muted, marginTop: 3, lineHeight: 17 },
  cta: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center', minWidth: 64 },
  ctaText: { color: colors.onBrand, fontWeight: '700', fontSize: 13 },
  ctaGhost: {
    flexDirection: 'row', gap: 4, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center',
  },
  ctaGhostText: { color: colors.ink, fontWeight: '700', fontSize: 12 },
  later: { color: colors.muted, fontSize: 11.5, textAlign: 'center', fontWeight: '600' },
});

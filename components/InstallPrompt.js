import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { colors, radius } from '../lib/theme';
import {
  isInstalled, isIOS, notificationState, notificationHelp, unlockAudio, ping,
  inAppBrowser, inAppGuidance, openInSystemBrowser, copyLink,
} from '../lib/feedback';
import { promptPush } from '../lib/push';
import { notify } from '../lib/notify';
import { useAuth } from '../lib/auth';

const DISMISS_KEY = 'tdb:install-dismissed';
const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

// One nudge at a time, never two:
//   0. "Open in your browser"  — inside Telegram, Instagram & co., which can't
//                                do notifications (or keep the login) at all
//   1. "Install Tadbirly"      — until it's on their home screen
//   2. "Turn on notifications" — once installed, if they haven't allowed them
//
// Web only. The iOS / Android app is already installed and asks for
// notifications through the feed strip (NotifyNudge) and Profile instead —
// none of the Safari / Home Screen / padlock steps here apply to it.
export default function InstallPrompt() {
  if (!isWeb) return null;
  return <WebInstallPrompt />;
}

function WebInstallPrompt() {
  const { session } = useAuth();
  const uid = session?.user?.id;
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
    const t = setTimeout(() => {
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
      clearTimeout(t);
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
    if (!ok) { notify('Copy this link', window.location.href); return; }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 4000);
  }

  if (!mode) return null;

  const inApp = mode === 'inapp' ? inAppGuidance() : null;

  const content = {
    inapp: inApp && {
      emoji: '🌐',
      title: inApp.title,
      body: copied ? `Link copied — open ${inApp.browser} and paste it into the address bar.` : inApp.body,
      cta: 'Open',
      action: openBrowser,
      secondary: copied ? 'Copied ✓' : 'Copy link',
      secondaryAction: copy,
    },
    install: {
      emoji: '📲',
      title: 'Add Tadbirly to your Home Screen',
      body: 'Save it once and open it with one tap — no typing the link every time.',
      cta: 'Add',
      action: install,
    },
    ios: {
      emoji: '📲',
      title: 'Add Tadbirly to your Home Screen',
      body: 'Tap the Share button at the bottom of Safari, then choose “Add to Home Screen”. Notifications only work from there.',
      cta: 'Got it',
      action: dismiss,
    },
    notify: {
      emoji: '🔔',
      title: 'Turn on notifications',
      body: 'Get told when you’re accepted to an event, invited to a team or given points.',
      cta: 'Allow',
      action: enableNotifications,
    },
    blocked: {
      emoji: '🔕',
      title: 'Notifications are blocked',
      body: notificationHelp('denied')?.body,
      cta: 'Got it',
      action: dismiss,
    },
  }[mode];

  if (!content) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <Text style={styles.emoji}>{content.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{content.title}</Text>
          <Text style={styles.body}>{content.body}</Text>
        </View>
        <View style={{ gap: 6 }}>
          <TouchableOpacity style={styles.cta} onPress={content.action} disabled={busy}>
            <Text style={styles.ctaText}>{busy ? '…' : content.cta}</Text>
          </TouchableOpacity>
          {content.secondary ? (
            <TouchableOpacity style={styles.ctaGhost} onPress={content.secondaryAction}>
              <Text style={styles.ctaGhostText}>{content.secondary}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={later}>
            <Text style={styles.later}>Later</Text>
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
    backgroundColor: colors.ink, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 15,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10,
    maxWidth: 560, width: '100%', alignSelf: 'center',
  },
  emoji: { fontSize: 26 },
  title: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  body: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 3, lineHeight: 17 },
  cta: { backgroundColor: colors.brandSoft, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center' },
  ctaText: { color: colors.brand, fontWeight: '800', fontSize: 13 },
  ctaGhost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center' },
  ctaGhostText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  later: { color: 'rgba(255,255,255,0.55)', fontSize: 11.5, textAlign: 'center', fontWeight: '600' },
});

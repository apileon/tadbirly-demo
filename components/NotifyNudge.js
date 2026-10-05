import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter, useSegments } from 'expo-router';
import { colors, radius } from '../lib/theme';
import {
  isInstalled, isIOS, notificationState, notificationHelp, unlockAudio, ping, buzz,
  inAppBrowser, inAppGuidance, leaveInAppBrowser,
} from '../lib/feedback';
import { promptPush, pushPermission, openPushSettings } from '../lib/push';
import { notify } from '../lib/notify';
import { useAuth } from '../lib/auth';
import { telegramStatus } from '../lib/telegram';
import { openLink } from '../lib/links';

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
const NO_TELEGRAM = { available: false, linked: false };

// A slim, always-present strip at the top of the feed for anyone who doesn't
// have notifications on. Unlike the bottom banner it can't be dismissed away
// for good — it just disappears the moment notifications are actually working
// (browser notifications allowed, or Telegram connected).
//
// The phone app gets its own version (NativeNudge below): OneSignal's
// permission, the system prompt, and Settings — never browser instructions.
export default function NotifyNudge() {
  return Platform.OS === 'web' ? <WebNudge /> : <NativeNudge />;
}

function WebNudge() {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const router = useRouter();
  const segments = useSegments();
  const [perm, setPerm] = useState('granted'); // assume fine until we know better
  const [busy, setBusy] = useState(false);
  // telegram_status(), fetched once per visit and only while the strip could
  // show. null until known; an error (or no answer within a few seconds)
  // counts as "no Telegram", so the strip never goes missing because of it.
  const [tg, setTg] = useState(null);

  // Re-check on every focus so it vanishes straight after they allow.
  useFocusEffect(useCallback(() => {
    if (!isWeb) return undefined;
    const p = notificationState();
    setPerm(p);
    if (p === 'granted' || !uid) return undefined;
    let alive = true;
    const slow = setTimeout(() => { if (alive) setTg((cur) => cur || NO_TELEGRAM); }, 4000);
    telegramStatus().then(({ data }) => {
      if (alive) setTg(data || NO_TELEGRAM);
    });
    return () => { alive = false; clearTimeout(slow); };
  }, [uid]));

  if (!isWeb || perm === 'granted') return null;
  // Wait for the Telegram answer rather than flash a strip that then vanishes.
  if (uid && !tg) return null;
  // Telegram is connected: notifications already reach them.
  if (tg?.available && tg?.linked) return null;

  // Inside Telegram & co. no prompt can work — send them to a real browser.
  const inApp = inAppBrowser();
  // Blocked, iPhone-not-installed, or a browser without notifications: all we
  // can do is explain. (React Native's Alert does nothing on web — notify()
  // falls back to the browser's own dialog.)
  const help = inApp ? null : notificationHelp(perm);
  // Web push can't work from here at all. If the Telegram bot is set up,
  // that's the easy way out, and it lives on the Profile screen (next to the
  // browser-notification button and its how-to).
  const pushImpossible = !!inApp || perm === 'denied' || perm === 'unsupported';
  const viaTelegram = pushImpossible && !!tg?.available;

  function onPress() {
    if (viaTelegram) { openLink(router, '/profile?focus=telegram', segments); return; }
    if (inApp) { leaveInAppBrowser(); return; }
    if (help) { notify(help.title, help.body); return; }

    // Must stay the first real work in this handler: iPhones only show the
    // permission prompt while the tap is still being handled.
    const asked = promptPush(uid); // asks, subscribes this device, links the account
    unlockAudio();
    setBusy(true);
    asked.then((result) => {
      if (result === 'granted') ping();
      else if (result === 'denied') {
        const blocked = notificationHelp('denied');
        notify(blocked.title, blocked.body);
      }
      setPerm(notificationState());
      setBusy(false);
    });
  }

  const iosNeedsInstall = !inApp && perm === 'unsupported' && isIOS() && !isInstalled();
  const orTelegram = ', or connect Telegram in Profile';

  const label = viaTelegram
    ? (inApp
      ? `Notifications don’t work in ${inApp === 'app' ? 'this in-app browser' : `${inApp}’s browser`} — open Tadbirly in ${inAppGuidance(inApp).browser}${orTelegram}`
      : perm === 'denied'
        ? `Notifications are off — switch them back on${orTelegram}`
        : iosNeedsInstall
          ? `Add Tadbirly to your Home Screen to get notified${orTelegram}`
          : 'This browser can’t send notifications — connect Telegram in Profile instead')
    : inApp
      ? `Notifications don’t work in ${inApp === 'app' ? 'this in-app browser' : `${inApp}’s browser`} — open Tadbirly in ${inAppGuidance(inApp).browser}`
      : perm === 'denied'
        ? 'Notifications are off — here’s how to switch them back on'
        : iosNeedsInstall
          ? 'Add Tadbirly to your Home Screen to get notified'
          : perm === 'unsupported'
            ? 'This browser can’t send notifications — here’s what to do'
            : 'Turn on notifications so you don’t miss acceptances and invites';

  const cta = busy ? '…' : viaTelegram ? 'Set up' : inApp ? 'Open' : help ? 'How' : 'Turn on';

  return (
    <TouchableOpacity style={styles.wrap} onPress={onPress} activeOpacity={0.85} disabled={busy}>
      <Text style={styles.bell}>{inApp ? '🌐' : perm === 'denied' ? '🔕' : '🔔'}</Text>
      <Text style={styles.text}>{label}</Text>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>{cta}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
//  iOS / Android
//  Never asked yet → a one-time card explaining why, with "Turn on" (the
//  system prompt) and "Not now"; after "Not now" it shrinks to the slim strip.
//  Refused → the strip opens Tadbirly's page in the phone's Settings.
//  Gone as soon as notifications are allowed, or Telegram is connected.
// ---------------------------------------------------------------------------
const SOFT_CARD_KEY = 'tdb:push-soft-dismissed'; // not cache-shaped: survives sign-out

function NativeNudge() {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const router = useRouter();
  const segments = useSegments();
  const [perm, setPerm] = useState(null);       // null until known
  const [cardDismissed, setCardDismissed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tg, setTg] = useState(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    AsyncStorage.getItem(SOFT_CARD_KEY)
      .then((v) => { if (alive.current) setCardDismissed(!!v); }, () => { if (alive.current) setCardDismissed(false); });
    return () => { alive.current = false; };
  }, []);

  const recheck = useCallback(() => {
    pushPermission().then((p) => { if (alive.current) setPerm(p); }, () => {});
  }, []);

  // On every visit, and when coming back from Settings / the system prompt.
  useFocusEffect(useCallback(() => {
    recheck();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') recheck(); });
    return () => sub?.remove?.();
  }, [recheck]));

  // Telegram status, only while the strip could show (re-read for a new account).
  useEffect(() => { setTg(null); }, [uid]);
  useEffect(() => {
    if (!uid || !perm || perm === 'granted' || tg) return undefined;
    let on = true;
    const slow = setTimeout(() => { if (on) setTg((cur) => cur || NO_TELEGRAM); }, 4000);
    telegramStatus().then(({ data }) => { if (on) setTg(data || NO_TELEGRAM); }, () => { if (on) setTg(NO_TELEGRAM); });
    return () => { on = false; clearTimeout(slow); };
  }, [uid, perm, tg]);

  if (!uid || !perm || perm === 'granted' || perm === 'unsupported') return null;
  if (!tg || cardDismissed === null) return null;      // no flash of a strip that then vanishes
  if (tg.available && tg.linked) return null;           // Telegram already delivers them

  const denied = perm === 'denied';

  function turnOn() {
    if (denied) { openPushSettings(); return; }
    setBusy(true);
    promptPush(uid).then((result) => {
      if (!alive.current) return;
      setBusy(false);
      if (result === 'granted') buzz();
      setPerm(result);
    }, () => { if (alive.current) setBusy(false); });
  }

  function notNow() {
    setCardDismissed(true);
    AsyncStorage.setItem(SOFT_CARD_KEY, String(Date.now())).catch(() => {});
  }

  if (!denied && !cardDismissed) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardEmoji}>🔔</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Turn on notifications</Text>
          <Text style={styles.cardBody}>
            Know the moment you’re accepted to an event, invited to a team, given points or sent a message.
          </Text>
          <View style={styles.cardRow}>
            <TouchableOpacity style={styles.cta} onPress={turnOn} disabled={busy} activeOpacity={0.85}>
              <Text style={styles.ctaText}>{busy ? '…' : 'Turn on'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={notNow} disabled={busy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.notNow}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const label = denied
    ? `Notifications are off for Tadbirly — switch them on in Settings${tg.available ? ', or connect Telegram in Profile' : ''}`
    : 'Turn on notifications so you don’t miss acceptances and invites';

  return (
    <TouchableOpacity style={styles.wrap} onPress={turnOn} activeOpacity={0.85} disabled={busy}>
      <Text style={styles.bell}>{denied ? '🔕' : '🔔'}</Text>
      <Text style={styles.text}>{label}</Text>
      {denied && tg.available ? (
        <TouchableOpacity
          style={[styles.cta, styles.ctaGhost]}
          onPress={() => openLink(router, '/profile?focus=telegram', segments)}
        >
          <Text style={[styles.ctaText, { color: colors.brand }]}>Telegram</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.cta}>
        <Text style={styles.ctaText}>{busy ? '…' : denied ? 'Settings' : 'Turn on'}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.brandSoft, borderRadius: radius.md,
    paddingVertical: 11, paddingHorizontal: 13, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(45,90,61,0.22)',
  },
  bell: { fontSize: 18 },
  text: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.brand, lineHeight: 17 },
  cta: { backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 13 },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  ctaGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.brand, paddingVertical: 5, paddingHorizontal: 10 },
  card: {
    flexDirection: 'row', gap: 12,
    backgroundColor: colors.brandSoft, borderRadius: radius.lg,
    paddingVertical: 14, paddingHorizontal: 14, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(45,90,61,0.22)',
  },
  cardEmoji: { fontSize: 26 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: colors.brand },
  cardBody: { fontSize: 12.5, color: colors.brand, opacity: 0.85, marginTop: 3, lineHeight: 17 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 11 },
  notNow: { fontSize: 12.5, fontWeight: '700', color: colors.brand, opacity: 0.7 },
});

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, AppState, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter, useSegments } from 'expo-router';
import { colors, radius, type } from '../lib/theme';
import {
  isInstalled, isIOS, notificationState, notificationHelp, unlockAudio, ping, buzz,
  inAppBrowser, inAppGuidance, leaveInAppBrowser,
} from '../lib/feedback';
import { promptPush, pushPermission, openPushSettings } from '../lib/push';
import { notify } from '../lib/notify';
import { useAuth } from '../lib/auth';
import { telegramStatus } from '../lib/telegram';
import { openLink } from '../lib/links';
import { t } from '../lib/i18n';

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';
const NO_TELEGRAM = { available: false, linked: false };

// The small ✕ on the strip hides it for a week (per device, survives sign-out).
const SNOOZE_KEY = 'tdb:nudge-snoozed-until';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

// null until read (no flash of a strip that then vanishes), then true/false.
function useSnooze() {
  const [snoozed, setSnoozed] = useState(null);
  useEffect(() => {
    let on = true;
    AsyncStorage.getItem(SNOOZE_KEY).then(
      (v) => { if (on) setSnoozed(Date.now() < Number(v || 0)); },
      () => { if (on) setSnoozed(false); },
    );
    return () => { on = false; };
  }, []);
  const snooze = useCallback(() => {
    setSnoozed(true);
    AsyncStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)).catch(() => {});
  }, []);
  return [snoozed, snooze];
}

function CloseX({ onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={t('Hide for a week')}
      style={styles.close}
    >
      <Ionicons name="close" size={16} color={colors.muted} />
    </TouchableOpacity>
  );
}

// A slim strip at the top of the feed for anyone who doesn't have
// notifications on. It disappears the moment notifications are actually
// working (browser notifications allowed, or Telegram connected); the ✕ hides
// it for a week.
//
// The phone app gets its own version (NativeNudge below): OneSignal's
// permission, the system prompt, and Settings — never browser instructions.
export default function NotifyNudge() {
  return Platform.OS === 'web' ? <WebNudge /> : <NativeNudge />;
}

function WebNudge() {
  const { uid } = useAuth();
  const [snoozed, snooze] = useSnooze();
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

  if (!isWeb || perm === 'granted' || snoozed !== false) return null;
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
    if (help) { notify(help.title, help.body, { dialog: true }); return; }

    // Must stay the first real work in this handler: iPhones only show the
    // permission prompt while the tap is still being handled.
    const asked = promptPush(uid); // asks, subscribes this device, links the account
    unlockAudio();
    setBusy(true);
    asked.then((result) => {
      if (result === 'granted') ping();
      else if (result === 'denied') {
        const blocked = notificationHelp('denied');
        notify(blocked.title, blocked.body, { dialog: true });
      }
      setPerm(notificationState());
      setBusy(false);
    });
  }

  const iosNeedsInstall = !inApp && perm === 'unsupported' && isIOS() && !isInstalled();
  const browser = inApp ? inAppGuidance(inApp).browser : '';
  const where = inApp === 'app' ? null : inApp;

  // One whole sentence per case, so each translates on its own.
  const label = viaTelegram
    ? (inApp
      ? (where
        ? t('Notifications don’t work in {app}’s browser. Open Tadbirly in {browser}, or connect Telegram in Profile', { app: where, browser })
        : t('Notifications don’t work in this in-app browser. Open Tadbirly in {browser}, or connect Telegram in Profile', { browser }))
      : perm === 'denied'
        ? t('Notifications are off. Switch them back on, or connect Telegram in Profile')
        : iosNeedsInstall
          ? t('Add Tadbirly to your Home Screen to get notified, or connect Telegram in Profile')
          : t('This browser can’t send notifications. Connect Telegram in Profile instead'))
    : inApp
      ? (where
        ? t('Notifications don’t work in {app}’s browser. Open Tadbirly in {browser}', { app: where, browser })
        : t('Notifications don’t work in this in-app browser. Open Tadbirly in {browser}', { browser }))
      : perm === 'denied'
        ? t('Notifications are off. Here’s how to switch them back on')
        : iosNeedsInstall
          ? t('Add Tadbirly to your Home Screen to get notified')
          : perm === 'unsupported'
            ? t('This browser can’t send notifications. Here’s what to do')
            : t('Turn on notifications so you don’t miss acceptances and invites');

  const cta = viaTelegram ? t('Set up') : inApp ? t('Open') : help ? t('How') : t('Turn on');
  const icon = inApp ? 'globe-outline' : perm === 'denied' ? 'notifications-off-outline' : 'notifications-outline';

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.main} onPress={onPress} activeOpacity={0.85} disabled={busy} accessibilityRole="button">
        <View style={styles.iconDot}><Ionicons name={icon} size={17} color={colors.brand} /></View>
        <Text style={styles.text}>{label}</Text>
        <View style={styles.cta}>
          {busy ? <ActivityIndicator size="small" color={colors.onBrand} /> : <Text style={styles.ctaText}>{cta}</Text>}
        </View>
      </TouchableOpacity>
      <CloseX onPress={snooze} />
    </View>
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
  const { uid } = useAuth();
  const [snoozed, snooze] = useSnooze();
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
  if (!tg || cardDismissed === null || snoozed !== false) return null; // no flash of a strip that then vanishes
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
        <View style={styles.cardIcon}><Ionicons name="notifications-outline" size={22} color={colors.brand} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{t('Turn on notifications')}</Text>
          <Text style={styles.cardBody}>
            {t('Know the moment you’re accepted to an event, invited to a team, given points or sent a message.')}
          </Text>
          <View style={styles.cardRow}>
            <TouchableOpacity style={styles.cta} onPress={turnOn} disabled={busy} activeOpacity={0.85} accessibilityRole="button">
              {busy ? <ActivityIndicator size="small" color={colors.onBrand} /> : <Text style={styles.ctaText}>{t('Turn on')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={notNow} disabled={busy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button">
              <Text style={styles.notNow}>{t('Not now')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const label = denied
    ? (tg.available
      ? t('Notifications are off for Tadbirly. Switch them on in Settings, or connect Telegram in Profile')
      : t('Notifications are off for Tadbirly. Switch them on in Settings'))
    : t('Turn on notifications so you don’t miss acceptances and invites');

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.main} onPress={turnOn} activeOpacity={0.85} disabled={busy} accessibilityRole="button">
        <View style={styles.iconDot}>
          <Ionicons name={denied ? 'notifications-off-outline' : 'notifications-outline'} size={17} color={colors.brand} />
        </View>
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
          {busy ? <ActivityIndicator size="small" color={colors.onBrand} /> : <Text style={styles.ctaText}>{denied ? t('Settings') : t('Turn on')}</Text>}
        </View>
      </TouchableOpacity>
      <CloseX onPress={snooze} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.brandSoft, borderRadius: radius.md,
    paddingVertical: 10, paddingLeft: 12, paddingRight: 6, marginBottom: 14,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  close: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  iconDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.ink, lineHeight: 17 },
  cta: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 13, minWidth: 44, alignItems: 'center' },
  ctaText: { color: colors.onBrand, fontWeight: '700', fontSize: 12 },
  ctaGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.brand, paddingVertical: 5, paddingHorizontal: 10 },
  card: {
    flexDirection: 'row', gap: 12,
    backgroundColor: colors.brandSoft, borderRadius: radius.lg,
    paddingVertical: 14, paddingHorizontal: 14, marginBottom: 14,
  },
  cardIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...type.title, fontSize: 15 },
  cardBody: { fontSize: 12.5, color: colors.body, marginTop: 3, lineHeight: 17 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 11 },
  notNow: { fontSize: 12.5, fontWeight: '700', color: colors.muted },
});

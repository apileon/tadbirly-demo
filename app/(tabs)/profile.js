import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Image, Platform, Switch, AppState, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCachedQuery } from '../../lib/cache';
import {
  notificationState, notificationHelp, inAppBrowser, leaveInAppBrowser, unlockAudio, ping, buzz,
} from '../../lib/feedback';
import { promptPush, pushDebug, openPushSettings } from '../../lib/push';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, awardMeta } from '../../lib/theme';
import { Button, Avatar } from '../../components/ui';
import { sharedStreak } from '../../lib/social';
import { pickImage, uploadAvatar, canPickImage, pickAndUpload } from '../../lib/news';
import { notify, confirmAsync } from '../../lib/notify';
import {
  telegramStatus, telegramUnlink, telegramSetAlsoPush,
  readyTelegramLink, prefetchTelegramLink, forgetTelegramLink,
} from '../../lib/telegram';

const EMPTY_STATS = { applications: 0, posts: 0, incoming: 0, events: [], attended: 0, friends: 0, bestStreak: 0, points: 0, place: null, medals: [] };

// One quiet line under the notification button: which link in the chain
// "browser allows → OneSignal has a subscription → it's tied to this account"
// is missing, so a student (or the developer) can see why pushes don't arrive.
function pushStatusLine(d, uid) {
  if (!d || !d.configured) return null;
  if (inAppBrowser()) return 'This device: this in-app browser can’t receive notifications';
  if (d.nativePermission === 'unsupported') return 'This device: this browser can’t receive notifications';
  if (d.nativePermission === 'denied') return 'This device: blocked in browser settings';
  if (d.nativePermission !== 'granted') return 'This device: not allowed yet';
  if (!d.sdkReady) return 'This device: allowed · notification service not reachable';
  const subscribed = !!d.subscriptionId && !!d.optedIn;
  const linked = !d.externalId
    ? 'not linked to your account'
    : String(d.externalId) === String(uid) ? 'linked' : 'linked to a different account';
  return `This device: allowed · ${subscribed ? 'subscribed' : 'not subscribed'} · ${linked}`;
}

export default function Profile() {
  const router = useRouter();
  const { profile, session, signOut, refreshProfile } = useAuth();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [notifState, setNotifState] = useState(notificationState());
  const [notifBusy, setNotifBusy] = useState(false);
  const [pushInfo, setPushInfo] = useState(null);
  const isOrg = profile?.role === 'organizer';

  const uid = session?.user?.id;

  // Re-read on every visit: permission can change in browser settings, and
  // the launch-time repair in lib/push.js may have finished since.
  useFocusEffect(useCallback(() => {
    let alive = true;
    setNotifState(notificationState());
    pushDebug().then((d) => { if (alive) setPushInfo(d); }, () => {});
    return () => { alive = false; };
  }, []));

  // Round 1: everything that only needs my own id — all at once.
  // Round 2: the two queries that depend on round 1's results.
  const fetchProfile = useCallback(async () => {
    if (!uid) return undefined;

    const [postsRes, appsRes, connsRes, ptsRes, pinnedRes] = await Promise.all([
      supabase.from('posts').select('id, title, event_date, status').eq('author_id', uid).order('created_at', { ascending: false }),
      supabase.from('applications').select('*', { count: 'exact', head: true }).eq('applicant_id', uid),
      supabase.from('connections').select('requester_id, target_id').or(`requester_id.eq.${uid},target_id.eq.${uid}`).eq('status', 'accepted'),
      supabase.rpc('my_points'),
      supabase.from('awards').select('id, kind, place, note, badge:badges(name, emoji)')
        .eq('recipient_id', uid).eq('pinned', true).order('created_at', { ascending: false }).limit(6),
    ]);

    const myPosts = postsRes.data ?? [];
    const postIds = myPosts.map((p) => p.id);
    const friendIds = (connsRes.data ?? []).map((c) => (c.requester_id === uid ? c.target_id : c.requester_id));

    const [incomingRes, awRes] = await Promise.all([
      postIds.length
        ? supabase.from('applications').select('*', { count: 'exact', head: true }).in('post_id', postIds)
        : Promise.resolve({ count: 0 }),
      supabase.from('awards').select('recipient_id, post_id').in('recipient_id', [uid, ...friendIds]).eq('verified', true),
    ]);

    const aw = awRes.data ?? [];
    const mine = aw.filter((r) => r.recipient_id === uid).map((r) => r.post_id);
    let bestStreak = 0;
    for (const f of friendIds) {
      bestStreak = Math.max(bestStreak, sharedStreak(mine, aw.filter((r) => r.recipient_id === f).map((r) => r.post_id)));
    }
    const pts = ptsRes.data && ptsRes.data[0] ? ptsRes.data[0] : null;

    return {
      applications: appsRes.count ?? 0,
      posts: myPosts.length,
      incoming: incomingRes.count ?? 0,
      events: myPosts,
      attended: mine.length,
      friends: friendIds.length,
      bestStreak,
      points: pts ? pts.points : 0,
      place: pts ? pts.place : null,
      medals: pinnedRes.data ?? [],
    };
  }, [uid]);

  const { data: cached, refresh } = useCachedQuery(uid ? `profile:${uid}` : null, fetchProfile);
  const stats = cached ?? EMPTY_STATS;

  async function changePhoto() {
    if (!canPickImage) return notify('Open the web app', 'Photo upload works at tadbirly.expo.app.');
    if (profile?.avatar_url) {
      const replace = await confirmAsync('Profile picture', 'Choose a new photo, or cancel to keep this one.', 'Choose new');
      if (!replace) return;
    }
    const file = await pickImage({ square: true });   // phones get a 1:1 crop
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return notify('Image too large', 'Please pick a photo under 5 MB.');
    setPhotoBusy(true);
    try {
      const url = await uploadAvatar(file);
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', session.user.id);
      if (error) throw error;
      await refreshProfile();
      refresh();
      notify('Photo updated 📸', '');
    } catch (e) {
      notify('Could not upload', e.message);
    }
    setPhotoBusy(false);
  }

  async function changeCover() {
    if (!canPickImage) return notify('Open the web app', 'Photo upload works at tadbirly.expo.app.');
    if (coverBusy) return;
    setCoverBusy(true);
    try {
      const url = await pickAndUpload('avatars');
      if (!url) { setCoverBusy(false); return; }           // they cancelled the picker
      const { error } = await supabase.from('profiles').update({ cover_url: url }).eq('id', session.user.id);
      if (error) throw error;
      await refreshProfile();
      notify('Cover updated 🖼️', '');
    } catch (e) {
      notify('Could not update cover', e.message || 'Please try a smaller image.');
    }
    setCoverBusy(false);
  }

  async function removeCover() {
    if (!(await confirmAsync('Remove cover photo?', 'Your banner goes back to plain green.', 'Remove'))) return;
    setCoverBusy(true);
    const { error } = await supabase.from('profiles').update({ cover_url: null }).eq('id', session.user.id);
    if (error) notify('Could not remove', error.message);
    else await refreshProfile();
    setCoverBusy(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 60 }}>
        {/* Cover banner */}
        <View style={styles.banner}>
          {profile?.cover_url ? (
            <>
              <Image source={{ uri: profile.cover_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <View style={styles.bannerBtns}>
                <TouchableOpacity style={styles.bannerPill} onPress={changeCover} disabled={coverBusy}>
                  <Text style={styles.bannerPillText}>{coverBusy ? '⏳ Working…' : '🖼️ Change'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bannerPill} onPress={removeCover} disabled={coverBusy}>
                  <Text style={styles.bannerPillText}>✕ Remove</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.bannerEmpty, { bottom: 46 }]}
              onPress={changeCover}
              activeOpacity={0.85}
              disabled={coverBusy}
            >
              <Text style={styles.bannerEmptyText}>
                {coverBusy ? '⏳ Uploading…' : '📷 Tap to add a cover photo'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* box-none so this overlapping header doesn't swallow taps meant for
            the banner buttons underneath it */}
        <View style={styles.head} pointerEvents="box-none">
          <TouchableOpacity onPress={changePhoto} activeOpacity={0.85} style={styles.pfpWrap} disabled={photoBusy}>
            <Avatar uri={profile?.avatar_url} name={profile?.full_name} id={session?.user?.id} size={92} style={styles.pfpRing} />
            <View style={styles.camera}>
              <Text style={{ fontSize: 13 }}>{photoBusy ? '⏳' : '📷'}</Text>
            </View>
          </TouchableOpacity>
          <Text style={styles.name}>{profile?.full_name ?? 'Your name'}</Text>
          <Text style={styles.role}>
            {(profile?.role ?? 'participant')} · {profile?.city ?? 'Tashkent'}
          </Text>
          <View style={styles.badges}>
            {profile?.verified_student && <Badge text="✔ Verified student" />}
            {isOrg && <Badge text="🎪 Verified organizer" />}
          </View>
        </View>

        {/* Ranking strip */}
        <TouchableOpacity style={styles.rankStrip} onPress={() => router.push('/leaderboard')} activeOpacity={0.9}>
          <Text style={styles.rankStripLeft}>🏆 {stats.points > 0 ? `#${stats.place} in school` : 'Unranked'}</Text>
          <Text style={styles.rankStripRight}>{stats.points} pts ›</Text>
        </TouchableOpacity>

        {stats.medals?.length > 0 && (
          <View style={styles.medalGrid}>
            {stats.medals.map((a) => (
              <View key={a.id} style={styles.medalTile}>
                <Text style={{ fontSize: 24 }}>{awardMeta(a).emoji}</Text>
                <Text style={styles.medalLabel} numberOfLines={2}>{a.badge?.name ?? awardMeta(a).label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Student Passport — the main action on this screen */}
        <TouchableOpacity style={styles.passport} onPress={() => router.push('/passport')} activeOpacity={0.9}>
          <Text style={styles.passportEmoji}>🪪</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.passportTitle}>Student Passport</Text>
            <Text style={styles.passportSub}>Your education, tests, skills, contacts & medals — what organizers see.</Text>
          </View>
          <Text style={styles.passportArrow}>›</Text>
        </TouchableOpacity>

        {!isOrg && (
          <Text style={styles.orgHint}>Want to host events? Ask a Tadbirly admin to unlock organizer access.</Text>
        )}

        {/* Social stats */}
        <View style={styles.statRow}>
          <Stat value={stats.friends} label="Friends ›" onPress={() => uid && router.push(`/friends/${uid}`)} />
          <Stat value={stats.bestStreak > 0 ? `🔥 ${stats.bestStreak}` : '🔥 0'} label="Best streak" />
          <Stat value={`${profile?.reliability ?? 75}%`} label="Reliability" />
        </View>

        {isOrg ? (
          <>
            <View style={styles.statRow}>
              <Stat value={stats.posts} label="Events hosted" />
              <Stat value={stats.incoming} label="Applicants" />
              <Stat value={stats.attended} label="Events attended" />
            </View>
            <Text style={styles.section}>Your events</Text>
            {stats.events.length === 0 ? (
              <Text style={styles.dim}>None yet. Create one from the Post event tab.</Text>
            ) : (
              stats.events.map((e) => {
                const done = e.status === 'completed';
                return (
                  <TouchableOpacity key={e.id} style={[styles.pastRow, done && { opacity: 0.85 }]} onPress={() => router.push(`/post/${e.id}`)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pastTitle}>🎪 {e.title}</Text>
                      <Text style={styles.pastMeta}>{e.event_date ?? 'no date'} · open →</Text>
                    </View>
                    {done && <Text style={styles.finished}>🏁 FINISHED</Text>}
                  </TouchableOpacity>
                );
              })
            )}
          </>
        ) : (
          <View style={styles.statRow}>
            <Stat value={stats.applications} label="Applications" />
            <Stat value={stats.attended} label="Events attended" />
            <View style={{ flex: 1 }} />
          </View>
        )}

        <TouchableOpacity style={styles.coach} onPress={() => router.push('/coach')}>
          <Text style={styles.coachTitle}>🧭 AI Career Coach</Text>
          <Text style={styles.coachBody}>Get a personalized suggestion for your next event to grow your profile.</Text>
          <Text style={styles.coachCta}>→ Open coach</Text>
        </TouchableOpacity>

        {/* Web push (browser) here; the iOS / Android app has its own section. */}
        {Platform.OS !== 'web' ? (
          <NativePushSection uid={uid} info={pushInfo} setInfo={setPushInfo} />
        ) : (
          <>
            <Button
              title={inAppBrowser()
                ? '🌐 Open in your browser for notifications'
                : notifState === 'granted'
                  ? '🔔 Notifications on — tap to refresh'
                  : notifState === 'denied'
                    ? '🔕 Notifications blocked — how to fix'
                    : '🔔 Turn on notifications'}
              variant="ghost"
              style={{ marginTop: 18 }}
              loading={notifBusy}
              onPress={() => {
                // Telegram & co. can't do notifications at all: send them to a real browser.
                if (inAppBrowser()) { leaveInAppBrowser(); return; }
                // The prompt must start inside this tap (iPhones ignore it after
                // any await). Tapping when already allowed re-links this device
                // to the account — that link is what makes pushes actually land.
                const asked = promptPush(uid);
                unlockAudio();
                setNotifBusy(true);
                asked.then(async (r) => {
                  setNotifState(notificationState());
                  const d = await pushDebug().catch(() => null);
                  setPushInfo(d);
                  setNotifBusy(false);
                  if (r === 'granted') {
                    ping(); buzz();
                    const linked = d?.subscriptionId && d?.optedIn && String(d?.externalId) === String(uid);
                    notify('Notifications on 🔔', linked
                      ? "This device is linked. You'll be told about invites, acceptances and points."
                      : 'Allowed. This device is still being connected — the line under the button shows how far it got.');
                    return;
                  }
                  const help = notificationHelp(r);
                  if (help) notify(help.title, help.body);
                  else notify('Not enabled', 'Tap the button again and choose Allow when your browser asks.');
                });
              }}
            />
            {pushStatusLine(pushInfo, uid) ? (
              <Text
                style={styles.pushStatus}
                onPress={() => pushInfo && notify('Notification status', [
                  `Browser permission: ${pushInfo.nativePermission}`,
                  `Subscription: ${pushInfo.subscriptionId || 'none'}${pushInfo.optedIn ? ' (opted in)' : ''}`,
                  `Linked to: ${pushInfo.externalId ? (String(pushInfo.externalId) === String(uid) ? 'this account' : 'another account') : 'no account'}`,
                ].join('\n'))}
              >
                {pushStatusLine(pushInfo, uid)}
              </Text>
            ) : null}
          </>
        )}
        <TelegramCard uid={uid} />
        <Button title="Privacy & account" variant="ghost" style={{ marginTop: 14 }} onPress={() => router.push('/legal')} />
        <Button title="Log out" variant="ghost" style={{ marginTop: 12 }} onPress={signOut} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
//  Notifications in the iOS / Android app (OneSignal native SDK,
//  lib/push.native.js). Same idea as the web button: one tap asks (or, once
//  refused, opens Settings), and a quiet line says which step is missing.
// ---------------------------------------------------------------------------
function nativeStatusLine(d, uid) {
  if (!d) return null;
  if (!d.configured) return 'This phone: notifications aren’t available in this build';
  if (d.nativePermission === 'denied') return 'This phone: switched off in Settings';
  if (d.nativePermission !== 'granted') return 'This phone: not allowed yet';
  if (!d.sdkReady) return 'This phone: allowed · notification service not reachable';
  const subscribed = !!d.subscriptionId && !!d.optedIn;
  const linked = !d.externalId
    ? 'not linked to your account'
    : String(d.externalId) === String(uid) ? 'linked' : 'linked to a different account';
  return `This phone: allowed · ${subscribed ? 'subscribed' : 'not subscribed yet'} · ${linked}`;
}

function NativePushSection({ uid, info, setInfo }) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  // Back from Settings (or the system prompt): read it again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      pushDebug().then((d) => { if (mounted.current) setInfo(d); }, () => {});
    });
    return () => sub?.remove?.();
  }, [setInfo]);

  const perm = info?.nativePermission;
  if (info && !info.configured) {
    return <Text style={[styles.pushStatus, { marginTop: 18 }]}>{nativeStatusLine(info, uid)}</Text>;
  }

  async function offerSettings() {
    const go = await confirmAsync(
      'Notifications are off',
      'Switch them on for Tadbirly in your phone’s Settings → Notifications.',
      'Open Settings',
    );
    if (go) openPushSettings();
  }

  function onPress() {
    if (perm === 'denied') { offerSettings(); return; }
    setBusy(true);
    promptPush(uid).then(async (r) => {
      const d = await pushDebug().catch(() => null);
      if (!mounted.current) return;
      setInfo(d);
      setBusy(false);
      if (r === 'granted') {
        buzz();
        const linked = d?.subscriptionId && d?.optedIn && String(d?.externalId) === String(uid);
        notify('Notifications on 🔔', linked
          ? "This phone is linked. You'll be told about invites, acceptances and points."
          : 'Allowed. This phone is still being connected — the line under the button shows how far it got.');
      } else if (r === 'denied') {
        offerSettings();
      }
    }, () => { if (mounted.current) setBusy(false); });
  }

  const line = nativeStatusLine(info, uid);
  return (
    <>
      <Button
        title={perm === 'granted'
          ? '🔔 Notifications on — tap to refresh'
          : perm === 'denied'
            ? '🔕 Notifications off — open Settings'
            : '🔔 Turn on notifications'}
        variant="ghost"
        style={{ marginTop: 18 }}
        loading={busy}
        onPress={onPress}
      />
      {line ? (
        <Text
          style={styles.pushStatus}
          onPress={() => info && notify('Notification status', [
            `Permission: ${info.nativePermission}`,
            `Subscription: ${info.subscriptionId || 'none'}${info.optedIn ? ' (opted in)' : ''}`,
            `Linked to: ${info.externalId ? (String(info.externalId) === String(uid) ? 'this account' : 'another account') : 'no account'}`,
          ].join('\n'))}
        >
          {line}
        </Text>
      ) : null}
    </>
  );
}

function Badge({ text }) {
  return <Text style={styles.badge}>{text}</Text>;
}
function Stat({ value, label, onPress }) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap style={styles.stat} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Wrap>
  );
}

// ---------------------------------------------------------------------------
//  Telegram notifications
//  Works on every phone — including iPhones, which only get web push once
//  Tadbirly is on the Home Screen. Hidden until the bot is set up
//  (supabase/24_telegram.sql + functions/telegram-webhook).
//
//  Connecting happens in Telegram: the button opens t.me/<bot>?start=<code>,
//  the student presses Start, and the bot links that chat to the account.
//  This card can't be told when that happens, so after a tap it looks every
//  few seconds (and whenever they come back to the tab) until it sees it.
// ---------------------------------------------------------------------------
const TG_BLUE = '#2481cc';              // Telegram's own button colour
const TG_POLL_EVERY_MS = 3000;
const TG_POLL_FOR_MS = 2 * 60 * 1000;   // after a tap
const TG_BACK_POLL_MS = 30 * 1000;      // after coming back, in case the bot is a beat behind
const TG_TAP_MEMORY_MS = 30 * 60 * 1000;

function pageHidden() {
  return Platform.OS === 'web' && typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

// On the web this has to run inside the tap, before anything is awaited:
// browsers (iPhone Safari above all) block a new tab opened any later.
function openTelegramLink(url) {
  if (Platform.OS !== 'web') {
    Linking.openURL(url).catch(() => notify('Could not open Telegram', 'Make sure Telegram is installed, then try again.'));
    return;
  }
  let win = null;
  try { win = window.open(url, '_blank'); } catch { win = null; }
  if (win) {
    try { win.opener = null; } catch { /* already cross-origin */ }
    return;
  }
  // Popup blocked, or an in-app browser without tabs: go there in this tab.
  window.location.href = url;
}

function TelegramCard({ uid }) {
  const router = useRouter();
  const { focus } = useLocalSearchParams();  // 'telegram' when sent here by the feed strip
  const [tg, setTgState] = useState(null);   // telegram_status(); null until known
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [justLinked, setJustLinked] = useState(false);
  const tgRef = useRef(null);                // the same, for timers and listeners
  const waitUntil = useRef(0);
  const tappedAt = useRef(0);
  const mounted = useRef(true);
  const linkedTimer = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(linkedTimer.current); };
  }, []);

  // Arrived from the feed strip's "Set up": the card is below the fold on a
  // phone, so bring it into view (web; a no-op elsewhere), then drop the
  // param so later visits to the tab don't jump.
  const available = !!tg?.available;
  useEffect(() => {
    if (focus !== 'telegram' || !available) return undefined;
    const t = setTimeout(() => {
      try { cardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); } catch { /* not the web */ }
      router.setParams({ focus: undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [focus, available, router]);

  const setTg = useCallback((s) => { tgRef.current = s; setTgState(s); }, []);
  const stopWaiting = useCallback(() => { waitUntil.current = 0; setWaiting(false); }, []);

  // Reads the status, and notices the moment the account gets connected.
  const check = useCallback(async () => {
    const { data } = await telegramStatus();
    // Error = not set up yet (24_telegram.sql not run) or offline: keep what we had.
    if (!mounted.current || !data) return;
    const was = tgRef.current;
    setTg(data);
    if (data.linked) {
      forgetTelegramLink();                  // linking spent every code this account had
      stopWaiting();
      if (was && !was.linked) {
        setJustLinked(true);
        clearTimeout(linkedTimer.current);
        linkedTimer.current = setTimeout(() => { if (mounted.current) setJustLinked(false); }, 5000);
      }
    } else if (data.available) {
      prefetchTelegramLink(uid);             // does nothing while the one we have is fresh
    }
  }, [uid, setTg, stopWaiting]);

  useFocusEffect(useCallback(() => {
    if (!uid) return undefined;
    let active = true;
    let lastBack = 0;
    check();

    // Back from Telegram (tab visible again / app in front): look straight
    // away, and keep looking a little while if they tapped Connect recently.
    const onBack = () => {
      if (!active || pageHidden() || Date.now() - lastBack < 1000) return;
      lastBack = Date.now();
      const t = tgRef.current;
      if (t && !t.linked && tappedAt.current && Date.now() - tappedAt.current < TG_TAP_MEMORY_MS) {
        waitUntil.current = Math.max(waitUntil.current, Date.now() + TG_BACK_POLL_MS);
        setWaiting(true);
      }
      check();
    };

    const tick = setInterval(() => {
      if (!active) return;
      if (waitUntil.current) {
        if (Date.now() > waitUntil.current) stopWaiting();
        else if (!pageHidden()) check();
        return;
      }
      // Sat on this screen long enough for the prepared link to go stale.
      const t = tgRef.current;
      if (t?.available && !t.linked && !readyTelegramLink(uid)) prefetchTelegramLink(uid);
    }, TG_POLL_EVERY_MS);

    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') onBack(); });
    const web = Platform.OS === 'web' && typeof window !== 'undefined';
    if (web) window.addEventListener('focus', onBack);

    return () => {
      active = false;
      clearInterval(tick);
      sub?.remove?.();
      if (web) window.removeEventListener('focus', onBack);
    };
  }, [uid, check, stopWaiting]));

  function watchForLink() {
    tappedAt.current = Date.now();
    waitUntil.current = Date.now() + TG_POLL_FOR_MS;
    setWaiting(true);
    // A new code for any next tap; the one just opened stays valid.
    prefetchTelegramLink(uid, { force: true });
  }

  function connect() {
    const url = readyTelegramLink(uid);
    if (url) {
      openTelegramLink(url);                 // first thing in the tap — see above
      watchForLink();
      return;
    }
    // Not ready (slow network, or the screen only just opened). The browser
    // may still allow a new tab this soon after the tap; if not, the link
    // opens in this tab instead.
    setBusy(true);
    prefetchTelegramLink(uid, { force: true }).then(({ data, error }) => {
      if (!mounted.current) return;
      setBusy(false);
      if (!data) {
        notify('Could not connect Telegram', error?.message || 'Please check your connection and try again.');
        return;
      }
      openTelegramLink(data);
      watchForLink();
    });
  }

  async function disconnect() {
    const sure = await confirmAsync(
      'Disconnect Telegram?',
      'Tadbirly notifications will stop arriving in Telegram.',
      'Disconnect',
    );
    if (!sure) return;
    setBusy(true);
    const { error } = await telegramUnlink();
    if (!mounted.current) return;
    setBusy(false);
    if (error) {
      notify('Could not disconnect', error.message || 'Please try again.');
      return;
    }
    tappedAt.current = 0;
    stopWaiting();
    setJustLinked(false);
    setTg({ ...tgRef.current, linked: false, username: null, also_push: false });
    check();                                 // and gets a fresh link ready
  }

  async function changeAlsoPush(v) {
    const before = tgRef.current;
    if (!before) return;
    setTg({ ...before, also_push: v });
    const { error } = await telegramSetAlsoPush(v);
    if (!mounted.current || !error) return;
    setTg({ ...tgRef.current, also_push: before.also_push });
    notify('Could not save', error.message || 'Please try again.');
  }

  if (!tg || !tg.available) return null;

  if (tg.linked) {
    return (
      <View ref={cardRef} style={styles.tgCard}>
        <View style={styles.tgHead}>
          <Text style={styles.tgIcon}>✈️</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.tgTitle, justLinked && { color: colors.brand }]}>
              {justLinked ? 'Connected ✓' : 'Telegram notifications'}
            </Text>
            <Text style={styles.tgSub}>
              {justLinked
                ? 'All set — your notifications will arrive in Telegram.'
                : tg.username ? `Connected as @${tg.username}` : 'Connected'}
            </Text>
          </View>
        </View>
        {/* Browser notifications only exist on the web. */}
        {Platform.OS === 'web' && (
          <View style={styles.tgRow}>
            <Text style={styles.tgRowText}>Also send browser notifications</Text>
            <Switch
              value={!!tg.also_push}
              onValueChange={changeAlsoPush}
              trackColor={{ false: colors.line, true: colors.brand }}
              thumbColor="#fff"
              activeThumbColor="#fff"
              accessibilityLabel="Also send browser notifications"
            />
          </View>
        )}
        <Button title="Disconnect" variant="ghost" style={{ marginTop: 12 }} loading={busy} onPress={disconnect} />
      </View>
    );
  }

  return (
    <View ref={cardRef} style={styles.tgCard}>
      <View style={styles.tgHead}>
        <Text style={styles.tgIcon}>✈️</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.tgTitle}>Telegram notifications</Text>
          <Text style={styles.tgSub}>Works on every phone — even iPhones without installing Tadbirly.</Text>
        </View>
      </View>
      <Button
        title="Connect Telegram"
        loading={busy}
        onPress={connect}
        style={{ marginTop: 12, backgroundColor: TG_BLUE }}
      />
      {waiting ? (
        <Text style={styles.tgHint}>Press Start in Telegram — this updates by itself.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { height: 110, marginHorizontal: -18, backgroundColor: colors.brand, overflow: 'hidden' },
  // Top of the banner, clear of the avatar that overlaps the bottom edge.
  bannerBtns: { position: 'absolute', right: 12, top: 10, flexDirection: 'row', gap: 8 },
  bannerPill: { backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  bannerPillText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  bannerEmpty: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bannerEmptyText: { color: 'rgba(255,255,255,0.92)', fontSize: 12.5, fontWeight: '700' },
  head: { alignItems: 'center', paddingBottom: 10, marginTop: -46 },
  pfpWrap: { position: 'relative' },
  pfpRing: { borderWidth: 4, borderColor: colors.bg },
  camera: { position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  rankStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 16, marginTop: 4 },
  rankStripLeft: { color: '#fff', fontWeight: '800', fontSize: 14 },
  rankStripRight: { color: '#e8c96a', fontWeight: '800', fontSize: 14 },
  medalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  medalTile: { width: 86, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center' },
  medalLabel: { fontSize: 10.5, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 14 },
  pfp: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  pfpText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  name: { fontSize: 20, fontWeight: '800', color: colors.ink },
  role: { fontSize: 13, color: colors.muted, marginTop: 2, textTransform: 'capitalize' },
  badges: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { fontSize: 11.5, backgroundColor: colors.brandSoft, color: colors.brand, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 20, fontWeight: '700', overflow: 'hidden' },
  passport: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.brand, borderRadius: radius.lg, padding: 16, marginTop: 16, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 },
  passportEmoji: { fontSize: 34 },
  passportTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  passportSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  passportArrow: { color: '#fff', fontSize: 30, fontWeight: '300' },
  orgHint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 12, lineHeight: 17, paddingHorizontal: 10 },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  stat: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.ink },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  section: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: 22, marginBottom: 8 },
  dim: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  pastRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  pastTitle: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  pastMeta: { fontSize: 12, color: colors.muted, marginTop: 3 },
  finished: { fontSize: 10.5, fontWeight: '900', color: '#fff', backgroundColor: colors.danger, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden', marginLeft: 8, letterSpacing: 0.5 },
  coach: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: 16, marginTop: 18 },
  coachTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  coachBody: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 6, lineHeight: 19 },
  coachCta: { color: '#8fb4ff', fontWeight: '700', marginTop: 10 },
  pushStatus: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 16 },
  tgCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 16, marginTop: 18 },
  tgHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tgIcon: { fontSize: 26 },
  tgTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  tgSub: { fontSize: 12.5, color: colors.muted, marginTop: 3, lineHeight: 17 },
  tgRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 },
  tgRowText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.ink },
  tgHint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 16 },
});

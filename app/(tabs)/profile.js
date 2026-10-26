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
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, type, shadow, column, awardMeta, isDark, setThemePref } from '../../lib/theme';
import { Button, Avatar, SectionHeader, reliabilityText } from '../../components/ui';
import { formatEventWhen } from '../../lib/events';
import { getCoachStatusCached, peekCoachStatus } from '../../lib/coach';
import { sharedStreak } from '../../lib/social';
import { pickImage, uploadAvatar, canPickImage, pickAndUpload } from '../../lib/news';
import { notify, confirmAsync } from '../../lib/notify';
import {
  telegramStatus, telegramUnlink, telegramSetAlsoPush,
  readyTelegramLink, prefetchTelegramLink, forgetTelegramLink,
} from '../../lib/telegram';
import { t } from '../../lib/i18n';

const EMPTY_STATS = { applications: 0, posts: 0, incoming: 0, events: [], attended: 0, friends: 0, bestStreak: 0, points: 0, place: null, medals: [] };

// One quiet line under the notification button: which link in the chain
// "browser allows → OneSignal has a subscription → it's tied to this account"
// is missing, so a student (or the developer) can see why pushes don't arrive.
function pushStatusLine(d, uid) {
  if (!d || !d.configured) return null;
  if (inAppBrowser()) return t('This device: this in-app browser can’t receive notifications');
  if (d.nativePermission === 'unsupported') return t('This device: this browser can’t receive notifications');
  if (d.nativePermission === 'denied') return t('This device: blocked in browser settings');
  if (d.nativePermission !== 'granted') return t('This device: not allowed yet');
  if (!d.sdkReady) return t('This device: allowed · notification service not reachable');
  const subscribed = !!d.subscriptionId && !!d.optedIn;
  const linked = !d.externalId
    ? t('not linked to your account')
    : String(d.externalId) === String(uid) ? t('linked') : t('linked to a different account');
  return t('This device: allowed · {state} · {linked}', { state: subscribed ? t('subscribed') : t('not subscribed'), linked });
}

// The three diagnostic lines behind the status line (tap it to see them).
function pushDetails(d, uid, permissionLine) {
  const PERM = { granted: t('allowed'), denied: t('blocked'), default: t('not asked yet'), unsupported: t('not supported') };
  return [
    permissionLine.replace('{v}', PERM[d.nativePermission] ?? String(d.nativePermission ?? '?')),
    t('Subscription: {v}', { v: d.subscriptionId ? `${d.subscriptionId}${d.optedIn ? ` (${t('opted in')})` : ''}` : t('none') }),
    t('Linked to: {v}', { v: d.externalId ? (String(d.externalId) === String(uid) ? t('this account') : t('another account')) : t('no account') }),
  ].join('\n');
}

export default function Profile() {
  const router = useRouter();
  const { profile, session, signOut, refreshProfile } = useAuth();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [notifState, setNotifState] = useState(notificationState());
  const [notifBusy, setNotifBusy] = useState(false);
  const [pushInfo, setPushInfo] = useState(null);
  // Coach availability, asked once per session (lib/coach caches it).
  const [coachSoon, setCoachSoon] = useState(() => peekCoachStatus()?.code === 'not_configured');
  const isOrg = profile?.role === 'organizer';

  const uid = session?.user?.id;

  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    getCoachStatusCached().then((r) => { if (alive) setCoachSoon(!r.ok && r.code === 'not_configured'); }, () => {});
    return () => { alive = false; };
  }, [uid]);

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
    if (!canPickImage) return notify(t('Open the web app'), t('Photo upload works at tadbirly.expo.app.'));
    if (profile?.avatar_url) {
      const replace = await confirmAsync(t('Profile picture'), t('Choose a new photo, or cancel to keep this one.'), t('Choose new'));
      if (!replace) return;
    }
    const file = await pickImage({ square: true });   // phones get a 1:1 crop
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return notify(t('Image too large'), t('Please pick a photo under 5 MB.'));
    setPhotoBusy(true);
    try {
      const url = await uploadAvatar(file);
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', session.user.id);
      if (error) throw error;
      await refreshProfile();
      refresh();
      notify(t('Photo updated'), '');
    } catch (e) {
      notify(t('Could not upload'), e.message);
    }
    setPhotoBusy(false);
  }

  async function changeCover() {
    if (!canPickImage) return notify(t('Open the web app'), t('Photo upload works at tadbirly.expo.app.'));
    if (coverBusy) return;
    setCoverBusy(true);
    try {
      const url = await pickAndUpload('avatars');
      if (!url) { setCoverBusy(false); return; }           // they cancelled the picker
      const { error } = await supabase.from('profiles').update({ cover_url: url }).eq('id', session.user.id);
      if (error) throw error;
      await refreshProfile();
      notify(t('Cover updated'), '');
    } catch (e) {
      notify(t('Could not update cover'), e.message || t('Please try a smaller image.'));
    }
    setCoverBusy(false);
  }

  async function removeCover() {
    if (!(await confirmAsync(t('Remove cover photo?'), t('Your banner goes back to plain green.'), t('Remove')))) return;
    setCoverBusy(true);
    const { error } = await supabase.from('profiles').update({ cover_url: null }).eq('id', session.user.id);
    if (error) notify(t('Could not remove'), error.message);
    else await refreshProfile();
    setCoverBusy(false);
  }

  const ranked = stats.points > 0 && stats.place;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page}>
        {/* Cover banner */}
        <View style={styles.banner}>
          {profile?.cover_url ? (
            <>
              <Image source={{ uri: profile.cover_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              <View style={styles.bannerBtns}>
                <TouchableOpacity style={styles.bannerPill} onPress={changeCover} disabled={coverBusy} accessibilityLabel={t('Change cover photo')}>
                  <Ionicons name={coverBusy ? 'hourglass-outline' : 'image-outline'} size={13} color="#fff" />
                  <Text style={styles.bannerPillText}>{coverBusy ? t('Working…') : t('Change')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.bannerPill} onPress={removeCover} disabled={coverBusy} accessibilityLabel={t('Remove cover photo')}>
                  <Ionicons name="trash-outline" size={13} color="#fff" />
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
              <View style={styles.bannerAdd}>
                <Ionicons name={coverBusy ? 'hourglass-outline' : 'image-outline'} size={14} color="#fff" />
                <Text style={styles.bannerEmptyText}>{coverBusy ? t('Uploading…') : t('Add a cover photo')}</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* box-none so this overlapping header doesn't swallow taps meant for
            the banner buttons underneath it */}
        <View style={styles.head} pointerEvents="box-none">
          <TouchableOpacity onPress={changePhoto} activeOpacity={0.85} style={styles.pfpWrap} disabled={photoBusy} accessibilityLabel={t('Change profile photo')}>
            <Avatar uri={profile?.avatar_url} name={profile?.full_name} id={session?.user?.id} size={92} style={styles.pfpRing} />
            <View style={styles.camera}>
              <Ionicons name={photoBusy ? 'hourglass-outline' : 'camera'} size={14} color={colors.ink} />
            </View>
          </TouchableOpacity>
          <Text style={styles.name}>{profile?.full_name ?? t('Your name')}</Text>
          <Text style={styles.role}>
            {profile?.role === 'organizer' ? t('Organizer') : t('Participant')} · {t(profile?.city ?? 'Tashkent')}
          </Text>
          <View style={styles.badges}>
            {profile?.verified_student && <Badge icon="checkmark-circle" text={t('Verified student')} />}
            {isOrg && <Badge icon="shield-checkmark" text={t('Verified organizer')} />}
          </View>
        </View>

        {/* Headline numbers */}
        <View style={styles.statsCard}>
          <Stat
            icon="trophy-outline"
            value={ranked ? `#${stats.place}` : '—'}
            label={t('{n} pts', { n: stats.points })}
            onPress={() => router.push('/leaderboard')}
          />
          <View style={styles.statDivider} />
          <Stat icon="people-outline" value={stats.friends} label={t('Friends')} onPress={() => uid && router.push(`/friends/${uid}`)} />
          <View style={styles.statDivider} />
          {/* A best streak of 0 says nothing: it shows once there is one. */}
          {stats.bestStreak > 0 ? (
            <>
              <Stat icon="flame-outline" value={stats.bestStreak} label={t('Best streak')} />
              <View style={styles.statDivider} />
            </>
          ) : null}
          <Stat
            icon="shield-checkmark-outline"
            value={reliabilityText(profile?.reliability, { hasHistory: stats.attended > 0 })}
            label={t('Reliability')}
          />
        </View>

        <View style={styles.statsCard}>
          {isOrg ? (
            <>
              <Stat value={stats.posts} label={t('Events hosted')} />
              <View style={styles.statDivider} />
              <Stat value={stats.incoming} label={t('Applicants')} />
              <View style={styles.statDivider} />
              <Stat value={stats.attended} label={t('Attended')} />
            </>
          ) : (
            <>
              <Stat value={stats.applications} label={t('Applications')} />
              <View style={styles.statDivider} />
              <Stat value={stats.attended} label={t('Events attended')} />
            </>
          )}
        </View>

        {stats.medals?.length > 0 && (
          <>
            <SectionHeader title={t('Pinned medals')} />
            <View style={styles.medalGrid}>
              {stats.medals.map((a) => (
                <View key={a.id} style={styles.medalTile}>
                  <Text style={{ fontSize: 24 }}>{awardMeta(a).emoji}</Text>
                  <Text style={styles.medalLabel} numberOfLines={2}>{a.badge?.name ?? awardMeta(a).label}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Student Passport — the main action on this screen */}
        <TouchableOpacity style={styles.passport} onPress={() => router.push('/passport')} activeOpacity={0.9}>
          <View style={styles.passportIcon}>
            <Ionicons name="id-card-outline" size={24} color={colors.lime} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.passportTitle}>{t('Student Passport')}</Text>
            <Text style={styles.passportSub}>{t('Education, tests, skills, contacts and medals: what organizers see.')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

        {isOrg && (
          <>
            <SectionHeader title={t('Your events')} />
            {stats.events.length === 0 ? (
              <Text style={styles.dim}>{t('None yet. Create one from the Post event tab.')}</Text>
            ) : (
              <View style={styles.menu}>
                {stats.events.map((e, i) => {
                  const done = e.status === 'completed';
                  return (
                    <TouchableOpacity
                      key={e.id}
                      style={[styles.menuRow, i === stats.events.length - 1 && { borderBottomWidth: 0 }]}
                      onPress={() => router.push(`/post/${e.id}`)}
                    >
                      <View style={styles.menuIcon}><Ionicons name="calendar-outline" size={17} color={colors.brand} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.menuText} numberOfLines={1}>{e.title}</Text>
                        <Text style={styles.menuSub}>{e.event_date ? formatEventWhen(e.event_date) : t('No date')}</Text>
                      </View>
                      {done && <Text style={styles.finished}>{t('Finished')}</Text>}
                      <Ionicons name="chevron-forward" size={17} color={colors.faint} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}

        <SectionHeader title={t('Grow')} />
        <View style={styles.menu}>
          <MenuRow icon="bookmark-outline" label={t('Saved events')} sub={t('Bookmarks and deadline reminders')} onPress={() => router.push('/saved')} />
          {isOrg && <MenuRow icon="stats-chart-outline" label={t('Event stats')} sub={t('Views, applications, check-ins, ratings')} onPress={() => router.push('/dashboard')} />}
          <MenuRow icon="compass-outline" label={t('AI Career Coach')} sub={t('A suggestion for your next event')} tag={coachSoon ? t('Soon') : null} onPress={() => router.push('/coach')} last />
        </View>
        {!isOrg && (
          <Text style={styles.orgHint}>{t('Want to host events? Ask a Tadbirly admin to unlock organizer access.')}</Text>
        )}

        <SectionHeader title={t('Notifications')} />
        {/* Web push (browser) here; the iOS / Android app has its own section. */}
        {Platform.OS !== 'web' ? (
          <NativePushSection uid={uid} info={pushInfo} setInfo={setPushInfo} />
        ) : (
          <>
            <Button
              title={inAppBrowser()
                ? t('Open in your browser for notifications')
                : notifState === 'granted'
                  ? t('Notifications on: tap to refresh')
                  : notifState === 'denied'
                    ? t('Notifications blocked: how to fix')
                    : t('Turn on notifications')}
              icon={inAppBrowser()
                ? 'globe-outline'
                : notifState === 'granted'
                  ? 'notifications'
                  : notifState === 'denied'
                    ? 'notifications-off-outline'
                    : 'notifications-outline'}
              variant="ghost"
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
                    notify(t('Notifications on'), linked
                      ? t('This device is linked. You\'ll be told about invites, acceptances and points.')
                      : t('Allowed. This device is still being connected — the line under the button shows how far it got.'));
                    return;
                  }
                  const help = notificationHelp(r);
                  if (help) notify(help.title, help.body);
                  else notify(t('Not enabled'), t('Tap the button again and choose Allow when your browser asks.'));
                });
              }}
            />
            {pushStatusLine(pushInfo, uid) ? (
              <Text
                style={styles.pushStatus}
                onPress={() => pushInfo && notify(t('Notification status'), pushDetails(pushInfo, uid, t('Browser permission: {v}')))}
              >
                {pushStatusLine(pushInfo, uid)}
              </Text>
            ) : null}
          </>
        )}
        <TelegramCard uid={uid} />

        <SectionHeader title={t('Account')} />
        <View style={styles.menu}>
          <DarkModeRow />
          <MenuRow icon="settings-outline" label={t('Settings')} sub={t('Language, dark mode, interests')} onPress={() => router.push('/settings')} />
          <MenuRow icon="lock-closed-outline" label={t('Privacy & account')} onPress={() => router.push('/legal')} />
          <MenuRow icon="log-out-outline" label={t('Log out')} onPress={signOut} danger last />
        </View>
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
  if (!d.configured) return t('This phone: notifications aren’t available in this build');
  if (d.nativePermission === 'denied') return t('This phone: switched off in Settings');
  if (d.nativePermission !== 'granted') return t('This phone: not allowed yet');
  if (!d.sdkReady) return t('This phone: allowed · notification service not reachable');
  const subscribed = !!d.subscriptionId && !!d.optedIn;
  const linked = !d.externalId
    ? t('not linked to your account')
    : String(d.externalId) === String(uid) ? t('linked') : t('linked to a different account');
  return t('This phone: allowed · {state} · {linked}', { state: subscribed ? t('subscribed') : t('not subscribed yet'), linked });
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
    return <Text style={[styles.pushStatus, { marginTop: 0 }]}>{nativeStatusLine(info, uid)}</Text>;
  }

  async function offerSettings() {
    const go = await confirmAsync(
      t('Notifications are off'),
      t('Switch them on for Tadbirly in your phone’s Settings → Notifications.'),
      t('Open Settings'),
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
        notify(t('Notifications on'), linked
          ? t('This phone is linked. You\'ll be told about invites, acceptances and points.')
          : t('Allowed. This phone is still being connected — the line under the button shows how far it got.'));
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
          ? t('Notifications on: tap to refresh')
          : perm === 'denied'
            ? t('Notifications off: open Settings')
            : t('Turn on notifications')}
        icon={perm === 'granted' ? 'notifications' : perm === 'denied' ? 'notifications-off-outline' : 'notifications-outline'}
        variant="ghost"
        loading={busy}
        onPress={onPress}
      />
      {line ? (
        <Text
          style={styles.pushStatus}
          onPress={() => info && notify(t('Notification status'), pushDetails(info, uid, t('Permission: {v}')))}
        >
          {line}
        </Text>
      ) : null}
    </>
  );
}

function Badge({ icon, text }) {
  return (
    <View style={styles.badge}>
      <Ionicons name={icon} size={13} color={colors.brand} />
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}
function Stat({ icon, value, label, onPress }) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap style={styles.stat} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.statTop}>
        {icon ? <Ionicons name={icon} size={14} color={colors.brand} /> : null}
        <Text style={styles.statValue}>{value}</Text>
      </View>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </Wrap>
  );
}
// One-tap light/dark switch. The web reloads straight into the new look; the
// phone apps build their colours at launch, so they switch on the next start.
function DarkModeRow() {
  const [on, setOn] = useState(isDark);
  function change(v) {
    setOn(v);
    const applied = setThemePref(v ? 'dark' : 'light');
    if (!applied) notify(t('Saved'), t('Close and reopen Tadbirly to switch the look.'));
  }
  return (
    <View style={styles.menuRow}>
      <View style={styles.menuIcon}>
        <Ionicons name={on ? 'moon' : 'sunny-outline'} size={17} color={colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.menuText}>{t('Dark mode')}</Text>
        <Text style={styles.menuSub}>{on ? t('On') : t('Off')}</Text>
      </View>
      <Switch
        value={on}
        onValueChange={change}
        trackColor={{ false: colors.lineStrong, true: colors.brand }}
        thumbColor="#fff"
        activeThumbColor="#fff"
        accessibilityLabel={t('Dark mode')}
      />
    </View>
  );
}

function MenuRow({ icon, label, sub, onPress, danger, last, tag }) {
  return (
    <TouchableOpacity style={[styles.menuRow, last && { borderBottomWidth: 0 }]} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.menuIcon, danger && { backgroundColor: colors.dangerSoft }]}>
        <Ionicons name={icon} size={17} color={danger ? colors.danger : colors.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.menuText, danger && { color: colors.danger }, { flexShrink: 1 }]}>{label}</Text>
          {tag ? <Text style={styles.menuTag}>{tag}</Text> : null}
        </View>
        {sub ? <Text style={styles.menuSub}>{sub}</Text> : null}
      </View>
      {!danger && <Ionicons name="chevron-forward" size={17} color={colors.faint} />}
    </TouchableOpacity>
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
    Linking.openURL(url).catch(() => notify(t('Could not open Telegram'), t('Make sure Telegram is installed, then try again.')));
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
        notify(t('Could not connect Telegram'), error?.message || t('Please check your connection and try again.'));
        return;
      }
      openTelegramLink(data);
      watchForLink();
    });
  }

  async function disconnect() {
    const sure = await confirmAsync(
      t('Disconnect Telegram?'),
      t('Tadbirly notifications will stop arriving in Telegram.'),
      t('Disconnect'),
    );
    if (!sure) return;
    setBusy(true);
    const { error } = await telegramUnlink();
    if (!mounted.current) return;
    setBusy(false);
    if (error) {
      notify(t('Could not disconnect'), error.message || t('Please try again.'));
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
    notify(t('Could not save'), error.message || t('Please try again.'));
  }

  if (!tg || !tg.available) return null;

  if (tg.linked) {
    return (
      <View ref={cardRef} style={styles.tgCard}>
        <View style={styles.tgHead}>
          <View style={styles.tgIcon}><Ionicons name="paper-plane" size={18} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.tgTitle, justLinked && { color: colors.brand }]}>
              {justLinked ? t('Connected') : t('Telegram notifications')}
            </Text>
            <Text style={styles.tgSub}>
              {justLinked
                ? t('All set — your notifications will arrive in Telegram.')
                : tg.username ? t('Connected as @{name}', { name: tg.username }) : t('Connected')}
            </Text>
          </View>
        </View>
        {/* Browser notifications only exist on the web. */}
        {Platform.OS === 'web' && (
          <View style={styles.tgRow}>
            <Text style={styles.tgRowText}>{t('Also send browser notifications')}</Text>
            <Switch
              value={!!tg.also_push}
              onValueChange={changeAlsoPush}
              trackColor={{ false: colors.line, true: colors.brand }}
              thumbColor="#fff"
              activeThumbColor="#fff"
              accessibilityLabel={t('Also send browser notifications')}
            />
          </View>
        )}
        <Button title={t('Disconnect')} variant="ghost" style={{ marginTop: 12 }} loading={busy} onPress={disconnect} />
      </View>
    );
  }

  return (
    <View ref={cardRef} style={styles.tgCard}>
      <View style={styles.tgHead}>
        <View style={styles.tgIcon}><Ionicons name="paper-plane" size={18} color="#fff" /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.tgTitle}>{t('Telegram notifications')}</Text>
          <Text style={styles.tgSub}>{t('Works on every phone, even iPhones without installing Tadbirly.')}</Text>
        </View>
      </View>
      <Button
        title={t('Connect Telegram')}
        loading={busy}
        onPress={connect}
        style={{ marginTop: 12, backgroundColor: TG_BLUE }}
      />
      {waiting ? (
        <Text style={styles.tgHint}>{t('Press Start in Telegram — this updates by itself.')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: 16, paddingBottom: 60, ...column },
  banner: { height: 120, marginHorizontal: -16, backgroundColor: colors.brand, overflow: 'hidden' },
  // Top of the banner, clear of the avatar that overlaps the bottom edge.
  bannerBtns: { position: 'absolute', right: 12, top: 10, flexDirection: 'row', gap: 8 },
  bannerPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11 },
  bannerPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  bannerEmpty: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  bannerAdd: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  bannerEmptyText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  head: { alignItems: 'center', paddingBottom: 6, marginTop: -46 },
  pfpWrap: { position: 'relative' },
  pfpRing: { borderWidth: 4, borderColor: colors.bg },
  camera: { position: 'absolute', right: 0, bottom: 2, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', ...shadow.sm },
  name: { ...type.h1, fontSize: 22, marginTop: 10 },
  role: { fontSize: 13.5, color: colors.muted, marginTop: 2, textTransform: 'capitalize' },
  badges: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandSoft, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  badgeText: { fontSize: 12, color: colors.brand, fontWeight: '600' },
  statsCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, paddingVertical: 14, marginTop: 12, ...shadow.sm },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: 18, fontWeight: '800', color: colors.ink, letterSpacing: -0.3 },
  statLabel: { fontSize: 11.5, color: colors.muted, marginTop: 3 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.line },
  medalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  medalTile: { width: 86, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 6, alignItems: 'center' },
  medalLabel: { fontSize: 10.5, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 14 },
  passport: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.brand, borderRadius: radius.lg, padding: 16, marginTop: 16, ...shadow.md },
  passportIcon: { width: 46, height: 46, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  passportTitle: { color: '#fff', fontSize: 16.5, fontWeight: '700' },
  passportSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  orgHint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 17, paddingHorizontal: 10 },
  dim: { fontSize: 13, color: colors.muted, lineHeight: 20 },
  menu: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  menuIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  menuText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  menuSub: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  menuTag: { fontSize: 10.5, fontWeight: '800', color: colors.warn, backgroundColor: colors.warnSoft, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, overflow: 'hidden', letterSpacing: 0.3 },
  finished: { fontSize: 11, fontWeight: '700', color: colors.muted, backgroundColor: colors.bg, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  pushStatus: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 16 },
  tgCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 16, marginTop: 12 },
  tgHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tgIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: TG_BLUE, alignItems: 'center', justifyContent: 'center' },
  tgTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  tgSub: { fontSize: 12.5, color: colors.muted, marginTop: 3, lineHeight: 17 },
  tgRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 },
  tgRowText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.ink },
  tgHint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 16 },
});

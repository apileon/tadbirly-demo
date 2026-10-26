import { Ionicons } from '@expo/vector-icons';
import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Linking, Image } from 'react-native';
import { notify } from '../../lib/notify';
import { useLocalSearchParams, useFocusEffect, useRouter, useNavigation } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow, column, awardMeta, typeMeta } from '../../lib/theme';
import { formatEventWhen } from '../../lib/events';
import { t } from '../../lib/i18n';
import { Button, Avatar, EmptyState, Section as UISection, reliabilityText } from '../../components/ui';
import { sendConnect, connectionStatus, openDirectChat, respondConnect } from '../../lib/social';
import { fetchContactDetails, useReportSheet, useBlockedIds, unblockUser } from '../../lib/moderation';

// "Kent +4 mutual friends", the way Instagram phrases it.
function mutualLabel(list) {
  if (list.length === 0) return '';
  const first = (list[0].full_name ?? t('Someone')).split(/\s+/)[0];
  if (list.length === 1) return t('{name} is a mutual friend', { name: first });
  const more = list.length - 1;
  return more === 1
    ? t('{name} +1 mutual friend', { name: first })
    : t('{name} +{n} mutual friends', { name: first, n: more });
}

// Everything this screen shows — deliberately NOT phone / telegram / linkedin,
// which come from contact_details() and only for people allowed to see them.
const PROFILE_COLUMNS = 'id, full_name, avatar_url, cover_url, role, city, verified_student, reliability, bio, university, major, academic_year, honors, skills, languages, ielts, sat, act, milliy';

export default function PublicProfile() {
  // fromChat: set by a chat's header when it opened this profile.
  const { id, fromChat } = useLocalSearchParams();
  const { session, profile: me } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [p, setP] = useState(null);
  const [awards, setAwards] = useState([]);
  const [mutuals, setMutuals] = useState([]);
  const [friendCount, setFriendCount] = useState(0);
  const [recent, setRecent] = useState([]);
  const [status, setStatus] = useState(null);
  const [awardable, setAwardable] = useState([]); // my events where this person is accepted
  const [loading, setLoading] = useState(true);
  const [contact, setContact] = useState(null);
  // Organizers: their rating and what they're running now (supabase/29).
  const [org, setOrg] = useState(null);
  const [orgEvents, setOrgEvents] = useState([]);
  const blockedIds = useBlockedIds();
  const safety = useReportSheet({ onBlocked: () => { setStatus(null); load(); } });
  const isMe = session?.user?.id === id;
  const iAmOrg = me?.role === 'organizer';

  const load = useCallback(async () => {
    const me = session?.user?.id;
    const none = Promise.resolve({ data: null });
    // One round: everything this screen needs goes out at once. The organizer
    // part is asked for everyone (an empty answer for students) rather than
    // waiting to learn the role first.
    const [profileRes, awardsRes, mutualRes, friendsRes, eventsRes, contactRes, statusRes, ratingRes, openRes, appsRes] = await Promise.all([
      loadProfileRow(id),
      supabase.from('awards')
        .select('*, badge:badges(name, emoji), post:posts(title)')
        .eq('recipient_id', id).eq('pinned', true).order('created_at', { ascending: false }),
      isMe ? Promise.resolve({ data: [] }) : supabase.rpc('mutual_friends', { target: id }),
      supabase.rpc('friends_of', { target: id }),
      supabase.rpc('recent_events_of', { target: id, n: 3 }),
      fetchContactDetails(id).catch(() => null),
      isMe ? Promise.resolve(null) : connectionStatus(id).catch(() => null),
      supabase.rpc('organizer_rating', { target: id }),
      supabase.from('posts').select('id, title, event_date, category, city, is_online')
        .eq('author_id', id).eq('status', 'open')
        .order('event_date', { ascending: true, nullsFirst: false }).limit(5),
      iAmOrg && !isMe && me
        ? supabase.from('applications').select('post:posts(id, title, author_id)').eq('applicant_id', id).eq('status', 'accepted')
        : none,
    ]);
    setP(profileRes.data);
    setContact(contactRes);
    setAwards(awardsRes.data ?? []);
    setMutuals(mutualRes.data ?? []);
    setFriendCount((friendsRes.data ?? []).length);
    setRecent(eventsRes.data ?? []);
    if (profileRes.data?.role === 'organizer') {
      setOrg(ratingRes.error ? null : (ratingRes.data?.[0] ?? null));
      setOrgEvents(openRes.data ?? []);
    } else {
      setOrg(null);
      setOrgEvents([]);
    }
    if (!isMe) setStatus(statusRes);
    setAwardable((appsRes.data ?? []).map((a) => a.post).filter((po) => po && po.author_id === me));
    setLoading(false);
  }, [id, isMe, iAmOrg, session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!p) return <EmptyState icon="person-outline" title={t('Profile not found.')} />;
  const iBlocked = !isMe && blockedIds.has(id);
  const c = contact ?? {};

  const firstName = (p.full_name ?? t('This student')).trim().split(/\s+/)[0];
  const hasEducation = !!(p.university || p.major || p.academic_year);
  const hasLists = (p.honors ?? []).length > 0 || (p.skills ?? []).length > 0 || (p.languages ?? []).length > 0;
  const tests = [p.ielts && `IELTS ${p.ielts}`, p.sat && `SAT ${p.sat}`, p.act && `ACT ${p.act}`, p.milliy && `MILLIY ${p.milliy}`].filter(Boolean);

  const isEmptyPassport = !p.bio && !hasEducation && !hasLists && tests.length === 0 && awards.length === 0;
  const friendsText = friendCount === 1 ? t('1 friend') : t('{n} friends', { n: friendCount });

  async function addFriend() {
    const { error } = await sendConnect(id);
    // sendConnect words its own errors (already friends, they asked you first,
    // offline…) — show the real one.
    if (error) notify(t('Could not send the request'), error.message);
    else { notify(t('Request sent'), t('They can accept you from their Portal, under Networking.')); load(); }
  }

  async function respond(accept) {
    if (!status?.row) return;
    const { error } = await respondConnect(status.row, accept);
    if (error) return notify(t('Could not respond'), error.message);
    notify(accept ? t('You are now friends') : t('Request declined'), accept ? t('You can message each other now.') : '');
    load();
  }
  // True when the screen right under this one is that very chat (we were
  // opened from its header). Pushing it again would stack a second copy of the
  // same chat — going back is what the person means.
  function cameFromChat(cid) {
    if (!fromChat || String(fromChat) !== String(cid) || !router.canGoBack()) return false;
    try {
      const state = navigation.getState?.();
      const below = state?.routes?.[state.index - 1];
      if (below) return below.name === 'chat/[id]' && String(below.params?.id) === String(cid);
    } catch { /* no navigation state to check — trust fromChat */ }
    return true;
  }

  async function chat() {
    try {
      const cid = await openDirectChat(id);
      if (cameFromChat(cid)) router.back();
      else router.push(`/chat/${cid}`);
    } catch (e) { notify(t('Could not open chat'), e.message); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      {/* Cover banner: their photo, or plain brand green. */}
      <View style={styles.banner}>
        {p.cover_url ? (
          <Image source={{ uri: p.cover_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : null}
      </View>
      <View style={styles.head}>
        <Avatar uri={p.avatar_url} name={p.full_name} id={p.id} size={84} style={styles.pfpRing} />
        <Text style={styles.name}>{p.full_name}</Text>
        <Text style={styles.role}>
          {p.role === 'organizer' ? t('Organizer') : t('Participant')} · {t(p.city ?? 'Tashkent')}
        </Text>
        <View style={styles.badges}>
          {p.verified_student && (
            <View style={styles.badge}>
              <Ionicons name="checkmark-circle" size={13} color={colors.brand} />
              <Text style={styles.badgeText}>{t('Verified student')}</Text>
            </View>
          )}
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={13} color={colors.brand} />
            <Text style={styles.badgeText}>{reliabilityText(p.reliability, { hasHistory: recent.length > 0 || awards.length > 0, format: '{n}% reliability' })}</Text>
          </View>
        </View>
      </View>

      {iBlocked && (
        <View style={styles.blockedBox}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Ionicons name="ban-outline" size={18} color={colors.danger} />
            <Text style={styles.blockedText}>
              {t("You blocked {name}. They can't message you or send you requests, and their content is hidden from you.", { name: firstName })}
            </Text>
          </View>
          <Button
            title={t('Unblock')}
            variant="ghost"
            size="sm"
            style={{ marginTop: 12 }}
            onPress={async () => {
              const { error } = await unblockUser(id);
              if (error) return notify(t('Could not unblock'), error.message);
              notify(t('Unblocked'), t("You'll see {name}'s content again.", { name: firstName }));
              load();
            }}
          />
        </View>
      )}

      {!isMe && !iBlocked && (
        status?.status === 'pending' && status.incoming ? (
          <View style={styles.requestBox}>
            <View style={styles.requestHead}>
              <Ionicons name="person-add-outline" size={17} color={colors.brand} />
              <Text style={styles.requestText}>{t('{name} wants to be your friend', { name: firstName })}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button title={t('Accept')} icon="checkmark" style={{ flex: 1 }} onPress={() => respond(true)} />
              <Button title={t('Decline')} variant="ghost" style={{ flex: 1 }} onPress={() => respond(false)} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            {status?.status === 'accepted' ? (
              <Button title={t('Message')} icon="chatbubbles-outline" style={{ flex: 1 }} onPress={chat} />
            ) : status?.status === 'pending' ? (
              <Button title={t('Request sent')} icon="time-outline" variant="ghost" style={{ flex: 1 }} disabled />
            ) : (
              <Button title={t('Add friend')} icon="person-add-outline" style={{ flex: 1 }} onPress={addFriend} />
            )}
          </View>
        )
      )}

      {p.role === 'organizer' && (org || orgEvents.length > 0) && (
        <View style={styles.orgCard}>
          <View style={styles.orgHead}>
            <Ionicons name="shield-checkmark" size={16} color={colors.brand} />
            <Text style={styles.orgTitle}>{t('Organizer')}</Text>
          </View>
          {org ? (
            <View style={styles.orgStats}>
              <View style={styles.orgStat}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.orgNum}>{org.rating != null ? Number(org.rating).toFixed(1) : '-'}</Text>
                  {org.rating != null ? <Ionicons name="star" size={15} color={colors.warn} /> : null}
                </View>
                <Text style={styles.orgLabel}>{org.reviews === 1 ? t('1 review') : t('{n} reviews', { n: org.reviews ?? 0 })}</Text>
              </View>
              <View style={styles.orgStat}>
                <Text style={styles.orgNum}>{org.events ?? 0}</Text>
                <Text style={styles.orgLabel}>{t('Events')}</Text>
              </View>
              <View style={styles.orgStat}>
                <Text style={styles.orgNum}>{org.participants ?? 0}</Text>
                <Text style={styles.orgLabel}>{t('Participants')}</Text>
              </View>
            </View>
          ) : null}
          {orgEvents.length > 0 && (
            <>
              <Text style={styles.orgSub}>{t('Open now')}</Text>
              {orgEvents.map((e) => (
                <TouchableOpacity key={e.id} style={styles.orgEvent} onPress={() => router.push(`/post/${e.id}`)}>
                  <Ionicons name="calendar-outline" size={16} color={colors.brand} />
                  <Text style={styles.orgEventTitle} numberOfLines={1}>{e.title}</Text>
                  <Ionicons name="chevron-forward" size={15} color={colors.faint} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      )}

      {awardable.length > 0 && (
        <Section title={t('Give an award')} icon="medal-outline">
          <Text style={[styles.body, { marginBottom: 4 }]}>
            {awardable.length === 1
              ? t('This person was accepted to your event. Open it to rank and award them:')
              : t('This person was accepted to your events. Pick one to rank and award them:')}
          </Text>
          {awardable.map((po, i) => (
            <TouchableOpacity key={po.id} style={[styles.linkRow, i === awardable.length - 1 && { borderBottomWidth: 0 }]} onPress={() => router.push(`/badge/${po.id}`)}>
              <View style={styles.linkIcon}><Ionicons name="trophy-outline" size={16} color={colors.brand} /></View>
              <Text style={styles.linkText} numberOfLines={1}>{po.title}</Text>
              <Text style={styles.linkGo}>{t('Award')}</Text>
              <Ionicons name="chevron-forward" size={15} color={colors.brand} />
            </TouchableOpacity>
          ))}
        </Section>
      )}

      {p.bio ? (
        <View style={styles.sticky}><Text style={styles.stickyText}>{p.bio}</Text></View>
      ) : null}

      {(c.telegram || c.phone || c.linkedin) ? (
        <Section title={t('Contact')} icon="call-outline">
          {c.telegram ? <ContactRow icon="paper-plane-outline" label={`Telegram · @${String(c.telegram).replace(/^@/, '')}`} onPress={() => Linking.openURL(`https://t.me/${String(c.telegram).replace(/^@/, '')}`)} /> : null}
          {c.phone ? <ContactRow icon="call-outline" label={c.phone} onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}
          {c.linkedin ? <ContactRow icon="logo-linkedin" label={t('LinkedIn profile')} onPress={() => Linking.openURL(String(c.linkedin).startsWith('http') ? c.linkedin : `https://${c.linkedin}`)} /> : null}
          {isMe ? <Text style={styles.contactNote}>{t('Only your friends and the organizers of events you apply to can see these.')}</Text> : null}
        </Section>
      ) : null}

      {/* Friends + mutual friends, Instagram-style */}
      <TouchableOpacity style={styles.socialRow} onPress={() => router.push(`/friends/${id}`)} activeOpacity={0.85}>
        {mutuals.length > 0 ? (
          <>
            <View style={styles.stack}>
              {mutuals.slice(0, 3).map((m, i) => (
                <Avatar
                  key={m.id}
                  uri={m.avatar_url}
                  name={m.full_name}
                  id={m.id}
                  size={28}
                  style={{ marginLeft: i ? -9 : 0, borderWidth: 2, borderColor: colors.card }}
                />
              ))}
            </View>
            <Text style={styles.socialText} numberOfLines={2}>
              <Text style={{ fontWeight: '800', color: colors.ink }}>{mutualLabel(mutuals)}</Text>
              {'  ·  '}{friendsText}
            </Text>
          </>
        ) : (
          <>
            <View style={styles.socialIcon}><Ionicons name="people-outline" size={17} color={colors.brand} /></View>
            <Text style={styles.socialText}>
              <Text style={{ fontWeight: '800', color: colors.ink }}>{friendsText}</Text>
              {!isMe ? `  ·  ${t('No mutual friends yet')}` : ''}
            </Text>
          </>
        )}
        <Ionicons name="chevron-forward" size={17} color={colors.faint} />
      </TouchableOpacity>

      {recent.length > 0 && (
        <Section title={t('Recently attended')} icon="calendar-outline">
          {recent.map((e, i) => (
            <TouchableOpacity key={e.id} style={[styles.linkRow, i === recent.length - 1 && { borderBottomWidth: 0 }]} onPress={() => router.push(`/post/${e.id}`)}>
              <View style={styles.linkIcon}><Ionicons name={typeMeta(e.category).icon} size={16} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.recentTitle} numberOfLines={1}>{e.title}</Text>
                <Text style={styles.recentMeta}>
                  {e.event_date ? formatEventWhen(e.event_date) : t('Date not set')}{e.status === 'completed' ? ` · ${t('Finished')}` : ''}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={colors.faint} />
            </TouchableOpacity>
          ))}
        </Section>
      )}

      {isEmptyPassport && (
        <View style={styles.blank}>
          <EmptyState
            icon="id-card-outline"
            title={isMe ? t('Your passport is empty') : t('Passport not filled in yet')}
            text={isMe
              ? t('Add your school, skills and contacts so organizers know who you are when you apply.')
              : t("{name} hasn't added education or skills yet. You can still connect or message them.", { name: firstName })}
            action={isMe ? t('Fill in my passport') : null}
            onAction={() => router.push('/passport')}
            style={{ paddingVertical: 24 }}
          />
        </View>
      )}

      {hasEducation && (
        <Section title={t('Education')} icon="school-outline">
          {row(t('University / School'), p.university)}
          {row(t('Major'), p.major)}
          {row(t('Academic year'), p.academic_year)}
        </Section>
      )}

      {tests.length > 0 && (
        <Section title={t('Standardized tests')} icon="stats-chart-outline">
          <View style={styles.chips}>
            {tests.map((x) => <Text key={x} style={[styles.chip, styles.testChip]}>{x}</Text>)}
          </View>
        </Section>
      )}

      {(p.honors ?? []).length > 0 && (
        <Section title={t('Honors')} icon="ribbon-outline"><Chips items={p.honors} /></Section>
      )}
      {(p.skills ?? []).length > 0 && (
        <Section title={t('Skills')} icon="construct-outline"><Chips items={p.skills} /></Section>
      )}
      {(p.languages ?? []).length > 0 && (
        <Section title={t('Languages')} icon="language-outline"><Chips items={p.languages} /></Section>
      )}

      {awards.length > 0 && (
        <Section title={t('Pinned achievements')} icon="medal-outline">
          {awards.map((a, i) => {
            const m = awardMeta(a);
            return (
              <View key={a.id} style={[styles.award, i === awards.length - 1 && { marginBottom: 0 }]}>
                <View style={styles.awardEmojiBox}><Text style={{ fontSize: 24 }}>{m.emoji}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.awardName}>{t(m.label)} · {a.badge?.emoji ?? ''} {a.badge?.name}</Text>
                  {a.post?.title ? <Text style={styles.awardEvent}>{a.post.title}</Text> : null}
                  {a.note ? <Text style={styles.awardNote}>“{a.note}”</Text> : null}
                </View>
              </View>
            );
          })}
        </Section>
      )}

      {!isMe && (
        <TouchableOpacity
          style={styles.reportLink}
          onPress={() => safety.open({ type: 'user', id, userId: id, name: p.full_name ?? firstName })}
        >
          <Ionicons name="flag-outline" size={14} color={colors.muted} />
          <Text style={styles.reportText}>{t('Report or block {name}', { name: firstName })}</Text>
        </TouchableOpacity>
      )}
      {safety.sheet}
    </ScrollView>
  );
}

// The profile without contact columns. Falls back to the whole row only if
// this database lacks one of the listed columns (an older migration).
async function loadProfileRow(id) {
  const res = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).single();
  if (res.error && (res.error.code === '42703' || res.error.code === 'PGRST204')) {
    const all = await supabase.from('profiles').select('*').eq('id', id).single();
    if (all.data) { delete all.data.phone; delete all.data.telegram; delete all.data.linkedin; }
    return all;
  }
  return res;
}

const row = (label, value) => (value ? (
  <View style={styles.kv}><Text style={styles.k}>{label}</Text><Text style={styles.v}>{value}</Text></View>
) : null);

// The shared card section, with this screen's soft shadow.
function Section(props) {
  return <UISection {...props} style={styles.section} />;
}
function ContactRow({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.linkRow} onPress={onPress}>
      <View style={styles.linkIcon}><Ionicons name={icon} size={16} color={colors.brand} /></View>
      <Text style={styles.linkText} numberOfLines={1}>{label}</Text>
      <Text style={styles.linkGo}>{t('Open')}</Text>
      <Ionicons name="open-outline" size={14} color={colors.brand} />
    </TouchableOpacity>
  );
}
function Chips({ items }) {
  return (
    <View style={styles.chips}>
      {items.map((it) => <Text key={it} style={styles.chip}>{it}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, ...column },
  orgCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    padding: 16, marginBottom: 12, ...shadow.sm,
  },
  orgHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  orgTitle: { fontSize: 13, fontWeight: '700', color: colors.brand, textTransform: 'uppercase', letterSpacing: 0.6 },
  orgStats: { flexDirection: 'row', marginTop: 12 },
  orgStat: { flex: 1, alignItems: 'center' },
  orgNum: { fontSize: 20, fontWeight: '800', color: colors.ink },
  orgLabel: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  orgSub: { fontSize: 12, fontWeight: '700', color: colors.muted, marginTop: 14, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 },
  orgEvent: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  orgEventTitle: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.ink },
  banner: { height: 120, marginHorizontal: -16, marginTop: -16, backgroundColor: colors.brand, overflow: 'hidden' },
  head: { alignItems: 'center', paddingBottom: 16, marginTop: -42 },
  pfpRing: { borderWidth: 4, borderColor: colors.bg, marginBottom: 8 },
  name: { ...type.h1, textAlign: 'center' },
  role: { ...type.small, marginTop: 2 },
  badges: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.brandSoft, paddingVertical: 5, paddingHorizontal: 11, borderRadius: radius.pill,
  },
  badgeText: { fontSize: 11.5, color: colors.brand, fontWeight: '700' },
  sticky: {
    backgroundColor: colors.warnSoft, borderRadius: radius.sm, padding: 16, marginBottom: 14, marginTop: 2,
    borderWidth: 1, borderColor: colors.line, ...shadow.sm,
  },
  stickyText: { fontSize: 14.5, color: colors.ink, fontStyle: 'italic', lineHeight: 21 },
  socialRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12,
  },
  socialIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  stack: { flexDirection: 'row', alignItems: 'center' },
  socialText: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 18 },
  recentTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  recentMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  requestBox: { backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.lg, padding: 14, marginBottom: 12 },
  requestHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  requestText: { fontSize: 14, fontWeight: '800', color: colors.brand, textAlign: 'center', flexShrink: 1 },
  blank: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.lineStrong, borderStyle: 'dashed', borderRadius: radius.lg, marginBottom: 12 },
  section: { ...shadow.sm },
  body: { ...type.body, fontSize: 14 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  k: { fontSize: 13, color: colors.muted },
  v: { fontSize: 13.5, color: colors.ink, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  linkIcon: { width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1, fontSize: 14, color: colors.ink, fontWeight: '600' },
  linkGo: { fontSize: 12.5, color: colors.brand, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    fontSize: 12.5, backgroundColor: colors.bg, color: colors.ink, paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', fontWeight: '600',
  },
  testChip: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft, color: colors.brand },
  award: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  awardEmojiBox: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' },
  awardName: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  awardEvent: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  awardNote: { fontSize: 13, color: colors.body, fontStyle: 'italic', marginTop: 2 },
  contactNote: { ...type.small, fontSize: 12, marginTop: 10 },
  blockedBox: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: colors.dangerSoft, borderRadius: radius.lg, padding: 14, marginBottom: 12 },
  blockedText: { flex: 1, fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  reportLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 10 },
  reportText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
});

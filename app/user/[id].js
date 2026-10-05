import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Linking } from 'react-native';
import { notify } from '../../lib/notify';
import { useLocalSearchParams, useFocusEffect, useRouter, useNavigation } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, awardMeta, typeMeta } from '../../lib/theme';

// "Kent +4 mutual friends", the way Instagram phrases it.
function mutualLabel(list) {
  if (list.length === 0) return '';
  const first = (list[0].full_name ?? 'Someone').split(/\s+/)[0];
  if (list.length === 1) return `${first} is a mutual friend`;
  return `${first} +${list.length - 1} mutual friend${list.length - 1 === 1 ? '' : 's'}`;
}
import { Button, Avatar } from '../../components/ui';
import { sendConnect, connectionStatus, openDirectChat, respondConnect } from '../../lib/social';
import { fetchContactDetails, useReportSheet, useBlockedIds, unblockUser } from '../../lib/moderation';

// Everything this screen shows — deliberately NOT phone / telegram / linkedin,
// which come from contact_details() and only for people allowed to see them.
const PROFILE_COLUMNS = 'id, full_name, avatar_url, role, city, verified_student, reliability, bio, university, major, academic_year, honors, skills, languages, ielts, sat, act, milliy';

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
  const blockedIds = useBlockedIds();
  const safety = useReportSheet({ onBlocked: () => { setStatus(null); load(); } });
  const isMe = session?.user?.id === id;
  const iAmOrg = me?.role === 'organizer';

  const load = useCallback(async () => {
    const [profileRes, awardsRes, mutualRes, friendsRes, eventsRes] = await Promise.all([
      loadProfileRow(id),
      supabase.from('awards')
        .select('*, badge:badges(name, emoji), post:posts(title)')
        .eq('recipient_id', id).eq('pinned', true).order('created_at', { ascending: false }),
      isMe ? Promise.resolve({ data: [] }) : supabase.rpc('mutual_friends', { target: id }),
      supabase.rpc('friends_of', { target: id }),
      supabase.rpc('recent_events_of', { target: id, n: 3 }),
    ]);
    setP(profileRes.data);
    setContact(await fetchContactDetails(id));
    setAwards(awardsRes.data ?? []);
    setMutuals(mutualRes.data ?? []);
    setFriendCount((friendsRes.data ?? []).length);
    setRecent(eventsRes.data ?? []);
    if (!isMe) setStatus(await connectionStatus(id));
    if (iAmOrg && !isMe && session?.user?.id) {
      const { data: apps } = await supabase
        .from('applications')
        .select('post:posts(id, title, author_id)')
        .eq('applicant_id', id).eq('status', 'accepted');
      setAwardable((apps ?? []).map((a) => a.post).filter((po) => po && po.author_id === session.user.id));
    }
    setLoading(false);
  }, [id, isMe, iAmOrg, session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!p) return <Text style={styles.empty}>Profile not found.</Text>;
  const iBlocked = !isMe && blockedIds.has(id);
  const c = contact ?? {};

  const firstName = (p.full_name ?? 'This student').trim().split(/\s+/)[0];
  const hasEducation = !!(p.university || p.major || p.academic_year);
  const hasLists = (p.honors ?? []).length > 0 || (p.skills ?? []).length > 0 || (p.languages ?? []).length > 0;
  const tests = [p.ielts && `IELTS ${p.ielts}`, p.sat && `SAT ${p.sat}`, p.act && `ACT ${p.act}`, p.milliy && `MILLIY ${p.milliy}`].filter(Boolean);

  const isEmptyPassport = !p.bio && !hasEducation && !hasLists && tests.length === 0 && awards.length === 0;

  async function addFriend() {
    const { error } = await sendConnect(id);
    if (error) notify('Already requested', 'You have already sent a request.');
    else { notify('Request sent 🤝', 'They can accept you from their Portal → Networking.'); load(); }
  }

  async function respond(accept) {
    if (!status?.row) return;
    const { error } = await respondConnect(status.row, accept);
    if (error) return notify('Could not respond', error.message);
    notify(accept ? 'Friends 🤝' : 'Request declined', accept ? 'You can message each other now.' : '');
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
    } catch (e) { notify('Could not open chat', e.message); }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={styles.head}>
        <Avatar uri={p.avatar_url} name={p.full_name} id={p.id} size={76} style={{ marginBottom: 10 }} />
        <Text style={styles.name}>{p.full_name}</Text>
        <Text style={styles.role}>{p.role} · {p.city ?? 'Tashkent'}</Text>
        <View style={styles.badges}>
          {p.verified_student && <Text style={styles.badge}>✔ Verified student</Text>}
          <Text style={styles.badge}>⭐ {p.reliability ?? 75}% reliability</Text>
        </View>
      </View>

      {iBlocked && (
        <View style={styles.blockedBox}>
          <Text style={styles.blockedText}>🚫 You blocked {firstName}. They can't message you or send you requests, and their content is hidden from you.</Text>
          <Button
            title="Unblock"
            variant="ghost"
            style={{ marginTop: 10 }}
            onPress={async () => {
              const { error } = await unblockUser(id);
              if (error) return notify('Could not unblock', error.message);
              notify('Unblocked', `You'll see ${firstName}'s content again.`);
              load();
            }}
          />
        </View>
      )}

      {!isMe && !iBlocked && (
        status?.status === 'pending' && status.incoming ? (
          <View style={styles.requestBox}>
            <Text style={styles.requestText}>
              {firstName} wants to be your friend
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Button title="Accept" variant="green" style={{ flex: 1 }} onPress={() => respond(true)} />
              <Button title="Decline" variant="ghost" style={{ flex: 1 }} onPress={() => respond(false)} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
            {status?.status === 'accepted' ? (
              <Button title="💬 Message" style={{ flex: 1 }} onPress={chat} />
            ) : status?.status === 'pending' ? (
              <Button title="Request sent" variant="ghost" style={{ flex: 1 }} disabled />
            ) : (
              <Button title="🤝 Add friend" variant="green" style={{ flex: 1 }} onPress={addFriend} />
            )}
          </View>
        )
      )}

      {awardable.length > 0 && (
        <Section title="🏅 Give an award">
          <Text style={styles.body}>This person was accepted to your event{awardable.length === 1 ? '' : 's'}. Pick one to rank & award them:</Text>
          {awardable.map((po) => (
            <TouchableOpacity key={po.id} style={styles.contact} onPress={() => router.push(`/badge/${po.id}`)}>
              <Text style={{ fontSize: 16 }}>🎪</Text>
              <Text style={styles.contactText}>{po.title}</Text>
              <Text style={styles.contactGo}>Award →</Text>
            </TouchableOpacity>
          ))}
        </Section>
      )}

      {p.bio ? (
        <View style={styles.sticky}><Text style={styles.stickyText}>{p.bio}</Text></View>
      ) : null}

      {(c.telegram || c.phone || c.linkedin) ? (
        <Section title="📞 Contact">
          {c.telegram ? <ContactRow icon="✈️" label={`Telegram · @${String(c.telegram).replace(/^@/, '')}`} onPress={() => Linking.openURL(`https://t.me/${String(c.telegram).replace(/^@/, '')}`)} /> : null}
          {c.phone ? <ContactRow icon="📞" label={c.phone} onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}
          {c.linkedin ? <ContactRow icon="💼" label="LinkedIn profile" onPress={() => Linking.openURL(String(c.linkedin).startsWith('http') ? c.linkedin : `https://${c.linkedin}`)} /> : null}
          {isMe ? <Text style={styles.contactNote}>Only your friends and the organizers of events you apply to can see these.</Text> : null}
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
              {'  ·  '}{friendCount} friend{friendCount === 1 ? '' : 's'}
            </Text>
          </>
        ) : (
          <Text style={styles.socialText}>
            <Text style={{ fontWeight: '800', color: colors.ink }}>{friendCount}</Text> friend{friendCount === 1 ? '' : 's'}
            {!isMe ? '  ·  no mutual friends yet' : ''}
          </Text>
        )}
        <Text style={styles.socialGo}>›</Text>
      </TouchableOpacity>

      {recent.length > 0 && (
        <Section title="🎪 Recently attended">
          {recent.map((e) => (
            <TouchableOpacity key={e.id} style={styles.recentRow} onPress={() => router.push(`/post/${e.id}`)}>
              <Text style={styles.recentEmoji}>{typeMeta(e.category).emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.recentTitle} numberOfLines={1}>{e.title}</Text>
                <Text style={styles.recentMeta}>
                  {e.event_date ?? 'date not set'}{e.status === 'completed' ? ' · finished' : ''}
                </Text>
              </View>
              <Text style={styles.socialGo}>›</Text>
            </TouchableOpacity>
          ))}
        </Section>
      )}

      {isEmptyPassport && (
        <View style={styles.blank}>
          <Text style={styles.blankEmoji}>🪪</Text>
          <Text style={styles.blankTitle}>
            {isMe ? 'Your passport is empty' : 'Passport not filled in yet'}
          </Text>
          <Text style={styles.blankText}>
            {isMe
              ? 'Add your school, skills and contacts so organizers know who you are when you apply.'
              : `${firstName} hasn't added education or skills yet. You can still connect or message them.`}
          </Text>
          {isMe && (
            <Button title="🪪 Fill in my passport" style={{ marginTop: 14, alignSelf: 'stretch' }} onPress={() => router.push('/passport')} />
          )}
        </View>
      )}

      {hasEducation && (
        <Section title="Education">
          {row('University / School', p.university)}
          {row('Major', p.major)}
          {row('Academic year', p.academic_year)}
        </Section>
      )}

      {tests.length > 0 && (
        <Section title="Standardized tests">
          <Text style={styles.body}>{tests.join('  ·  ')}</Text>
        </Section>
      )}

      {(p.honors ?? []).length > 0 && (
        <Section title="Honors"><Chips items={p.honors} /></Section>
      )}
      {(p.skills ?? []).length > 0 && (
        <Section title="Skills"><Chips items={p.skills} /></Section>
      )}
      {(p.languages ?? []).length > 0 && (
        <Section title="Languages"><Chips items={p.languages} /></Section>
      )}

      {awards.length > 0 && (
        <Section title="🏅 Pinned achievements">
          {awards.map((a) => {
            const m = awardMeta(a);
            return (
              <View key={a.id} style={styles.award}>
                <Text style={{ fontSize: 26 }}>{m.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.awardName}>{m.label} · {a.badge?.emoji ?? ''} {a.badge?.name}</Text>
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
          <Text style={styles.reportText}>⚑ Report or block {firstName}</Text>
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

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function ContactRow({ icon, label, onPress }) {
  return (
    <TouchableOpacity style={styles.contact} onPress={onPress}>
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={styles.contactText}>{label}</Text>
      <Text style={styles.contactGo}>Open →</Text>
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
  head: { alignItems: 'center', paddingVertical: 12 },
  pfp: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  pfpText: { color: '#fff', fontSize: 28, fontWeight: '800' },
  name: { fontSize: 20, fontWeight: '800', color: colors.ink },
  role: { fontSize: 13, color: colors.muted, marginTop: 2, textTransform: 'capitalize' },
  badges: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  badge: { fontSize: 11.5, backgroundColor: colors.brandSoft, color: colors.brand, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, fontWeight: '700', overflow: 'hidden' },
  sticky: { backgroundColor: '#fdf6c8', borderRadius: 6, padding: 14, marginBottom: 12, transform: [{ rotate: '-1deg' }], borderWidth: 1, borderColor: '#f0e6a8' },
  stickyText: { fontSize: 14, color: '#4a4320', fontStyle: 'italic', lineHeight: 20 },
  socialRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12 },
  stack: { flexDirection: 'row', alignItems: 'center' },
  socialText: { flex: 1, fontSize: 13, color: colors.muted, lineHeight: 18 },
  socialGo: { fontSize: 22, color: colors.muted, fontWeight: '300' },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line },
  recentEmoji: { fontSize: 20 },
  recentTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  recentMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  requestBox: { backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.lg, padding: 14, marginBottom: 10 },
  requestText: { fontSize: 14, fontWeight: '800', color: colors.brand, textAlign: 'center' },
  blank: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', borderRadius: radius.lg, padding: 22, alignItems: 'center', marginBottom: 12 },
  blankEmoji: { fontSize: 30, opacity: 0.7 },
  blankTitle: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 8 },
  blankText: { fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  section: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, fontWeight: '700', marginBottom: 8 },
  body: { fontSize: 14, color: colors.ink, lineHeight: 22 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  k: { fontSize: 13, color: colors.muted },
  v: { fontSize: 13.5, color: colors.ink, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line },
  contactText: { flex: 1, fontSize: 14, color: colors.ink, fontWeight: '600' },
  contactGo: { fontSize: 12.5, color: colors.brand, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { fontSize: 12.5, backgroundColor: colors.bg, color: colors.ink, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, overflow: 'hidden' },
  award: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  awardName: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  awardEvent: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  awardNote: { fontSize: 13, color: colors.ink, fontStyle: 'italic', marginTop: 2 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 60 },
  contactNote: { fontSize: 11.5, color: colors.muted, marginTop: 8, lineHeight: 16 },
  blockedBox: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: '#fbd5d5', borderRadius: radius.lg, padding: 14, marginBottom: 10 },
  blockedText: { fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  reportLink: { alignItems: 'center', marginTop: 10, paddingVertical: 10 },
  reportText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
});

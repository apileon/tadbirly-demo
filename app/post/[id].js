import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Linking, Image } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, CATEGORIES, typeMeta, awardMeta } from '../../lib/theme';
import { Button, Tag } from '../../components/ui';
import { useReportSheet, fetchContactDetails } from '../../lib/moderation';
import { sendConnect } from '../../lib/social';
import { notify } from '../../lib/notify';
import { formatEventWhen } from '../../lib/events';

export default function PostDetail() {
  const { id } = useLocalSearchParams();
  const { session } = useAuth();
  const router = useRouter();
  const uid = session?.user?.id;
  const [post, setPost] = useState(null);
  const [application, setApplication] = useState(null);
  const [roster, setRoster] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  // Organizer's phone / Telegram / LinkedIn — only for people allowed to see
  // them (the organizer, and anyone who applied). See contact_details().
  const [contact, setContact] = useState(null);
  const safety = useReportSheet({ onBlocked: () => router.back() });

  // Four requests in parallel rather than four waits in a row.
  const load = useCallback(async () => {
    const [postRes, appRes, rosterRes, awRes] = await Promise.all([
      supabase
        .from('posts')
        .select('*, author:profiles!posts_author_id_fkey(id, full_name, reliability)')
        .eq('id', id)
        .single(),
      uid
        ? supabase.from('applications').select('*').eq('post_id', id).eq('applicant_id', uid).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.rpc('event_roster', { p: id }),
      supabase
        .from('awards')
        .select('id, kind, place, note, recipient:profiles!awards_recipient_id_fkey(id, full_name)')
        .eq('post_id', id),
    ]);
    setPost(postRes.data);
    setContact(postRes.data?.author?.id ? await fetchContactDetails(postRes.data.author.id) : null);
    setApplication(appRes.data);
    setRoster(rosterRes.data ?? []);
    setResults(awRes.data ?? []);
    setLoading(false);
  }, [id, uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function apply() {
    if (!post) return;
    if (post.author?.id === uid) return notify("That's your event", 'You cannot apply to your own event.');
    // Optimistic: the status flips immediately, then confirms with the server.
    setApplication({ post_id: post.id, applicant_id: uid, status: 'pending', optimistic: true });
    const { error } = await supabase.from('applications').insert({ post_id: post.id, applicant_id: uid });
    if (error) {
      setApplication(null);
      return notify('Could not apply', error.message);
    }
    notify('Applied ✅', "The organizer will review your application. Once you're accepted, the event chat opens for you.");
    load();
  }

  // Report the event (reason picker) and/or block its organizer.
  function openSafety() {
    if (!post) return;
    safety.open({
      type: 'event',
      id: post.id,
      postId: post.id,
      userId: post.author?.id,
      name: post.author?.full_name ?? 'this organizer',
    });
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <Text style={styles.empty}>Event not found.</Text>;

  const cat = CATEGORIES[post.kind] ?? CATEGORIES.event;
  const t = typeMeta(post.category);
  const isOwner = post.author?.id === uid;
  const isFinished = post.status === 'completed';
  const accepted = roster.filter((r) => r.status === 'accepted');
  const canChat = isOwner || application?.status === 'accepted';
  const a = post.author ?? {};
  const c = contact ?? {};
  const hasContact = !!(c.telegram || c.phone || c.linkedin);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {isFinished && (
        <View style={styles.finished}>
          <Text style={styles.finishedText}>🏁 EVENT FINISHED</Text>
          <Text style={styles.finishedSub}>This event has ended and no longer accepts applications.</Text>
        </View>
      )}

      {post.cover_url ? (
        <View style={styles.coverWrap}>
          {/* "contain" so the whole poster is readable, never cropped */}
          <Image source={{ uri: post.cover_url }} style={styles.coverImg} resizeMode="contain" />
          {isFinished && <View style={styles.coverDim} />}
        </View>
      ) : null}

      <View style={[styles.hero, { backgroundColor: isFinished ? '#6b6f68' : cat.color }, post.cover_url && styles.heroUnderCover]}>
        <Tag label={`${t.emoji} ${t.key}`} color="#fff" soft="rgba(255,255,255,0.22)" />
        <Text style={styles.heroTitle}>{post.title}</Text>
        <Text style={styles.heroMeta}>
          {post.location ?? post.city}{post.event_date ? ` · 📅 ${formatEventWhen(post.event_date, post.start_time)}` : ''}
          {typeof post.spots === 'number' ? ` · ${post.spots} spots` : ''}
        </Text>
        <Text style={styles.heroMode}>
          {post.team_mode === 'team'
            ? `🧩 Teams only · minimum ${post.team_min ?? 2} people`
            : '👤 Individual applications'}
        </Text>
      </View>

      {/* Who's in — avatar stack + counts + event chat */}
      <View style={styles.rosterRow}>
        <View style={styles.avatars}>
          {roster.slice(0, 4).map((r, i) => (
            <View key={r.id} style={[styles.av, { marginLeft: i ? -10 : 0, zIndex: 10 - i }]}>
              <Text style={styles.avText}>{initial(r.full_name)}</Text>
            </View>
          ))}
          {roster.length === 0 && <View style={[styles.av, { backgroundColor: colors.line }]}><Text style={styles.avText}>·</Text></View>}
        </View>
        <Text style={styles.rosterText}>
          {roster.length} applied · <Text style={{ color: colors.brand, fontWeight: '800' }}>{accepted.length} accepted</Text>
        </Text>
        {canChat && (
          <TouchableOpacity style={styles.chatBtn} onPress={() => router.push(`/event-chat/${post.id}`)}>
            <Text style={styles.chatBtnText}>💬 Event chat</Text>
          </TouchableOpacity>
        )}
      </View>
      {accepted.length > 0 && (
        <Text style={styles.going}>
          <Text style={{ fontWeight: '800', color: colors.ink }}>Going: </Text>
          {accepted.map((r) => r.full_name).join(', ')}
        </Text>
      )}

      {results.length > 0 && (() => {
        const winners = results.filter((a) => a.kind === 'winner').sort((a, b) => (a.place ?? 9) - (b.place ?? 9));
        const mentions = results.filter((a) => a.kind === 'mention');
        const others = results.length - winners.length - mentions.length;
        return (
          <View style={[styles.section, { backgroundColor: '#fff8e6', borderColor: '#f0dfa8' }]}>
            <Text style={styles.sectionTitle}>🏆 Results</Text>
            {winners.map((a) => (
              <TouchableOpacity key={a.id} onPress={() => a.recipient?.id && router.push(`/user/${a.recipient.id}`)}>
                <Text style={styles.resultRow}>{awardMeta(a).emoji} <Text style={{ fontWeight: '800' }}>{awardMeta(a).label}</Text> — {a.recipient?.full_name}{a.note ? ` · “${a.note}”` : ''}</Text>
              </TouchableOpacity>
            ))}
            {mentions.map((a) => (
              <TouchableOpacity key={a.id} onPress={() => a.recipient?.id && router.push(`/user/${a.recipient.id}`)}>
                <Text style={styles.resultRow}>🎖️ Honourable mention — {a.recipient?.full_name}{a.note ? ` · “${a.note}”` : ''}</Text>
              </TouchableOpacity>
            ))}
            {others > 0 && <Text style={styles.resultDim}>+ {others} more medal{others === 1 ? '' : 's'} & participation awards</Text>}
          </View>
        );
      })()}

      <Section title="About">
        <Text style={styles.body}>{post.description || 'No description provided.'}</Text>
      </Section>

      {post.looking_for ? (
        <Section title="Who they're looking for">
          <Text style={styles.body}>{post.looking_for}</Text>
        </Section>
      ) : null}

      <View style={styles.statRow}>
        <Stat label="Organizer" value={a.full_name ?? '—'} onPress={() => a.id && router.push(`/user/${a.id}`)} />
        <Stat label="Reliability ⭐" value={`${a.reliability ?? 75}%`} />
      </View>

      {hasContact && (
        <Section title="Contact the organizer">
          {c.telegram ? <ContactRow icon="✈️" label={`Telegram · @${String(c.telegram).replace(/^@/, '')}`} onPress={() => Linking.openURL(`https://t.me/${String(c.telegram).replace(/^@/, '')}`)} /> : null}
          {c.phone ? <ContactRow icon="📞" label={c.phone} onPress={() => Linking.openURL(`tel:${c.phone}`)} /> : null}
          {c.linkedin ? <ContactRow icon="💼" label="LinkedIn profile" onPress={() => Linking.openURL(String(c.linkedin).startsWith('http') ? c.linkedin : `https://${c.linkedin}`)} /> : null}
        </Section>
      )}
      {!hasContact && !isOwner && !application && !isFinished && (
        <Text style={styles.hint}>The organizer's contact details are shown once you apply.</Text>
      )}

      {isOwner ? (
        <View style={{ marginTop: 6 }}>
          <Button title="📋 Review applicants" onPress={() => router.push(`/applicants/${post.id}`)} />
          <Button title="✏️ Edit event" variant="ghost" style={{ marginTop: 10 }} onPress={() => router.push(`/event-edit/${post.id}`)} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Button title="👥 Accepted" variant="ghost" style={{ flex: 1 }} onPress={() => router.push(`/accepted/${post.id}`)} />
            <Button title="🏅 Medals" variant="ghost" style={{ flex: 1 }} onPress={() => router.push(`/badge/${post.id}`)} />
          </View>
          {!isFinished && (
            <Button title="🏁 End event & send feedback" variant="dark" style={{ marginTop: 10 }} onPress={() => router.push(`/end/${post.id}`)} />
          )}
          {!hasContact && (
            <Text style={styles.hint}>Tip: add your Telegram / phone in your Passport so applicants can reach you.</Text>
          )}
          {hasContact && (
            <Text style={styles.hint}>Your contact details are shown only to people who applied to your events.</Text>
          )}
        </View>
      ) : (
        <>
          {application ? (
            <View style={[styles.statusBox, { backgroundColor: statusColor(application.status).soft }]}>
              <Text style={[styles.statusText, { color: statusColor(application.status).color }]}>
                {statusLabel(application.status)}
              </Text>
            </View>
          ) : !isFinished ? (
            post.team_mode === 'team' ? (
              <Button title="🧩 Apply as a team" onPress={() => router.push(`/team-apply/${post.id}`)} style={{ marginTop: 6 }} />
            ) : (
              <Button title="Apply now" onPress={apply} style={{ marginTop: 6 }} />
            )
          ) : null}

          <Button
            title="🤝 Connect with organizer"
            variant="ghost"
            style={{ marginTop: 12 }}
            onPress={async () => {
              // sendConnect already words its errors ("You are already friends",
              // "They already sent you a request…", network errors) — show them
              // instead of calling every failure "Already sent".
              const { error } = await sendConnect(a.id);
              if (error) return notify('Could not send the request', error.message);
              notify('Invite sent 🤝', 'They can accept you from their Portal → Requests.');
            }}
          />

          <TouchableOpacity onPress={openSafety} style={{ marginTop: 18, alignItems: 'center', paddingVertical: 6 }}>
            <Text style={styles.reportLink}>⚑ Report event or block organizer</Text>
          </TouchableOpacity>
        </>
      )}
      {safety.sheet}
    </ScrollView>
  );
}

const initial = (name) => (name ?? '?').trim().split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?';

const statusLabel = (s) =>
  s === 'accepted' ? '🟢 Accepted — you\'re in! Open the event chat above.'
  : s === 'rejected' ? '🔴 Not selected this time'
  : '🟡 Applied — pending review';

const statusColor = (s) =>
  s === 'accepted' ? { color: colors.accent, soft: colors.accentSoft }
  : s === 'rejected' ? { color: colors.danger, soft: colors.dangerSoft }
  : { color: colors.warn, soft: colors.warnSoft };

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Stat({ label, value, onPress }) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap style={styles.stat} onPress={onPress}>
      <Text style={styles.statValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}{onPress ? ' →' : ''}</Text>
    </Wrap>
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

const styles = StyleSheet.create({
  finished: { backgroundColor: colors.danger, borderRadius: radius.md, padding: 14, marginBottom: 12, alignItems: 'center' },
  finishedText: { color: '#fff', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  finishedSub: { color: 'rgba(255,255,255,0.9)', fontSize: 12.5, marginTop: 4, textAlign: 'center' },
  coverWrap: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: 'hidden', backgroundColor: '#1a1f19' },
  coverImg: { width: '100%', height: 380 },
  coverDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  hero: { borderRadius: radius.lg, padding: 20, marginBottom: 12 },
  heroUnderCover: { borderTopLeftRadius: 0, borderTopRightRadius: 0, marginTop: -1 },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 10 },
  heroMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6 },
  heroMode: { color: '#fff', fontSize: 12.5, fontWeight: '700', marginTop: 8, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, overflow: 'hidden' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 12, marginBottom: 8 },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  av: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandSoft, borderWidth: 2, borderColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  avText: { fontSize: 11, fontWeight: '800', color: colors.brand },
  rosterText: { flex: 1, fontSize: 13, color: colors.muted, fontWeight: '600' },
  chatBtn: { backgroundColor: colors.ink, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 12 },
  chatBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  going: { fontSize: 12.5, color: colors.muted, marginBottom: 12, marginHorizontal: 4, lineHeight: 18 },
  section: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, marginBottom: 8, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 22, color: colors.ink },
  resultRow: { fontSize: 14, color: colors.ink, marginTop: 6, lineHeight: 20 },
  resultDim: { fontSize: 12.5, color: colors.muted, marginTop: 8 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, alignItems: 'center' },
  statValue: { fontSize: 15, fontWeight: '800', color: colors.ink },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line },
  contactText: { flex: 1, fontSize: 14, color: colors.ink, fontWeight: '600' },
  contactGo: { fontSize: 12.5, color: colors.brand, fontWeight: '700' },
  statusBox: { borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: 6 },
  statusText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  hint: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 12, lineHeight: 17 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 60 },
  reportLink: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});

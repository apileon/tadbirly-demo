import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { notify, confirmAsync } from '../../lib/notify';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, AWARD_KINDS, awardMeta } from '../../lib/theme';
import { Button, Card } from '../../components/ui';

// Organizer screen: create the event's medal, then rank & award participants.
export default function BadgeManager() {
  const { postId } = useLocalSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [post, setPost] = useState(null);
  const [badge, setBadge] = useState(null);
  const [accepted, setAccepted] = useState([]);
  const [awards, setAwards] = useState({});   // recipient_id -> award
  const [loading, setLoading] = useState(true);

  // new-badge form
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🏅');
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('posts').select('title, author_id').eq('id', postId).single();
    setPost(p);
    // Organizer-only screen: don't load (or offer to hand out) medals for
    // anyone else's event.
    if (!p || p.author_id !== uid) { setLoading(false); return; }
    const { data: b } = await supabase.from('badges').select('*').eq('post_id', postId).maybeSingle();
    setBadge(b);
    const { data: apps } = await supabase
      .from('applications')
      .select('applicant:profiles!applications_applicant_id_fkey(id, full_name, university)')
      .eq('post_id', postId)
      .eq('status', 'accepted');
    setAccepted((apps ?? []).map((a) => a.applicant).filter(Boolean));
    const { data: aw } = await supabase.from('awards').select('*').eq('post_id', postId);
    const map = {};
    (aw ?? []).forEach((a) => { map[a.recipient_id] = a; });
    setAwards(map);
    setLoading(false);
  }, [postId, uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function createBadge() {
    if (!name.trim()) return notify('Name the medal', 'e.g. "TashMUN 2026"');
    setCreating(true);
    const { error } = await supabase.from('badges').insert({
      post_id: postId, organizer_id: uid, name: name.trim(), emoji: emoji || '🏅', description: desc || null,
    });
    setCreating(false);
    if (error) return notify('Could not create', error.message);
    load();
  }

  async function give(person, choice, comment, points) {
    // parseInt, not Number: Number('') is 0, and the old code then sent
    // parseInt('') = NaN (null in JSON) — a raw database error. An empty or
    // unreadable field falls back to the award's usual points.
    const typed = parseInt(String(points ?? '').trim(), 10);
    const pts = Number.isNaN(typed) ? choice.points : typed;
    // Same range the database enforces; saying it here is friendlier.
    if (pts < 0 || pts > 100) return notify('Check the points', 'Ranking points must be between 0 and 100.');
    const { error } = await supabase.from('awards').insert({
      badge_id: badge.id, post_id: postId, recipient_id: person.id, awarded_by: uid,
      kind: choice.key, place: choice.place ?? null, note: comment?.trim() || null, points: pts,
    });
    if (error) notify('Could not award', error.message);
    else load();
  }

  async function revoke(award) {
    if (!(await confirmAsync('Remove this award?', 'You can give a different one afterwards.', 'Remove'))) return;
    const { error } = await supabase.from('awards').delete().eq('id', award.id);
    if (error) notify('Could not remove', error.message);
    else load();
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <Text style={styles.gate}>Event not found.</Text>;
  if (post.author_id !== uid) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <Text style={styles.gate}>Only the organizer of this event can open this page.</Text>
        <Button title="Open the event" variant="ghost" style={{ marginTop: 14 }} onPress={() => router.replace(`/post/${postId}`)} />
      </View>
    );
  }

  const nameOf = (id) => accepted.find((p) => p.id === id)?.full_name ?? 'Participant';
  const list = Object.values(awards);
  const winners = list.filter((a) => a.kind === 'winner').sort((a, b) => (a.place ?? 9) - (b.place ?? 9));
  const mentions = list.filter((a) => a.kind === 'mention');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 50 }}>
      <Text style={styles.event}>{post?.title}</Text>

      {!badge ? (
        <Card>
          <Text style={styles.h}>Step 1 · Create this event's medal</Text>
          <Text style={styles.sub}>A unique badge that only you can award. Every award for this event (winners, mentions, participation) carries it.</Text>
          <Text style={styles.label}>Medal name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="TashMUN 2026" placeholderTextColor={colors.muted} />
          <Text style={styles.label}>Emoji</Text>
          <TextInput style={styles.input} value={emoji} onChangeText={setEmoji} placeholder="🏅" placeholderTextColor={colors.muted} />
          <Text style={styles.label}>Description (optional)</Text>
          <TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} value={desc} onChangeText={setDesc} multiline placeholder="What this medal represents" placeholderTextColor={colors.muted} />
          <Button title="Create medal" onPress={createBadge} loading={creating} style={{ marginTop: 16 }} />
        </Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 34 }}>{badge.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.badgeName}>{badge.name}</Text>
                {badge.description ? <Text style={styles.sub}>{badge.description}</Text> : null}
              </View>
            </View>
          </Card>

          {/* Results board */}
          {(winners.length > 0 || mentions.length > 0) && (
            <Card style={{ backgroundColor: '#fff8e6', borderColor: '#f0dfa8' }}>
              <Text style={styles.h}>🏆 Results</Text>
              {winners.map((a) => (
                <Text key={a.id} style={styles.resultRow}>{awardMeta(a).emoji} <Text style={{ fontWeight: '800' }}>{awardMeta(a).label}</Text> — {nameOf(a.recipient_id)}</Text>
              ))}
              {mentions.map((a) => (
                <Text key={a.id} style={styles.resultRow}>🎖️ Honourable mention — {nameOf(a.recipient_id)}</Text>
              ))}
            </Card>
          )}

          <Text style={styles.h2}>Step 2 · Rank & award participants</Text>
          <Text style={styles.sub}>Pick a place, a medal, an honourable mention, or participation — and leave a comment. It appears on their verified profile and raises their reliability (winners +10, medal/mention +5, participation +3).</Text>
          {accepted.length === 0 ? (
            <Text style={styles.empty}>No accepted participants yet. Accept people in Review applicants first.</Text>
          ) : (
            accepted.map((p) => (
              <AwardRow key={p.id} person={p} existing={awards[p.id]} onGive={(c, note, pts) => give(p, c, note, pts)} onRevoke={revoke} />
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function AwardRow({ person, existing, onGive, onRevoke }) {
  const [choice, setChoice] = useState(null);
  const [note, setNote] = useState('');
  const [pts, setPts] = useState('');
  const [busy, setBusy] = useState(false);
  const m = awardMeta(existing);

  function pick(k) {
    setChoice(k);
    setPts(String(k.points)); // sensible default, organizer can change it
  }
  return (
    <Card>
      <Text style={styles.person}>{person.full_name}{person.university ? ` · ${person.university}` : ''}</Text>
      {existing ? (
        <>
          <Text style={styles.awarded}>
            {m.emoji} {m.label} · {existing.points ?? 0} pts{existing.note ? ` — “${existing.note}”` : ''}
          </Text>
          <TouchableOpacity onPress={() => onRevoke(existing)} style={{ marginTop: 8 }}>
            <Text style={styles.revoke}>Remove / change</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.kinds}>
            {AWARD_KINDS.map((k) => {
              const on = choice && choice.key === k.key && choice.place === k.place;
              return (
                <TouchableOpacity key={`${k.key}-${k.place ?? ''}`} onPress={() => pick(k)} style={[styles.kind, on && styles.kindOn]}>
                  <Text style={[styles.kindText, on && { color: '#fff' }]}>{k.emoji} {k.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            value={note}
            onChangeText={setNote}
            placeholder='Comment — e.g. "Best delegate, led the resolution on climate"'
            placeholderTextColor={colors.muted}
          />
          {choice && (
            <View style={styles.ptsRow}>
              <Text style={styles.ptsLabel}>Ranking points</Text>
              <TextInput
                style={styles.ptsInput}
                value={pts}
                onChangeText={setPts}
                keyboardType="number-pad"
                placeholder={String(choice.points)}
                placeholderTextColor={colors.muted}
              />
            </View>
          )}
          <Button
            title={choice ? `Give ${choice.emoji} ${choice.label}` : 'Choose an award above'}
            variant="green"
            disabled={!choice}
            style={{ marginTop: 10 }}
            loading={busy}
            onPress={async () => { setBusy(true); await onGive(choice, note, pts); setBusy(false); }}
          />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  event: { fontSize: 18, fontWeight: '800', color: colors.ink, marginBottom: 12 },
  h: { fontSize: 15, fontWeight: '800', color: colors.ink },
  h2: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 20 },
  sub: { fontSize: 12.5, color: colors.muted, marginTop: 4, lineHeight: 18 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
  badgeName: { fontSize: 16, fontWeight: '800', color: colors.ink },
  resultRow: { fontSize: 14, color: colors.ink, marginTop: 8, lineHeight: 20 },
  person: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  awarded: { fontSize: 13.5, color: colors.brand, marginTop: 8, fontWeight: '600', lineHeight: 19 },
  revoke: { fontSize: 12.5, color: colors.muted, fontWeight: '600', textDecorationLine: 'underline' },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  kind: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  kindOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  kindText: { fontSize: 12.5, color: colors.ink, fontWeight: '600' },
  ptsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  ptsLabel: { fontSize: 12.5, fontWeight: '700', color: colors.muted, flex: 1 },
  ptsInput: { width: 90, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 12, fontSize: 14, color: colors.ink, textAlign: 'center' },
  empty: { fontSize: 13.5, color: colors.muted, marginTop: 10, lineHeight: 20 },
  gate: { textAlign: 'center', color: colors.muted, marginTop: 60, paddingHorizontal: 20, lineHeight: 21 },
});

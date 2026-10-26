import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { notify, confirmAsync } from '../../lib/notify';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow, AWARD_KINDS, awardMeta, column } from '../../lib/theme';
import { Button, Avatar, EmptyState, SectionHeader, TextField } from '../../components/ui';
import { t } from '../../lib/i18n';

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
    if (!name.trim()) return notify(t('Name the medal'), t('For example "TashMUN 2026"'));
    setCreating(true);
    const { error } = await supabase.from('badges').insert({
      post_id: postId, organizer_id: uid, name: name.trim(), emoji: emoji || '🏅', description: desc || null,
    });
    setCreating(false);
    if (error) return notify(t('Could not create'), error.message);
    load();
  }

  async function give(person, choice, comment, points) {
    // parseInt, not Number: Number('') is 0, and the old code then sent
    // parseInt('') = NaN (null in JSON) — a raw database error. An empty or
    // unreadable field falls back to the award's usual points.
    const typed = parseInt(String(points ?? '').trim(), 10);
    const pts = Number.isNaN(typed) ? choice.points : typed;
    // Same range the database enforces; saying it here is friendlier.
    if (pts < 0 || pts > 100) return notify(t('Check the points'), t('Ranking points must be between 0 and 100.'));
    const { error } = await supabase.from('awards').insert({
      badge_id: badge.id, post_id: postId, recipient_id: person.id, awarded_by: uid,
      kind: choice.key, place: choice.place ?? null, note: comment?.trim() || null, points: pts,
    });
    if (error) notify(t('Could not award'), error.message);
    else load();
  }

  async function revoke(award) {
    if (!(await confirmAsync(t('Remove this award?'), t('You can give a different one afterwards.'), t('Remove')))) return;
    const { error } = await supabase.from('awards').delete().eq('id', award.id);
    if (error) notify(t('Could not remove'), error.message);
    else load();
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <EmptyState icon="alert-circle-outline" title={t('Event not found.')} />;
  if (post.author_id !== uid) {
    return (
      <EmptyState
        icon="lock-closed-outline"
        title={t('Only the organizer of this event can open this page.')}
        action={t('Open the event')}
        onAction={() => router.replace(`/post/${postId}`)}
      />
    );
  }

  const nameOf = (id) => accepted.find((p) => p.id === id)?.full_name ?? t('Participant');
  const list = Object.values(awards);
  const winners = list.filter((a) => a.kind === 'winner').sort((a, b) => (a.place ?? 9) - (b.place ?? 9));
  const mentions = list.filter((a) => a.kind === 'mention');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.event}>{post?.title}</Text>

      {!badge ? (
        <View style={styles.card}>
          <View style={styles.stepRow}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
            <Text style={[type.title, { flex: 1 }]}>{t("Create this event's medal")}</Text>
          </View>
          <Text style={styles.sub}>{t('A unique badge that only you can award. Every award for this event (winners, mentions, participation) carries it.')}</Text>
          <TextField label={t('Medal name')} value={name} onChangeText={setName} placeholder="TashMUN 2026" />
          <TextField label={t('Emoji')} value={emoji} onChangeText={setEmoji} placeholder="🏅" />
          <TextField
            label={t('Description (optional)')}
            value={desc}
            onChangeText={setDesc}
            multiline
            inputStyle={{ minHeight: 70, textAlignVertical: 'top' }}
            placeholder={t('What this medal represents')}
          />
          <Button title={t('Create medal')} icon="medal-outline" onPress={createBadge} loading={creating} style={{ marginTop: 18 }} />
        </View>
      ) : (
        <>
          <View style={[styles.card, styles.badgeCard]}>
            <View style={styles.badgeEmojiBox}>
              <Text style={{ fontSize: 30 }}>{badge.emoji}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.title}>{badge.name}</Text>
              {badge.description ? <Text style={styles.sub}>{badge.description}</Text> : null}
            </View>
          </View>

          {/* Results board */}
          {(winners.length > 0 || mentions.length > 0) && (
            <View style={[styles.card, styles.results]}>
              <View style={styles.resultsHead}>
                <Ionicons name="trophy-outline" size={18} color={colors.warn} />
                <Text style={type.title}>{t('Results')}</Text>
              </View>
              {winners.map((a) => (
                <View key={a.id} style={styles.resultRow}>
                  <Text style={styles.resultEmoji}>{awardMeta(a).emoji}</Text>
                  <Text style={styles.resultText}>
                    <Text style={{ fontWeight: '800' }}>{t(awardMeta(a).label)}</Text>: {nameOf(a.recipient_id)}
                  </Text>
                </View>
              ))}
              {mentions.map((a) => (
                <View key={a.id} style={styles.resultRow}>
                  <Text style={styles.resultEmoji}>{awardMeta(a).emoji}</Text>
                  <Text style={styles.resultText}>
                    <Text style={{ fontWeight: '800' }}>{t('Honourable mention')}</Text>: {nameOf(a.recipient_id)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={[styles.stepRow, { marginTop: 20 }]}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
            <Text style={[type.title, { flex: 1 }]}>{t('Rank and award participants')}</Text>
          </View>
          <Text style={[styles.sub, { marginBottom: 12 }]}>
            {t('Pick a place, a medal, an honourable mention or participation, and leave a comment. It appears on their verified profile and raises their reliability (winners +10, medal or mention +5, participation +3).')}
          </Text>
          {accepted.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title={t('No accepted participants yet')}
              text={t('Accept people in Review applicants first.')}
            />
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
    <View style={styles.card}>
      <View style={styles.personRow}>
        <Avatar name={person.full_name} id={person.id} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={styles.person} numberOfLines={1}>{person.full_name}</Text>
          {person.university ? <Text style={styles.uni} numberOfLines={1}>{person.university}</Text> : null}
        </View>
      </View>
      {existing ? (
        <>
          <View style={styles.awarded}>
            <Text style={{ fontSize: 18 }}>{m.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.awardedText}>
                {t(m.label)} · {t('{n} pts', { n: existing.points ?? 0 })}
              </Text>
              {existing.note ? <Text style={styles.awardedNote}>“{existing.note}”</Text> : null}
            </View>
          </View>
          <TouchableOpacity onPress={() => onRevoke(existing)} style={styles.revokeBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="swap-horizontal-outline" size={15} color={colors.muted} />
            <Text style={styles.revoke}>{t('Remove or change')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.kinds}>
            {AWARD_KINDS.map((k) => {
              const on = choice && choice.key === k.key && choice.place === k.place;
              return (
                <TouchableOpacity
                  key={`${k.key}-${k.place ?? ''}`}
                  onPress={() => pick(k)}
                  style={[styles.kind, on && styles.kindOn]}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !!on }}
                >
                  <Text style={[styles.kindText, on && { color: colors.onBrand }]}>{k.emoji} {t(k.label)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextField
            value={note}
            onChangeText={setNote}
            placeholder={t('Comment, e.g. "Best delegate, led the resolution on climate"')}
            style={{ marginTop: 12 }}
          />
          {choice && (
            <View style={styles.ptsRow}>
              <Text style={styles.ptsLabel}>{t('Ranking points')}</Text>
              <TextInput
                style={styles.ptsInput}
                value={pts}
                onChangeText={setPts}
                keyboardType="number-pad"
                placeholder={String(choice.points)}
                placeholderTextColor={colors.faint}
              />
            </View>
          )}
          <Button
            title={choice ? t('Give {award}', { award: `${choice.emoji} ${t(choice.label)}` }) : t('Choose an award above')}
            variant="primary"
            disabled={!choice}
            style={{ marginTop: 12 }}
            loading={busy}
            onPress={async () => { setBusy(true); await onGive(choice, note, pts); setBusy(false); }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 50, ...column },
  event: { ...type.h1, marginBottom: 14 },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    padding: 16, marginBottom: 12, ...shadow.sm,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: colors.onBrand, fontWeight: '800', fontSize: 13 },
  sub: { ...type.small, marginTop: 6 },
  badgeCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  badgeEmojiBox: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  results: { backgroundColor: colors.warnSoft, borderColor: colors.warnSoft },
  resultsHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  resultEmoji: { fontSize: 18, width: 24, textAlign: 'center' },
  resultText: { ...type.body, fontSize: 14, color: colors.ink, flex: 1 },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  person: { ...type.title, fontSize: 15 },
  uni: { ...type.small, fontSize: 12.5 },
  awarded: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12,
    backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: 12,
  },
  awardedText: { fontSize: 14, color: colors.brand, fontWeight: '700' },
  awardedNote: { ...type.small, color: colors.body, marginTop: 2 },
  revokeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, alignSelf: 'flex-start' },
  revoke: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  kind: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  kindOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  kindText: { fontSize: 13, color: colors.body, fontWeight: '600' },
  ptsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  ptsLabel: { ...type.label, color: colors.muted, flex: 1 },
  ptsInput: {
    width: 90, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md,
    paddingVertical: 10, paddingHorizontal: 12, fontSize: 15, color: colors.ink, textAlign: 'center', outlineStyle: 'none',
  },
});

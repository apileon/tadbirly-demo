import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, EVENT_TYPES, EVENT_TYPE_KEYS, kindFor } from '../../lib/theme';
import { Button } from '../../components/ui';
import { notify, confirmAsync } from '../../lib/notify';
import { pickAndUpload, canPickImage } from '../../lib/news';
import {
  requireRows, endEvent, eventFormProblem, spotsValue, startTimeValue, formatStartTime, TITLE_MAX, DESCRIPTION_MAX,
} from '../../lib/events';

export default function EditEvent() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const [form, setForm] = useState(null);
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const [denied, setDenied] = useState(false);
  // { students } when deleting would take medals away — shows the choice panel.
  const [awardWarning, setAwardWarning] = useState(null);
  const [busy, setBusy] = useState(null); // 'check' | 'finish' | 'delete'
  // Which event the form was filled from. A ref rather than `form`: load()
  // is memoised, so it only ever saw the first (null) form and refilled it on
  // every re-focus — wiping whatever the organizer had typed.
  const loadedFor = useRef(null);
  // The date the event had when the form was filled. An event that already
  // happened may keep its past date; only *moving* it into the past is refused.
  const originalDate = useRef('');
  // The start time it had ('' = none). Saving only sends start_time when
  // there is one now or there was one before (to clear it), so editing keeps
  // working on a database without the column (25_reminders.sql not run).
  const originalTime = useRef('');

  const load = useCallback(async () => {
    if (loadedFor.current === id) return;
    const { data } = await supabase.from('posts').select('*').eq('id', id).single();
    if (!data) return setDenied(true);
    if (data.author_id !== session?.user?.id) return setDenied(true);
    loadedFor.current = id;
    originalDate.current = data.event_date ?? '';
    originalTime.current = formatStartTime(data.start_time);
    const known = EVENT_TYPE_KEYS.includes(data.category);
    setDenied(false);
    setForm({
      title: data.title ?? '',
      type: known ? data.category : 'Other',
      location: data.location ?? '',
      date: data.event_date ?? '',
      time: originalTime.current,             // "15:00:00" from the database -> "15:00"
      spots: data.spots != null ? String(data.spots) : '',
      looking_for: data.looking_for ?? '',
      description: data.description ?? '',
      team_mode: data.team_mode ?? 'solo',
      team_min: data.team_min != null ? String(data.team_min) : '2',
      cover_url: data.cover_url ?? null,
      status: data.status,
    });
    if (!known && data.category) setCustom(data.category);
  }, [id, session?.user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save() {
    // Same checks as "Post an event" (title/details length, real and not-past
    // date, start time, spots), shared via lib/events.
    const problem = eventFormProblem(form, { originalDate: originalDate.current });
    if (problem) return notify(...problem);
    const minSize = form.team_mode === 'team' ? parseInt(form.team_min, 10) : null;
    if (form.team_mode === 'team' && (!minSize || minSize < 2)) {
      return notify('Team size', 'A team event needs a minimum of at least 2 people.');
    }
    const category = form.type === 'Other' ? (custom.trim() || 'Other') : form.type;
    const startTime = startTimeValue(form.time);

    setSaving(true);
    const { error } = await requireRows(supabase.from('posts').update({
      title: form.title.trim(),
      kind: kindFor(form.type),
      category,
      location: form.location || null,
      event_date: form.date.trim() || null,
      ...(startTime || originalTime.current ? { start_time: startTime } : {}),
      spots: spotsValue(form.spots),
      looking_for: form.looking_for || null,
      description: form.description || null,
      team_mode: form.team_mode,
      team_min: minSize,
      cover_url: form.cover_url,
    }).eq('id', id));
    setSaving(false);
    if (error) return notify('Could not save', error.message);
    notify('Event updated ✅', 'Your changes are live.');
    router.back();
  }

  // Awards belong to the event and are deleted with it, so every participant
  // would silently lose that medal and its ranking points. Look first.
  async function remove() {
    setBusy('check');
    const { data: aw, error } = await supabase.from('awards').select('recipient_id').eq('post_id', id);
    setBusy(null);
    if (error) return notify('Could not check the medals', `${error.message}\n\nNothing was deleted.`);
    const students = new Set((aw ?? []).map((a) => a.recipient_id)).size;
    if (students > 0) return setAwardWarning({ students });

    const ok = await confirmAsync(
      'Delete this event?',
      'It disappears for everyone, along with its applications and chat. This cannot be undone.',
      'Delete',
    );
    if (ok) await reallyDelete();
  }

  async function deleteAnyway() {
    const n = awardWarning?.students ?? 0;
    const ok = await confirmAsync(
      'Delete anyway?',
      `${n} student${n === 1 ? '' : 's'} will permanently lose their medals and points from this event. This cannot be undone.`,
      'Delete',
    );
    if (ok) await reallyDelete();
  }

  async function reallyDelete() {
    setBusy('delete');
    const { error } = await requireRows(supabase.from('posts').delete().eq('id', id));
    setBusy(null);
    if (error) return notify('Could not delete', error.message);
    notify('Event deleted', '');
    // dismissTo pops back to the tabs already underneath (router.replace
    // stacked a second tab navigator on top) and drops this event's pages
    // from history, so Back can't land on "Event not found".
    router.dismissTo('/my-events');
  }

  // The recommended alternative: close the event, keep everyone's results.
  async function finishInstead() {
    setBusy('finish');
    try {
      await endEvent(id, '');
    } catch (e) {
      setBusy(null);
      return notify('Could not update', e.message);
    }
    setBusy(null);
    setAwardWarning(null);
    notify('Marked as finished 🏁', 'Everyone keeps their medals and points. The event has left the feed and no longer takes applications.');
    if (router.canGoBack()) router.back();
    else router.replace(`/post/${id}`);
  }

  if (denied) return <Text style={styles.empty}>You can only edit events you created.</Text>;
  if (!form) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;

  // Functional update: a cover upload finishing later must not put back
  // the form as it was when the upload started (losing typing since then).
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 18, paddingBottom: 50 }}>
      <Text style={styles.h1}>Edit event</Text>

      <Text style={styles.label}>Cover photo</Text>
      {form.cover_url ? (
        <View>
          <Image source={{ uri: form.cover_url }} style={styles.cover} resizeMode="contain" />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 10 }}>
            {canPickImage && (
              <TouchableOpacity onPress={async () => {
                try { const url = await pickAndUpload('covers'); if (url) set('cover_url', url); }
                catch (e) { notify('Could not upload', e.message); }
              }}>
                <Text style={styles.coverAction}>Change</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => set('cover_url', null)}>
              <Text style={[styles.coverAction, { color: colors.danger }]}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : canPickImage ? (
        <TouchableOpacity style={styles.coverPick} onPress={async () => {
          try { const url = await pickAndUpload('covers'); if (url) set('cover_url', url); }
          catch (e) { notify('Could not upload', e.message); }
        }}>
          <Text style={{ fontSize: 26 }}>🖼️</Text>
          <Text style={styles.coverPickText}>Add a cover photo</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={form.title} onChangeText={(t) => set('title', t)} maxLength={TITLE_MAX} placeholderTextColor={colors.muted} />

      <Text style={styles.label}>Category</Text>
      <View style={styles.chips}>
        {EVENT_TYPES.map((t) => {
          const on = form.type === t.key;
          return (
            <TouchableOpacity key={t.key} onPress={() => set('type', t.key)} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && { color: '#fff' }]}>{t.emoji} {t.key}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {form.type === 'Other' && (
        <TextInput style={[styles.input, { marginTop: 8 }]} value={custom} onChangeText={setCustom}
          placeholder="Your own theme" placeholderTextColor={colors.muted} />
      )}

      <Text style={styles.label}>Who can apply?</Text>
      <View style={styles.modeRow}>
        <TouchableOpacity onPress={() => set('team_mode', 'solo')} style={[styles.mode, form.team_mode === 'solo' && styles.modeOn]}>
          <Text style={[styles.modeTitle, form.team_mode === 'solo' && { color: '#fff' }]}>👤 Individuals</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => set('team_mode', 'team')} style={[styles.mode, form.team_mode === 'team' && styles.modeOn]}>
          <Text style={[styles.modeTitle, form.team_mode === 'team' && { color: '#fff' }]}>🧩 Teams</Text>
        </TouchableOpacity>
      </View>
      {form.team_mode === 'team' && (
        <>
          <Text style={styles.label}>Minimum team size</Text>
          <TextInput style={styles.input} value={form.team_min} onChangeText={(t) => set('team_min', t)} keyboardType="number-pad" />
        </>
      )}

      <Text style={styles.label}>Location</Text>
      <TextInput style={styles.input} value={form.location} onChangeText={(t) => set('location', t)} placeholderTextColor={colors.muted} />

      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={form.date} onChangeText={(t) => set('date', t)} placeholder="2026-10-05" placeholderTextColor={colors.muted} />
        </View>
        <View style={{ flex: 1 }}>
          {/* Number pad: "18.30" / "18,30" are accepted, see parseStartTime */}
          <Text style={styles.label}>Start time (HH:MM)</Text>
          <TextInput style={styles.input} value={form.time} onChangeText={(t) => set('time', t)} maxLength={5}
            keyboardType="decimal-pad" placeholder="18:30" placeholderTextColor={colors.muted} />
        </View>
      </View>
      <Text style={styles.hint}>
        Time is optional. Accepted students get a reminder the evening before — and 2 hours before the start, if you add a time.
      </Text>

      <Text style={styles.label}>Who are you looking for?</Text>
      <TextInput style={styles.input} value={form.looking_for} onChangeText={(t) => set('looking_for', t)} placeholderTextColor={colors.muted} />

      <Text style={styles.label}>Spots available</Text>
      <TextInput style={styles.input} value={form.spots} onChangeText={(t) => set('spots', t)} keyboardType="number-pad" placeholderTextColor={colors.muted} />

      <Text style={styles.label}>Details</Text>
      <TextInput style={[styles.input, { height: 110, textAlignVertical: 'top' }]} value={form.description}
        onChangeText={(t) => set('description', t)} multiline maxLength={DESCRIPTION_MAX} placeholderTextColor={colors.muted} />

      <Button title="Save changes" onPress={save} loading={saving} style={{ marginTop: 20 }} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: 10 }} />

      {awardWarning ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnTitle}>⚠️ This event has results</Text>
          <Text style={styles.warnText}>
            {awardWarning.students} student{awardWarning.students === 1 ? '' : 's'} will lose their medals and points from this event if you delete it.
          </Text>
          {form.status === 'completed' ? (
            <>
              <Text style={styles.warnText}>
                It's already marked finished — out of the feed and closed to applications — so there's no need to delete it.
              </Text>
              <Button title="Keep the event" variant="green" style={{ marginTop: 12 }} disabled={!!busy} onPress={() => setAwardWarning(null)} />
            </>
          ) : (
            <>
              <Button title="🏁 Mark as finished instead" variant="green" style={{ marginTop: 12 }}
                loading={busy === 'finish'} disabled={busy === 'delete'} onPress={finishInstead} />
              <Text style={styles.warnHint}>
                Recommended: everyone keeps their medals and points, and the event leaves the feed and stops taking applications.
              </Text>
            </>
          )}
          <Button title="Delete anyway" variant="danger" style={{ marginTop: 12 }}
            loading={busy === 'delete'} disabled={busy === 'finish'} onPress={deleteAnyway} />
          {form.status !== 'completed' && (
            <Button title="Cancel" variant="ghost" style={{ marginTop: 10 }} disabled={!!busy} onPress={() => setAwardWarning(null)} />
          )}
        </View>
      ) : (
        <>
          <Button title="🗑️ Delete event" variant="danger" onPress={remove}
            loading={busy === 'check' || busy === 'delete'} style={{ marginTop: 26 }} />
          <Text style={styles.note}>Deleting removes the event and everything attached to it. To simply close applications, use “End event” instead.</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
  pair: { flexDirection: 'row', gap: 10 },
  hint: { fontSize: 11.5, color: colors.muted, marginTop: 6, lineHeight: 16 },
  cover: { width: '100%', height: 300, borderRadius: radius.md, backgroundColor: '#1a1f19' },
  coverAction: { color: colors.brand, fontWeight: '800', fontSize: 13.5 },
  coverPick: { backgroundColor: colors.card, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.md, paddingVertical: 22, alignItems: 'center' },
  coverPickText: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 12.5, color: colors.ink, fontWeight: '600' },
  modeRow: { flexDirection: 'row', gap: 10 },
  mode: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, alignItems: 'center' },
  modeOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  modeTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  note: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 60, paddingHorizontal: 20 },
  warnBox: { marginTop: 26, backgroundColor: colors.warnSoft, borderWidth: 1, borderColor: colors.warn, borderRadius: radius.md, padding: 16 },
  warnTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  warnText: { fontSize: 13.5, color: colors.ink, marginTop: 6, lineHeight: 20 },
  warnHint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
});

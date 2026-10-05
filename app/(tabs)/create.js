import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { notify } from '../../lib/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, EVENT_TYPES, kindFor } from '../../lib/theme';
import { Button } from '../../components/ui';
import { pickAndUpload, canPickImage } from '../../lib/news';
import { eventFormProblem, spotsValue, startTimeValue, TITLE_MAX, DESCRIPTION_MAX } from '../../lib/events';

export default function Create() {
  const router = useRouter();
  const { session } = useAuth();
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');      // one of EVENT_TYPES keys
  const [custom, setCustom] = useState('');  // custom theme when type === 'Other'
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');      // optional start time, "HH:MM"
  const [spots, setSpots] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [description, setDescription] = useState('');
  const [teamMode, setTeamMode] = useState('solo'); // solo | team
  const [teamMin, setTeamMin] = useState('2');
  const [cover, setCover] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function chooseCover() {
    setUploading(true);
    try { const url = await pickAndUpload('covers'); if (url) setCover(url); }
    catch (e) { notify('Could not upload', e.message); }
    setUploading(false);
  }

  async function publish() {
    // Title / date / time / spots / length checks are shared with Edit event,
    // so both screens accept exactly the same things (incl. no 2026-02-31).
    const problem = eventFormProblem({ title, date, time, spots, description });
    if (problem) return notify(...problem);
    if (!type) return notify('Pick a category', 'Choose what kind of event this is.');
    const category = type === 'Other' ? (custom.trim() || 'Other') : type;
    const minSize = teamMode === 'team' ? parseInt(teamMin, 10) : null;
    if (teamMode === 'team' && (!minSize || minSize < 2)) {
      return notify('Team size', 'A team event needs a minimum of at least 2 people.');
    }

    const startTime = startTimeValue(time);

    setSaving(true);
    const { data, error } = await supabase
      .from('posts')
      .insert({
        author_id: session.user.id,
        kind: kindFor(type),
        title: title.trim(),
        category,
        location: location || null,
        event_date: date.trim() || null,
        // Left out when empty, so posting keeps working on a database that
        // doesn't have the column yet (25_reminders.sql not run).
        ...(startTime ? { start_time: startTime } : {}),
        spots: spotsValue(spots),
        looking_for: lookingFor || null,
        description: description || null,
        team_mode: teamMode,
        team_min: minSize,
        cover_url: cover,
      })
      .select()
      .single();

    if (error) {
      setSaving(false);
      return notify('Could not publish', error.message);
    }
    setSaving(false);
    resetForm();
    notify('Published ✅', 'Your event is live in the feed.');
    router.push(`/post/${data.id}`);
  }

  function resetForm() {
    setTitle(''); setType(''); setCustom(''); setLocation(''); setDate(''); setTime(''); setSpots('');
    setLookingFor(''); setDescription(''); setTeamMode('solo'); setTeamMin('2'); setCover(null);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 60 }}>
        <Text style={styles.h1}>Post an event</Text>
        <Text style={styles.sub}>Publish an opportunity for students to apply to.</Text>

        <Text style={styles.label}>Cover photo</Text>
        {cover ? (
          <View>
            <Image source={{ uri: cover }} style={styles.cover} resizeMode="contain" />
            <TouchableOpacity onPress={() => setCover(null)}>
              <Text style={styles.removeCover}>Remove cover</Text>
            </TouchableOpacity>
          </View>
        ) : canPickImage ? (
          <TouchableOpacity style={styles.coverPick} onPress={chooseCover} disabled={uploading}>
            <Text style={styles.coverPickEmoji}>{uploading ? '⏳' : '🖼️'}</Text>
            <Text style={styles.coverPickText}>{uploading ? 'Uploading…' : 'Add a cover photo'}</Text>
            <Text style={styles.coverPickHint}>Events with a photo get far more applications</Text>
          </TouchableOpacity>
        ) : null}

        <Field label="Title">
          <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={TITLE_MAX}
            placeholder="e.g. TashMUN 2026 — Delegates wanted" placeholderTextColor={colors.muted} />
        </Field>

        <Text style={styles.label}>Category</Text>
        <View style={styles.chips}>
          {EVENT_TYPES.map((t) => {
            const on = type === t.key;
            return (
              <TouchableOpacity key={t.key} onPress={() => setType(t.key)} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && { color: '#fff' }]}>{t.emoji} {t.key}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {type === 'Other' && (
          <TextInput style={[styles.input, { marginTop: 8 }]} value={custom} onChangeText={setCustom}
            placeholder="Write your own theme, e.g. Startup pitch night" placeholderTextColor={colors.muted} />
        )}

        <Text style={styles.label}>Who can apply?</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity onPress={() => setTeamMode('solo')} style={[styles.mode, teamMode === 'solo' && styles.modeOn]}>
            <Text style={[styles.modeTitle, teamMode === 'solo' && { color: '#fff' }]}>👤 Individuals</Text>
            <Text style={[styles.modeSub, teamMode === 'solo' && { color: 'rgba(255,255,255,0.85)' }]}>Students apply one by one</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setTeamMode('team')} style={[styles.mode, teamMode === 'team' && styles.modeOn]}>
            <Text style={[styles.modeTitle, teamMode === 'team' && { color: '#fff' }]}>🧩 Teams</Text>
            <Text style={[styles.modeSub, teamMode === 'team' && { color: 'rgba(255,255,255,0.85)' }]}>A whole team applies together</Text>
          </TouchableOpacity>
        </View>
        {teamMode === 'team' && (
          <Field label="Minimum team size">
            <TextInput style={styles.input} value={teamMin} onChangeText={setTeamMin}
              keyboardType="number-pad" placeholder="2" placeholderTextColor={colors.muted} />
          </Field>
        )}

        <Field label="Location">
          <TextInput style={styles.input} value={location} onChangeText={setLocation}
            placeholder="e.g. WIUT, Tashkent" placeholderTextColor={colors.muted} />
        </Field>
        <View style={styles.pair}>
          <View style={{ flex: 1 }}>
            <Field label="Date (YYYY-MM-DD)">
              <TextInput style={styles.input} value={date} onChangeText={setDate}
                placeholder="2026-09-20" placeholderTextColor={colors.muted} />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            {/* Number pad: "18.30" / "18,30" are accepted, see parseStartTime */}
            <Field label="Start time (HH:MM)">
              <TextInput style={styles.input} value={time} onChangeText={setTime} maxLength={5}
                keyboardType="decimal-pad" placeholder="18:30" placeholderTextColor={colors.muted} />
            </Field>
          </View>
        </View>
        <Text style={styles.hint}>
          Time is optional. Accepted students get a reminder the evening before — and 2 hours before the start, if you add a time.
        </Text>
        <Field label="Who are you looking for?">
          <TextInput style={styles.input} value={lookingFor} onChangeText={setLookingFor}
            placeholder="e.g. Delegates, designers, backend devs" placeholderTextColor={colors.muted} />
        </Field>
        <Field label="Spots available">
          <TextInput style={styles.input} value={spots} onChangeText={setSpots}
            keyboardType="number-pad" placeholder="e.g. 20" placeholderTextColor={colors.muted} />
        </Field>
        <Field label="Details">
          <TextInput style={[styles.input, styles.textarea]} value={description} onChangeText={setDescription}
            multiline maxLength={DESCRIPTION_MAX} placeholder="Describe it clearly — format, requirements, what participants get…" placeholderTextColor={colors.muted} />
        </Field>

        <Button title="Publish event" variant="primary" onPress={publish} loading={saving} style={{ marginTop: 18 }} />
        <Text style={styles.note}>Add your Telegram / phone in your Passport so applicants can reach you.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, children }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13.5, color: colors.muted, marginTop: 4, lineHeight: 20 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
  textarea: { height: 96, textAlignVertical: 'top' },
  pair: { flexDirection: 'row', gap: 10 },
  hint: { fontSize: 11.5, color: colors.muted, marginTop: 6, lineHeight: 16 },
  cover: { width: '100%', height: 300, borderRadius: radius.md, backgroundColor: '#1a1f19' },
  removeCover: { color: colors.danger, fontWeight: '700', fontSize: 13, textAlign: 'center', marginTop: 10 },
  coverPick: { backgroundColor: colors.card, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.md, paddingVertical: 26, alignItems: 'center' },
  coverPickEmoji: { fontSize: 30 },
  coverPickText: { fontSize: 14.5, fontWeight: '800', color: colors.ink, marginTop: 8 },
  coverPickHint: { fontSize: 11.5, color: colors.muted, marginTop: 4 },
  modeRow: { flexDirection: 'row', gap: 10 },
  mode: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12 },
  modeOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  modeTitle: { fontSize: 14, fontWeight: '800', color: colors.ink },
  modeSub: { fontSize: 11.5, color: colors.muted, marginTop: 3, lineHeight: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 12.5, color: colors.ink, fontWeight: '600' },
  note: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 12, lineHeight: 17 },
});

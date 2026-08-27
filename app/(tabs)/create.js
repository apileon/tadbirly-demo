import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, CATEGORIES } from '../../lib/theme';
import { Button } from '../../components/ui';

const FREE_LIMIT = 3;

export default function Create() {
  const router = useRouter();
  const { session, profile, refreshProfile } = useAuth();
  const [mode, setMode] = useState('event'); // event | request
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [spots, setSpots] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const isRequest = mode === 'request';
  // Events count toward the free monthly cap; requests are always free & unlimited.
  const overLimit = !isRequest && !profile?.is_pro && (profile?.posts_this_month ?? 0) >= FREE_LIMIT;

  async function publish() {
    if (!title.trim()) return Alert.alert('Add a title');
    if (overLimit) return router.push('/pro');
    setSaving(true);
    const { data, error } = await supabase
      .from('posts')
      .insert({
        author_id: session.user.id,
        kind: isRequest ? 'request' : (category?.toLowerCase().includes('intern') ? 'internship' : category?.toLowerCase().includes('mun') ? 'mun' : 'event'),
        title: title.trim(),
        category: category || null,
        location: location || null,
        event_date: date || null,
        spots: spots ? parseInt(spots, 10) : null,
        looking_for: lookingFor || null,
        description: description || null,
      })
      .select()
      .single();

    if (error) {
      setSaving(false);
      return Alert.alert('Could not publish', error.message);
    }
    // increment monthly counter only for events (not free requests)
    if (!isRequest) {
      await supabase
        .from('profiles')
        .update({ posts_this_month: (profile?.posts_this_month ?? 0) + 1 })
        .eq('id', session.user.id);
      await refreshProfile();
    }
    setSaving(false);
    resetForm();
    Alert.alert('Published ✅', 'Your post is live in the feed.');
    router.push(`/post/${data.id}`);
  }

  function resetForm() {
    setTitle(''); setCategory(''); setLocation(''); setDate(''); setSpots(''); setLookingFor(''); setDescription('');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: 60 }}>
        <Text style={styles.h1}>Create a post</Text>
        <Text style={styles.sub}>
          Post an event as an organizer, or a request as a participant.
        </Text>

        {!profile?.is_pro && (
          <View style={styles.planPill}>
            <Text style={styles.planText}>
              Free plan · {Math.max(0, FREE_LIMIT - (profile?.posts_this_month ?? 0))} event posts left this month
            </Text>
            <TouchableOpacity onPress={() => router.push('/pro')}>
              <Text style={styles.goPro}>Go Pro ⚡</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.seg}>
          <SegBtn label="🎪 I'm organizing" on={!isRequest} onPress={() => setMode('event')} />
          <SegBtn label="🙋 I'm requesting" on={isRequest} onPress={() => setMode('request')} />
        </View>

        <Field label="Title">
          <TextInput style={styles.input} value={title} onChangeText={setTitle}
            placeholder={isRequest ? 'e.g. Looking for a UX mentor' : 'e.g. Inha Hackathon 2026'}
            placeholderTextColor={colors.muted} />
        </Field>

        {!isRequest && (
          <Field label="Category">
            <TextInput style={styles.input} value={category} onChangeText={setCategory}
              placeholder="Hackathon / MUN / Internship / Workshop" placeholderTextColor={colors.muted} />
          </Field>
        )}

        {!isRequest ? (
          <>
            <Field label="Date & place">
              <TextInput style={styles.input} value={location} onChangeText={setLocation}
                placeholder="Venue or address" placeholderTextColor={colors.muted} />
            </Field>
            <Field label="Date (YYYY-MM-DD)">
              <TextInput style={styles.input} value={date} onChangeText={setDate}
                placeholder="2026-09-15" placeholderTextColor={colors.muted} />
            </Field>
            <Field label="Who are you looking for?">
              <TextInput style={styles.input} value={lookingFor} onChangeText={setLookingFor}
                placeholder="e.g. Backend devs, designers" placeholderTextColor={colors.muted} />
            </Field>
            <Field label="Spots available">
              <TextInput style={styles.input} value={spots} onChangeText={setSpots}
                keyboardType="number-pad" placeholder="e.g. 20" placeholderTextColor={colors.muted} />
            </Field>
          </>
        ) : (
          <Field label="Deadline (YYYY-MM-DD)">
            <TextInput style={styles.input} value={date} onChangeText={setDate}
              placeholder="2026-09-15" placeholderTextColor={colors.muted} />
          </Field>
        )}

        <Field label="Details">
          <TextInput style={[styles.input, styles.textarea]} value={description} onChangeText={setDescription}
            multiline placeholder="Describe it clearly…" placeholderTextColor={colors.muted} />
        </Field>

        <Button
          title={overLimit ? 'Upgrade to keep posting ⚡' : (isRequest ? 'Post request' : 'Publish event')}
          variant={overLimit ? 'dark' : 'primary'}
          onPress={publish}
          loading={saving}
          style={{ marginTop: 18 }}
        />
        <Text style={styles.note}>Posts are reviewed to keep the feed official and spam-free ✔</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function SegBtn({ label, on, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.segBtn, on && styles.segBtnOn]}>
      <Text style={[styles.segText, on && { color: colors.ink }]}>{label}</Text>
    </TouchableOpacity>
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
  planPill: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: 12, marginTop: 14 },
  planText: { fontSize: 12.5, color: colors.brand, fontWeight: '600', flex: 1 },
  goPro: { fontSize: 13, color: colors.brand, fontWeight: '800' },
  seg: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.md, padding: 4, marginTop: 16, borderWidth: 1, borderColor: colors.line },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segBtnOn: { backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  segText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
  textarea: { height: 96, textAlignVertical: 'top' },
  note: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 12 },
});

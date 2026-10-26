import React, { useState, useEffect } from 'react';
import { Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { notify } from '../../lib/notify';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, type, column } from '../../lib/theme';
import { Button } from '../../components/ui';
import EventFormFields, { emptyEventForm, extraFormProblem, eventRow, saveWithFallback, PasteToFill } from '../../components/EventForm';
import { formFromParams, markReviewed } from '../../lib/opportunities';
import { eventFormProblem } from '../../lib/events';
import { invalidate } from '../../lib/cache';
import { t } from '../../lib/i18n';

export default function Create() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const [form, setForm] = useState(() => emptyEventForm(profile));
  const [saving, setSaving] = useState(false);
  // Functional update: a cover upload finishing later must not put back the
  // form as it was when the upload started (losing typing since then).
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Opened from Admin → Suggestions ("Create event"): start from the suggestion.
  const params = useLocalSearchParams();
  const fromSubmission = typeof params.submission === 'string' && params.submission ? params.submission : null;
  useEffect(() => {
    if (fromSubmission) setForm(formFromParams(emptyEventForm(profile), params));
  }, [fromSubmission]); // eslint-disable-line react-hooks/exhaustive-deps

  async function publish() {
    // Title / date / time / spots / length checks are shared with Edit event,
    // so both screens accept exactly the same things (incl. no 2026-02-31).
    const problem = eventFormProblem(form) ?? extraFormProblem(form);
    if (problem) return notify(...problem);

    setSaving(true);
    const row = { author_id: session.user.id, ...eventRow(form) };
    // start_time left out when empty, so posting keeps working on a database
    // without the column (25_reminders.sql not run); see eventRow.
    const { data, error } = await saveWithFallback(row, (r) => supabase.from('posts').insert(r).select().single());
    if (error) {
      setSaving(false);
      // RLS: only organizer accounts may post (also when an admin approves a suggestion).
      if (error.code === '42501') return notify(t('Could not publish'), t('Only organizer accounts can publish events.'));
      return notify(t('Could not publish'), error.message);
    }
    let reviewNote = null;
    if (fromSubmission) {
      const res = await markReviewed(fromSubmission, 'approved', data.id);
      if (res.error) reviewNote = t('The event is live, but the suggestion could not be marked as approved: {msg}', { msg: res.error.message });
      router.setParams({ submission: undefined, title: undefined, description: undefined, url: undefined, date: undefined });
    }
    setSaving(false);
    setForm(emptyEventForm(profile));
    invalidate('feed:');
    notify(t('Published'), reviewNote ?? t('Your event is live in the feed.'));
    router.push(`/post/${data.id}`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <Text style={type.h1}>{t('Post an event')}</Text>
          <Text style={styles.sub}>{t('Publish an opportunity for students to apply to.')}</Text>
          <PasteToFill setForm={setForm} />
          <EventFormFields form={form} set={set} />
          <Button title={t('Publish event')} icon="send" onPress={publish} loading={saving} style={{ marginTop: 24 }} />
          <Text style={styles.note}>{t('Add your Telegram or phone in your Passport so applicants can reach you.')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 60, ...column },
  sub: { ...type.small, fontSize: 14, marginTop: 4 },
  note: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 12, lineHeight: 17 },
});

import React, { useState } from 'react';
import { Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { notify } from '../../lib/notify';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, type } from '../../lib/theme';
import { Button } from '../../components/ui';
import EventFormFields, { emptyEventForm, extraFormProblem, eventRow, saveWithFallback } from '../../components/EventForm';
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
    setSaving(false);
    if (error) return notify(t('Could not publish'), error.message);
    setForm(emptyEventForm(profile));
    invalidate('feed:');
    notify(t('Published'), t('Your event is live in the feed.'));
    router.push(`/post/${data.id}`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <Text style={type.h1}>{t('Post an event')}</Text>
          <Text style={styles.sub}>{t('Publish an opportunity for students to apply to.')}</Text>
          <EventFormFields form={form} set={set} />
          <Button title={t('Publish event')} icon="send" onPress={publish} loading={saving} style={{ marginTop: 24 }} />
          <Text style={styles.note}>{t('Add your Telegram or phone in your Passport so applicants can reach you.')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 60, width: '100%', maxWidth: 680, alignSelf: 'center' },
  sub: { ...type.small, fontSize: 14, marginTop: 4 },
  note: { fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 12, lineHeight: 17 },
});

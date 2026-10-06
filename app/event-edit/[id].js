import React, { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type } from '../../lib/theme';
import { Button, EmptyState } from '../../components/ui';
import { notify, confirmAsync } from '../../lib/notify';
import { requireRows, endEvent, eventFormProblem, formatStartTime } from '../../lib/events';
import EventFormFields, { eventFormFromPost, extraFormProblem, eventRow, saveWithFallback } from '../../components/EventForm';
import { invalidate } from '../../lib/cache';
import { t } from '../../lib/i18n';

export default function EditEvent() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const [form, setForm] = useState(null);
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
    setDenied(false);
    setForm(eventFormFromPost(data));
  }, [id, session?.user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save() {
    // Same checks as "Post an event" (title/details length, real and not-past
    // date, start time, spots, category, deadline…), shared via lib/events and
    // components/EventForm.
    const problem = eventFormProblem(form, { originalDate: originalDate.current }) ?? extraFormProblem(form);
    if (problem) return notify(...problem);

    setSaving(true);
    const row = eventRow(form, { originalTime: originalTime.current });
    const { error } = await saveWithFallback(row, (r) => requireRows(supabase.from('posts').update(r).eq('id', id)));
    setSaving(false);
    if (error) return notify(t('Could not save'), error.message);
    invalidate('feed:');
    notify(t('Event updated'), t('Your changes are live.'));
    router.back();
  }

  // Awards belong to the event and are deleted with it, so every participant
  // would silently lose that medal and its ranking points. Look first.
  async function remove() {
    setBusy('check');
    const { data: aw, error } = await supabase.from('awards').select('recipient_id').eq('post_id', id);
    setBusy(null);
    if (error) return notify(t('Could not check the medals'), `${error.message}\n\n${t('Nothing was deleted.')}`);
    const students = new Set((aw ?? []).map((a) => a.recipient_id)).size;
    if (students > 0) return setAwardWarning({ students });

    const ok = await confirmAsync(
      t('Delete this event?'),
      t('It disappears for everyone, along with its applications and chat. This cannot be undone.'),
      t('Delete'),
    );
    if (ok) await reallyDelete();
  }

  async function deleteAnyway() {
    const n = awardWarning?.students ?? 0;
    const ok = await confirmAsync(
      t('Delete anyway?'),
      t('{n} students will permanently lose their medals and points from this event. This cannot be undone.', { n }),
      t('Delete'),
    );
    if (ok) await reallyDelete();
  }

  async function reallyDelete() {
    setBusy('delete');
    const { error } = await requireRows(supabase.from('posts').delete().eq('id', id));
    setBusy(null);
    if (error) return notify(t('Could not delete'), error.message);
    notify(t('Event deleted'), '');
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
      return notify(t('Could not update'), e.message);
    }
    setBusy(null);
    setAwardWarning(null);
    notify(t('Marked as finished'), t('Everyone keeps their medals and points. The event has left the feed and no longer takes applications.'));
    if (router.canGoBack()) router.back();
    else router.replace(`/post/${id}`);
  }

  if (denied) return <EmptyState icon="lock-closed-outline" title={t('You can only edit events you created.')} />;
  if (!form) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;

  // Functional update: a cover upload finishing later must not put back
  // the form as it was when the upload started (losing typing since then).
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <EventFormFields form={form} set={set} />

      <Button title={t('Save changes')} icon="checkmark" onPress={save} loading={saving} style={{ marginTop: 24 }} />
      <Button title={t('Cancel')} variant="ghost" onPress={() => router.back()} style={{ marginTop: 10 }} />

      {awardWarning ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnTitle}>{t('This event has results')}</Text>
          <Text style={styles.warnText}>
            {t('{n} students will lose their medals and points from this event if you delete it.', { n: awardWarning.students })}
          </Text>
          {form.status === 'completed' ? (
            <>
              <Text style={styles.warnText}>
                {t("It's already marked finished: out of the feed and closed to applications, so there's no need to delete it.")}
              </Text>
              <Button title={t('Keep the event')} variant="green" style={{ marginTop: 12 }} disabled={!!busy} onPress={() => setAwardWarning(null)} />
            </>
          ) : (
            <>
              <Button title={t('Mark as finished instead')} icon="flag-outline" variant="green" style={{ marginTop: 12 }}
                loading={busy === 'finish'} disabled={busy === 'delete'} onPress={finishInstead} />
              <Text style={styles.warnHint}>
                {t('Recommended: everyone keeps their medals and points, and the event leaves the feed and stops taking applications.')}
              </Text>
            </>
          )}
          <Button title={t('Delete anyway')} variant="danger" style={{ marginTop: 12 }}
            loading={busy === 'delete'} disabled={busy === 'finish'} onPress={deleteAnyway} />
          {form.status !== 'completed' && (
            <Button title={t('Cancel')} variant="ghost" style={{ marginTop: 10 }} disabled={!!busy} onPress={() => setAwardWarning(null)} />
          )}
        </View>
      ) : (
        <>
          <Button title={t('Delete event')} icon="trash-outline" variant="danger" onPress={remove}
            loading={busy === 'check' || busy === 'delete'} style={{ marginTop: 26 }} />
          <Text style={styles.note}>{t('Deleting removes the event and everything attached to it. To simply close applications, use “End event” instead.')}</Text>
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 50, width: '100%', maxWidth: 680, alignSelf: 'center' },
  note: { fontSize: 11.5, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 16 },
  warnBox: { marginTop: 26, backgroundColor: colors.warnSoft, borderWidth: 1, borderColor: colors.warn, borderRadius: radius.md, padding: 16 },
  warnTitle: { ...type.title },
  warnText: { fontSize: 13.5, color: colors.ink, marginTop: 6, lineHeight: 20 },
  warnHint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
});

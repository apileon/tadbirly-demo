import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, column } from '../../lib/theme';
import { Button, TextField, EmptyState } from '../../components/ui';
import { notify } from '../../lib/notify';
import { endEvent } from '../../lib/events';
import { t } from '../../lib/i18n';

export default function EndEvent() {
  const { postId } = useLocalSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [post, setPost] = useState(undefined); // undefined = still loading
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('posts').select('title, status, author_id').eq('id', postId).single()
      .then(({ data }) => setPost(data ?? null));
  }, [postId]);

  const title = post?.title ?? t('Event');

  async function finish() {
    setBusy(true);
    try {
      const { count } = await endEvent(postId, feedback);
      notify(t('Event ended'), feedback.trim()
        ? (count === 1 ? t('Feedback sent to 1 participant.') : t('Feedback sent to {n} participants.', { n: count }))
        : t('The event is now marked completed.'));
      router.back();
    } catch (e) {
      notify(t('Could not end event'), e.message);
    }
    setBusy(false);
  }

  if (post === undefined) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <EmptyState icon="alert-circle-outline" title={t('Event not found.')} />;
  // Organizer-only. Before, anyone could open this link and be told "Event
  // ended" even though the database had quietly refused the change.
  if (post.author_id !== uid) {
    return (
      <View style={styles.gate}>
        <EmptyState
          icon="lock-closed-outline"
          title={t('Organizers only')}
          text={t('Only the organizer of this event can open this page.')}
          style={{ paddingBottom: 8 }}
        />
        <Button title={t('Open the event')} variant="ghost" style={{ marginTop: 8 }} onPress={() => router.replace(`/post/${postId}`)} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>{t('End "{title}"', { title })}</Text>
      <View style={styles.note}>
        <Text style={styles.sub}>
          {t('This marks the event as finished: it leaves the feed, shows a red "Finished" banner, and moves to your past events. Your closing message is posted in the event chat for every accepted participant.')}
        </Text>
      </View>

      <TextField
        label={t('Feedback or thank-you message (optional)')}
        value={feedback}
        onChangeText={setFeedback}
        multiline
        placeholder={t('Thank you all for taking part! Certificates will be sent by email.')}
        inputStyle={{ height: 120, textAlignVertical: 'top' }}
        style={{ marginTop: 18 }}
      />

      <Button title={t('End event and send feedback')} icon="flag-outline" onPress={finish} loading={busy} style={{ marginTop: 18 }} />
      <Button title={t('Cancel')} variant="ghost" onPress={() => router.back()} style={{ marginTop: 10 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 40, ...column },
  heading: { ...type.h1 },
  note: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginTop: 12 },
  sub: { ...type.body, fontSize: 13.5, lineHeight: 20 },
  gate: { padding: 24, alignItems: 'center', width: '100%', maxWidth: 520, alignSelf: 'center' },
});

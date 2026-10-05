import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import { Button } from '../../components/ui';
import { notify } from '../../lib/notify';
import { endEvent } from '../../lib/events';

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

  const title = post?.title ?? 'Event';

  async function finish() {
    setBusy(true);
    try {
      const { count } = await endEvent(postId, feedback);
      notify('Event ended 🏁', feedback.trim()
        ? `Feedback sent to ${count} participant${count === 1 ? '' : 's'}.`
        : 'The event is now marked completed.');
      router.back();
    } catch (e) {
      notify('Could not end event', e.message);
    }
    setBusy(false);
  }

  if (post === undefined) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <Text style={styles.gate}>Event not found.</Text>;
  // Organizer-only. Before, anyone could open this link and be told "Event
  // ended" even though the database had quietly refused the change.
  if (post.author_id !== uid) {
    return (
      <View style={{ padding: 24, alignItems: 'center' }}>
        <Text style={styles.gate}>Only the organizer of this event can open this page.</Text>
        <Button title="Open the event" variant="ghost" style={{ marginTop: 14 }} onPress={() => router.replace(`/post/${postId}`)} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      <Text style={styles.h1}>End “{title}”</Text>
      <Text style={styles.sub}>
        This marks the event as finished: it leaves the feed, shows a red "Finished" banner, and moves to your past events. Your closing message is posted in the event chat for every accepted participant.
      </Text>

      <Text style={styles.label}>Feedback / thank-you message (optional)</Text>
      <TextInput
        style={[styles.input, { height: 120, textAlignVertical: 'top' }]}
        value={feedback}
        onChangeText={setFeedback}
        multiline
        placeholder="Thank you all for taking part! Certificates will be sent by email. It was a pleasure…"
        placeholderTextColor={colors.muted}
      />

      <Button title="🏁 End event & send feedback" onPress={finish} loading={busy} style={{ marginTop: 18 }} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: 10 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13.5, color: colors.muted, marginTop: 6, lineHeight: 20 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 18, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
  gate: { textAlign: 'center', color: colors.muted, marginTop: 60, paddingHorizontal: 20, lineHeight: 21 },
});

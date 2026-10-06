import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type } from '../../lib/theme';
import { Button, TextField } from '../../components/ui';
import Stars from '../../components/Stars';
import { notify } from '../../lib/notify';
import { t } from '../../lib/i18n';

const LABELS = ['', 'Poor', 'Okay', 'Good', 'Great', 'Excellent'];

// Accepted participants rate an event once its day has come. The database
// checks that too (event_reviews insert policy, supabase/29).
export default function Review() {
  const { postId } = useLocalSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [post, setPost] = useState(null);
  const [existing, setExisting] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, r] = await Promise.all([
        supabase.from('posts').select('id, title').eq('id', postId).single(),
        supabase.from('event_reviews').select('*').eq('post_id', postId).eq('reviewer_id', uid).maybeSingle(),
      ]);
      setPost(p.data ?? { id: postId, title: '' });
      if (r.data) { setExisting(r.data); setRating(r.data.rating); setComment(r.data.comment ?? ''); }
    })();
  }, [postId, uid]);

  async function submit() {
    if (!rating) return notify(t('Pick a rating'), t('Tap the stars to choose from 1 to 5.'));
    setBusy(true);
    const row = { post_id: postId, reviewer_id: uid, rating, comment: comment.trim().slice(0, 1000) || null };
    const { error } = existing
      ? await supabase.from('event_reviews').update({ rating: row.rating, comment: row.comment }).eq('id', existing.id)
      : await supabase.from('event_reviews').insert(row);
    setBusy(false);
    if (error) {
      return notify(t('Could not save your review'), error.code === '42501'
        ? t('Only accepted participants can rate an event, once it has taken place.')
        : error.message);
    }
    notify(t('Thanks for your review'), t('It helps other students choose good events.'));
    router.back();
  }

  if (!post) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={type.small}>{t('How was')}</Text>
        <Text style={styles.title}>{post.title}</Text>
        <View style={styles.stars}>
          <Stars value={rating} onChange={setRating} size={38} gap={8} />
          <Text style={styles.label}>{rating ? t(LABELS[rating]) : ' '}</Text>
        </View>
        <TextField
          label={t('Tell others about it (optional)')}
          value={comment}
          onChangeText={setComment}
          multiline
          maxLength={1000}
          placeholder={t('What was good? What could be better?')}
          inputStyle={{ minHeight: 110, textAlignVertical: 'top' }}
        />
        <Text style={styles.note}>{t('Your name is shown with your review.')}</Text>
        <Button title={existing ? t('Update review') : t('Post review')} icon="send" loading={busy} onPress={submit} style={{ marginTop: 18 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, width: '100%', maxWidth: 560, alignSelf: 'center' },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line, padding: 20 },
  title: { ...type.h2, marginTop: 2 },
  stars: { alignItems: 'center', marginTop: 22, marginBottom: 6 },
  label: { fontSize: 15, fontWeight: '700', color: colors.warn, marginTop: 10 },
  note: { ...type.small, fontSize: 12, marginTop: 8 },
});

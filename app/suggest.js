import React, { useState } from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/auth';
import { colors, type, column } from '../lib/theme';
import { Button, TextField } from '../components/ui';
import { notify } from '../lib/notify';
import { parseEventDate } from '../lib/events';
import { submitSuggestion, SUGGEST_TITLE_MAX, SUGGEST_DETAILS_MAX } from '../lib/opportunities';
import { t } from '../lib/i18n';

// Students: "Know an opportunity? Suggest it". Admins review it in /admin/review.
export default function Suggest() {
  const router = useRouter();
  const { session } = useAuth();
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function send() {
    if (title.trim().length < 3) return notify(t('Add a title'), t('What is the opportunity called?'));
    if (!link.trim()) return notify(t('Add a link or the text'), t('Paste a link or the post so we can check it.'));
    if (date.trim() && !parseEventDate(date)) return notify(t('Check the date'), t('Use the format YYYY-MM-DD, e.g. 2026-10-05.'));
    setSaving(true);
    const { error } = await submitSuggestion({ userId: session?.user?.id, title, link, date });
    setSaving(false);
    if (error) {
      if (error.code === 'daily_limit') return notify(t('That’s enough for today'), t('You can suggest up to 5 opportunities a day.'));
      return notify(t('Could not send'), error.message);
    }
    notify(t('Thanks!'), t('We’ll check it and add it to the feed. You’ll get a notification when it’s live.'));
    if (router.canGoBack()) router.back(); else router.replace('/(tabs)');
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.sub}>{t('Saw a hackathon, MUN, olympiad or internship somewhere? Send it and we’ll add it for everyone.')}</Text>
      <TextField label={t('Title')} value={title} onChangeText={setTitle} maxLength={SUGGEST_TITLE_MAX}
        placeholder={t('e.g. TashMUN 2026: delegates wanted')} />
      <TextField label={t('Link or post text')} value={link} onChangeText={setLink} multiline maxLength={SUGGEST_DETAILS_MAX}
        inputStyle={{ minHeight: 100, textAlignVertical: 'top' }} placeholder={t('Paste the post text or a link here')} />
      <TextField label={t('Date (YYYY-MM-DD)')} value={date} onChangeText={setDate} placeholder={t('Optional')} />
      <Button title={t('Send suggestion')} icon="send" onPress={send} loading={saving} style={{ marginTop: 22 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 40, ...column },
  sub: { ...type.small, lineHeight: 20 },
});

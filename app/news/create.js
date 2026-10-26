import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, column } from '../../lib/theme';
import { Button, TextField } from '../../components/ui';
import { notify } from '../../lib/notify';
import { pickImage, uploadNewsImage, canPickImage, releasePreview } from '../../lib/news';
import { t } from '../../lib/i18n';

export default function CreateNews() {
  const router = useRouter();
  const { session } = useAuth();
  const [body, setBody] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);

  async function choose() {
    const picked = await pickImage();
    if (!picked) return;
    if (picked.size > 5 * 1024 * 1024) return notify(t('Image too large'), t('Please pick a photo under 5 MB.'));
    releasePreview(file);
    setFile(picked);
    // A blob: URL on the web, the picked file's uri natively.
    setPreview(picked.previewUri);
  }

  async function publish() {
    if (!body.trim()) return notify(t('Write something'), t('Add the text of your announcement.'));
    setSaving(true);
    try {
      let imageUrl = null;
      if (file) imageUrl = await uploadNewsImage(file);
      const { data, error } = await supabase
        .from('news_posts')
        .insert({ author_id: session.user.id, body: body.trim(), image_url: imageUrl })
        .select('id')
        .single();
      if (error) throw error;
      notify(t('Posted'), t('Your news is live in the Social tab.'));
      router.replace(`/news/${data.id}`);
    } catch (e) {
      notify(t('Could not post'), e.message);
    }
    setSaving(false);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <Text style={styles.h1}>{t('Post news')}</Text>
      <Text style={styles.sub}>{t('Share an announcement, a recap or a photo with everyone at your school.')}</Text>

      <TextField
        label={t('Your announcement')}
        value={body}
        onChangeText={setBody}
        multiline
        placeholder={t('TashMUN 2026 was a huge success: 40 delegates, 3 committees…')}
        inputStyle={{ height: 150, textAlignVertical: 'top' }}
        style={{ marginTop: 20 }}
      />

      <Text style={styles.label}>{t('Photo (optional)')}</Text>
      {preview ? (
        <View>
          <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" />
          <TouchableOpacity style={styles.removeRow} onPress={() => { releasePreview(file); setFile(null); setPreview(null); }}>
            <Ionicons name="trash-outline" size={15} color={colors.danger} />
            <Text style={styles.remove}>{t('Remove photo')}</Text>
          </TouchableOpacity>
        </View>
      ) : canPickImage ? (
        <Button title={t('Choose a photo')} icon="image-outline" variant="ghost" onPress={choose} />
      ) : null}

      <Button title={t('Publish')} icon="paper-plane-outline" onPress={publish} loading={saving} style={{ marginTop: 24 }} />
      <Button title={t('Cancel')} variant="ghost" onPress={() => router.back()} style={{ marginTop: 10 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 40, ...column },
  h1: { ...type.h1 },
  sub: { ...type.small, marginTop: 6, lineHeight: 20 },
  label: { ...type.label, marginTop: 18, marginBottom: 7 },
  preview: { width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: colors.line },
  removeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, paddingVertical: 4 },
  remove: { color: colors.danger, fontWeight: '700', fontSize: 13 },
});

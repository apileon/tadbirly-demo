import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import { Button } from '../../components/ui';
import { notify } from '../../lib/notify';
import { pickImage, uploadNewsImage, canPickImage, releasePreview } from '../../lib/news';

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
    if (picked.size > 5 * 1024 * 1024) return notify('Image too large', 'Please pick a photo under 5 MB.');
    releasePreview(file);
    setFile(picked);
    // A blob: URL on the web, the picked file's uri natively.
    setPreview(picked.previewUri);
  }

  async function publish() {
    if (!body.trim()) return notify('Write something', 'Add the text of your announcement.');
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
      notify('Posted 📰', 'Your news is live in the Social tab.');
      router.replace(`/news/${data.id}`);
    } catch (e) {
      notify('Could not post', e.message);
    }
    setSaving(false);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      <Text style={styles.h1}>Post news</Text>
      <Text style={styles.sub}>Share an announcement, a recap or a photo with everyone at your school.</Text>

      <Text style={styles.label}>Your announcement</Text>
      <TextInput
        style={[styles.input, { height: 140, textAlignVertical: 'top' }]}
        value={body}
        onChangeText={setBody}
        multiline
        placeholder="TashMUN 2026 was a huge success — 40 delegates, 3 committees…"
        placeholderTextColor={colors.muted}
      />

      <Text style={styles.label}>Photo (optional)</Text>
      {preview ? (
        <View>
          <Image source={{ uri: preview }} style={styles.preview} resizeMode="cover" />
          <TouchableOpacity onPress={() => { releasePreview(file); setFile(null); setPreview(null); }}>
            <Text style={styles.remove}>Remove photo</Text>
          </TouchableOpacity>
        </View>
      ) : canPickImage ? (
        <Button title="🖼️ Choose a photo" variant="ghost" onPress={choose} />
      ) : null}

      <Button title="Publish" onPress={publish} loading={saving} style={{ marginTop: 20 }} />
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: 10 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13.5, color: colors.muted, marginTop: 6, lineHeight: 20 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 18, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
  preview: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.card },
  remove: { color: colors.danger, fontWeight: '700', fontSize: 13, textAlign: 'center', marginTop: 10 },
});

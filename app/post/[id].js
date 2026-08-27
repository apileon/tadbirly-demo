import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, CATEGORIES } from '../../lib/theme';
import { Button, Tag } from '../../components/ui';
import { reportContent, blockUser } from '../../lib/moderation';

export default function PostDetail() {
  const { id } = useLocalSearchParams();
  const { session } = useAuth();
  const router = useRouter();
  const [post, setPost] = useState(null);
  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('posts')
      .select('*, author:profiles!posts_author_id_fkey(id, full_name, reliability)')
      .eq('id', id)
      .single();
    setPost(data);
    if (session?.user?.id) {
      const { data: app } = await supabase
        .from('applications')
        .select('*')
        .eq('post_id', id)
        .eq('applicant_id', session.user.id)
        .maybeSingle();
      setApplication(app);
    }
    setLoading(false);
  }, [id, session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function apply() {
    if (!post) return;
    const isOwner = post.author?.id === session?.user?.id;
    if (isOwner) return Alert.alert("That's your post", 'You cannot apply to your own post.');
    setApplying(true);
    // 1. create application
    const { error } = await supabase.from('applications').insert({
      post_id: post.id,
      applicant_id: session.user.id,
    });
    if (error) {
      setApplying(false);
      return Alert.alert('Could not apply', error.message);
    }
    // 2. open a chat thread between applicant and organizer
    await supabase.from('chats').upsert(
      {
        post_id: post.id,
        participant_id: session.user.id,
        organizer_id: post.author.id,
      },
      { onConflict: 'post_id,participant_id' }
    );
    setApplying(false);
    await load();
    Alert.alert('Applied ✅', 'Your application was sent. A chat with the organizer is now open.');
  }

  function safety() {
    const authorId = post?.author?.id;
    Alert.alert('Report or block', 'Keep Tadbirly safe.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report this post',
        onPress: async () => {
          await reportContent({ postId: post.id, reportedUserId: authorId, reason: 'Reported from post' });
          Alert.alert('Thanks', 'Our team will review this post.');
        },
      },
      {
        text: 'Block this organizer',
        style: 'destructive',
        onPress: async () => {
          await blockUser(authorId);
          Alert.alert('Blocked', "You won't see their posts anymore.");
          router.back();
        },
      },
    ]);
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <Text style={styles.empty}>Post not found.</Text>;

  const cat = CATEGORIES[post.kind] ?? CATEGORIES.event;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={[styles.hero, { backgroundColor: cat.color }]}>
        <Tag label={`${cat.emoji} ${cat.label}`} color="#fff" soft="rgba(255,255,255,0.22)" />
        <Text style={styles.heroTitle}>{post.title}</Text>
        <Text style={styles.heroMeta}>
          {post.location ?? post.city}{post.event_date ? ` · ${post.event_date}` : ''}
        </Text>
      </View>

      <Section title="About">
        <Text style={styles.body}>{post.description || 'No description provided.'}</Text>
      </Section>

      {post.looking_for ? (
        <Section title="Who they're looking for">
          <Text style={styles.body}>{post.looking_for}</Text>
        </Section>
      ) : null}

      <View style={styles.statRow}>
        <Stat label="Category" value={post.category ?? cat.label} />
        {typeof post.spots === 'number' && <Stat label="Spots" value={String(post.spots)} />}
        <Stat label="Organizer ⭐" value={`${post.author?.reliability ?? 100}%`} />
      </View>

      {application ? (
        <View style={[styles.statusBox, { backgroundColor: statusColor(application.status).soft }]}>
          <Text style={[styles.statusText, { color: statusColor(application.status).color }]}>
            {statusLabel(application.status)}
          </Text>
        </View>
      ) : (
        <Button title="Apply now" onPress={apply} loading={applying} style={{ marginTop: 6 }} />
      )}

      <Button
        title="Message organizer"
        variant="ghost"
        style={{ marginTop: 12 }}
        onPress={() => router.push('/(tabs)/chats')}
      />

      <TouchableOpacity onPress={safety} style={{ marginTop: 18, alignItems: 'center' }}>
        <Text style={styles.reportLink}>⚑ Report or block</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const statusLabel = (s) =>
  s === 'accepted' ? '🟢 Accepted — seat confirmed'
  : s === 'rejected' ? '🔴 Not selected this time'
  : '🟡 Applied — pending review';

const statusColor = (s) =>
  s === 'accepted' ? { color: colors.accent, soft: colors.accentSoft }
  : s === 'rejected' ? { color: colors.danger, soft: '#fdecec' }
  : { color: colors.warn, soft: colors.warnSoft };

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: 20, marginBottom: 14 },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 10 },
  heroMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6 },
  section: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, marginBottom: 8, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 22, color: colors.ink },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  stat: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '800', color: colors.ink },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  statusBox: { borderRadius: radius.md, padding: 14, alignItems: 'center', marginTop: 6 },
  statusText: { fontSize: 14, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 60 },
  reportLink: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});

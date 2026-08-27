import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { colors, radius, CATEGORIES, CATEGORY_ORDER } from '../../lib/theme';
import { Tag, Card } from '../../components/ui';

const FILTERS = [
  { key: 'all', label: 'All' },
  ...CATEGORY_ORDER.map((k) => ({ key: k, label: `${CATEGORIES[k].emoji} ${CATEGORIES[k].label}` })),
];

export default function Feed() {
  const router = useRouter();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('posts')
      .select('*, author:profiles!posts_author_id_fkey(full_name, reliability)')
      .eq('status', 'open')
      .order('boosted', { ascending: false })
      .order('created_at', { ascending: false });
    if (filter !== 'all') query = query.eq('kind', filter);
    const { data } = await query;
    // Hide posts from users you've blocked.
    const { data: blocked } = await supabase.from('blocks').select('blocked_id');
    const blockedSet = new Set((blocked ?? []).map((b) => b.blocked_id));
    setPosts((data ?? []).filter((p) => !blockedSet.has(p.author_id)));
    setLoading(false);
  }, [filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const visible = posts.filter((p) =>
    !search.trim() || p.title?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Text style={styles.logo}>Tadbir<Text style={{ color: colors.brand }}>ly</Text></Text>
          <Text style={styles.city}>📍 Tashkent ▾</Text>
        </View>
        <TextInput
          style={styles.search}
          placeholder="Search events, internships, MUN…"
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <View>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f.key}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
          renderItem={({ item }) => {
            const on = filter === item.key;
            return (
              <TouchableOpacity
                onPress={() => setFilter(item.key)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && { color: '#fff' }]}>{item.label}</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      <FlatList
        data={visible}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.brand} />}
        ListEmptyComponent={
          !loading && (
            <Text style={styles.empty}>
              Nothing here yet. Tap the ➕ Post tab to publish the first opportunity.
            </Text>
          )
        }
        renderItem={({ item }) => <PostCard post={item} onPress={() => router.push(`/post/${item.id}`)} />}
      />
    </SafeAreaView>
  );
}

function PostCard({ post, onPress }) {
  const cat = CATEGORIES[post.kind] ?? CATEGORIES.event;
  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Tag label={`${cat.emoji} ${cat.label}`} color={cat.color} soft={cat.soft} />
        {post.boosted && <Text style={styles.boost}>⚡ Boosted</Text>}
      </View>
      <Text style={styles.title}>{post.title}</Text>
      <Text style={styles.meta}>
        {post.category ? `${post.category} · ` : ''}
        {post.location ?? post.city}
        {post.event_date ? ` · ${post.event_date}` : ''}
      </Text>
      <View style={styles.row}>
        <Text style={styles.author}>by {post.author?.full_name ?? 'Organizer'}</Text>
        {typeof post.spots === 'number' && <Text style={styles.spots}>{post.spots} spots</Text>}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.card, paddingHorizontal: 18, paddingTop: 6, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { fontSize: 22, fontWeight: '800', color: colors.ink },
  city: { fontSize: 12, color: colors.muted, backgroundColor: colors.bg, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20, overflow: 'hidden' },
  search: { marginTop: 12, backgroundColor: colors.bg, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 14, fontSize: 14, color: colors.ink },
  chip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 12.5, color: colors.muted, fontWeight: '600' },
  title: { fontSize: 15.5, fontWeight: '700', color: colors.ink, marginTop: 8 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 4, lineHeight: 18 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  author: { fontSize: 12, color: colors.muted },
  spots: { fontSize: 12, color: colors.brand, fontWeight: '700' },
  boost: { fontSize: 11, color: colors.warn, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, fontSize: 14, lineHeight: 22, paddingHorizontal: 20 },
});

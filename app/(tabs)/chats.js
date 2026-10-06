import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCachedQuery, writeCache } from '../../lib/cache';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type } from '../../lib/theme';
import { Button, Card, Avatar, EmptyState } from '../../components/ui';
import { confirmAsync, notify } from '../../lib/notify';
import { timeAgo } from '../../lib/news';
import { sharedStreak } from '../../lib/social';
import { SkeletonList } from '../../components/Skeleton';
import { useBadges, unreadByChat } from '../../lib/badges';
import Dot from '../../components/Dot';
import { t } from '../../lib/i18n';

export default function Social() {
  const [tab, setTab] = useState('chats');
  const { badges } = useBadges();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={styles.head}>
        <Text style={styles.heading}>{t('Social')}</Text>
        <View style={styles.seg}>
          <SegBtn label={t('Chats')} icon="chatbubbles-outline" on={tab === 'chats'} onPress={() => setTab('chats')} n={badges.messages} />
          <SegBtn label={t('News')} icon="newspaper-outline" on={tab === 'news'} onPress={() => setTab('news')} />
        </View>
      </View>
      {/* Both stay mounted so switching is instant — no reload, no flicker. */}
      <View style={{ flex: 1, display: tab === 'chats' ? 'flex' : 'none' }}><ChatsDivision /></View>
      <View style={{ flex: 1, display: tab === 'news' ? 'flex' : 'none' }}><NewsDivision /></View>
    </SafeAreaView>
  );
}

/* ================= CHATS ================= */
function ChatsDivision() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;

  const fetchChats = useCallback(async () => {
    if (!uid) return [];
    const { data } = await supabase
      .from('chats')
      .select('*, post:posts(title, kind), participant:profiles!chats_participant_id_fkey(full_name, avatar_url), organizer:profiles!chats_organizer_id_fkey(full_name, avatar_url)')
      .or(`participant_id.eq.${uid},organizer_id.eq.${uid}`)
      .order('created_at', { ascending: false });
    const list = data ?? [];

    // Shared-event streak with each person, same as Portal → Network.
    const otherId = (c) => (c.organizer_id === uid ? c.participant_id : c.organizer_id);
    const ids = list.map(otherId).filter(Boolean);
    const { data: aw } = await supabase
      .from('awards')
      .select('recipient_id, post_id')
      .in('recipient_id', [uid, ...ids])
      .eq('verified', true);
    const byUser = {};
    (aw ?? []).forEach((r) => { (byUser[r.recipient_id] ??= []).push(r.post_id); });
    const mine = byUser[uid] ?? [];

    // Unread count + last activity per chat, so the list reads like a
    // messaging app: newest conversation on top, unread ones marked.
    const unread = await unreadByChat();

    return list
      .map((c) => ({
        ...c,
        streak: sharedStreak(mine, byUser[otherId(c)] ?? []),
        unread: unread[c.id]?.unread ?? 0,
        lastAt: unread[c.id]?.lastAt ?? c.created_at,
      }))
      .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  }, [uid]);

  const { data, loading: first, setData, refresh } = useCachedQuery(uid ? `chats:${uid}` : null, fetchChats);
  const chats = data ?? [];

  // The tab dot and this list read the same counts, so refresh together.
  // Safe from looping: fetchChats only reads, so it can't change the counts.
  // `refresh` is read through a ref so ONLY a new unread count (or a new user)
  // re-runs this — with it in the deps, any change to its identity meant
  // render → fetch → setData → render → fetch… without end.
  const { badges } = useBadges();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => { if (uid) refreshRef.current(); }, [badges.messages, uid]);

  async function removeChat(item, otherName) {
    const ok = await confirmAsync(
      t('Delete chat?'),
      otherName
        ? t('This deletes the whole conversation with {name} for both of you.', { name: otherName })
        : t('This deletes the whole conversation with this person for both of you.'),
      t('Delete'),
    );
    if (!ok) return;
    setData((prev) => {
      const next = (prev ?? []).filter((c) => c.id !== item.id);
      if (uid) writeCache(`chats:${uid}`, next);
      return next;
    });
    const { error } = await supabase.from('chats').delete().eq('id', item.id);
    if (error) { notify(t('Could not delete'), error.message); refresh(); }
  }

  if (first) return <SkeletonList count={4} type="row" />;

  return (
    <FlatList
      data={chats}
      keyExtractor={(c) => c.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={{ marginBottom: 12 }}>
          <Button title={t('Find people and add friends')} icon="search-outline" onPress={() => router.push('/search')} />
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon="chatbubbles-outline"
          title={t('No chats yet')}
          text={t('Add a friend, or message an applicant from Review applicants.')}
        />
      }
      renderItem={({ item }) => {
        const iAmOrganizer = item.organizer_id === session?.user?.id;
        const otherP = iAmOrganizer ? item.participant : item.organizer;
        const other = otherP?.full_name;
        const otherId = iAmOrganizer ? item.participant_id : item.organizer_id;
        return (
          <View style={styles.row}>
            <TouchableOpacity style={styles.rowMain} onPress={() => router.push(`/chat/${item.id}`)}>
              <Avatar uri={otherP?.avatar_url} name={other} id={otherId} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, item.unread > 0 && styles.nameUnread]}>{other ?? t('User')}</Text>
                <Text style={[styles.post, item.unread > 0 && styles.postUnread]} numberOfLines={1}>
                  {item.post?.title ?? t('Direct message')}
                </Text>
                <View style={styles.streakRow}>
                  <Ionicons name="flame-outline" size={13} color={item.streak ? colors.warn : colors.muted} />
                  <Text style={[styles.streak, !item.streak && styles.streakZero]}>
                    {item.streak === 1 ? t('1 event together') : t('{n} events together', { n: item.streak ?? 0 })}
                  </Text>
                </View>
              </View>
              <Dot n={item.unread} />
              {iAmOrganizer && item.post && <Text style={styles.badge}>{t('Applicant')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.trash}
              onPress={() => removeChat(item, other)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t('Delete chat')}
            >
              <Ionicons name="trash-outline" size={18} color={colors.muted} />
            </TouchableOpacity>
          </View>
        );
      }}
    />
  );
}

/* ================= NEWS ================= */
function NewsDivision() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const uid = session?.user?.id;
  const isOrg = profile?.role === 'organizer';
  const [posts, setPosts] = useState([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('news_posts')
      .select('*, author:profiles!news_posts_author_id_fkey(id, full_name, avatar_url), likes:news_likes(user_id), comments:news_comments(count)')
      .order('created_at', { ascending: false })
      .limit(50);
    setPosts(data ?? []);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function toggleLike(item) {
    if (!uid) return;
    const liked = (item.likes ?? []).some((l) => l.user_id === uid);
    // Sets my like on this post to `on`, whatever the list currently shows.
    const showLiked = (on) => setPosts((prev) => prev.map((p) => {
      if (p.id !== item.id) return p;
      const others = (p.likes ?? []).filter((l) => l.user_id !== uid);
      return { ...p, likes: on ? [...others, { user_id: uid }] : others };
    }));
    showLiked(!liked); // instant
    const { error } = liked
      ? await supabase.from('news_likes').delete().eq('news_id', item.id).eq('user_id', uid)
      : await supabase.from('news_likes').insert({ news_id: item.id, user_id: uid });
    // Didn't save (offline, …): put the heart back how it really is, rather
    // than showing a like that isn't there. A duplicate-key error on insert
    // (23505) means the like already exists — the new state IS the real one.
    if (error && error.code !== '23505') showLiked(liked);
  }

  return (
    <FlatList
      data={posts}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        isOrg ? (
          <View style={{ marginBottom: 12 }}>
            <Button title={t('Post news')} icon="create-outline" onPress={() => router.push('/news/create')} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        <EmptyState
          icon="newspaper-outline"
          title={t('No news yet')}
          text={isOrg ? t('Tap "Post news" to share an announcement with the school.') : t('Organizers post announcements here.')}
        />
      }
      renderItem={({ item }) => {
        const likes = item.likes ?? [];
        const liked = likes.some((l) => l.user_id === uid);
        const commentCount = item.comments?.[0]?.count ?? 0;
        return (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <TouchableOpacity style={styles.newsHead} onPress={() => item.author?.id && router.push(`/user/${item.author.id}`)}>
              <Avatar uri={item.author?.avatar_url} name={item.author?.full_name} id={item.author?.id} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.newsAuthor}>{item.author?.full_name ?? t('Organizer')}</Text>
                <Text style={styles.newsTime}>{timeAgo(item.created_at)}</Text>
              </View>
            </TouchableOpacity>

            {item.image_url ? (
              <Image source={{ uri: item.image_url }} style={styles.newsImage} resizeMode="cover" />
            ) : null}

            <View style={{ padding: 14 }}>
              <Text style={styles.newsBody} numberOfLines={5}>{item.body}</Text>
              <View style={styles.newsActions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => toggleLike(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={liked ? t('Unlike') : t('Like')}
                >
                  <Ionicons name={liked ? 'heart' : 'heart-outline'} size={19} color={liked ? colors.danger : colors.ink} />
                  <Text style={[styles.action, liked && { color: colors.danger }]}>{likes.length}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => router.push(`/news/${item.id}`)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('Comments')}
                >
                  <Ionicons name="chatbubble-outline" size={18} color={colors.ink} />
                  <Text style={styles.action}>{commentCount}</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={styles.actionBtn} onPress={() => router.push(`/news/${item.id}`)}>
                  <Text style={styles.open}>{t('Open')}</Text>
                  <Ionicons name="chevron-forward" size={15} color={colors.brand} />
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        );
      }}
    />
  );
}

function SegBtn({ label, icon, on, onPress, n = 0 }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.segBtn, on && styles.segBtnOn]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {icon ? <Ionicons name={icon} size={15} color={on ? colors.onBrand : colors.muted} /> : null}
        <Text style={[styles.segText, on && { color: colors.onBrand }]}>{label}</Text>
        <Dot n={n} plain />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 8 },
  heading: { ...type.h1 },
  seg: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill, padding: 4, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  segBtn: { flex: 1, paddingVertical: 9, borderRadius: radius.pill, alignItems: 'center' },
  segBtnOn: { backgroundColor: colors.brand },
  segText: { fontSize: 13, fontWeight: '700', color: colors.muted },

  list: { padding: 16, paddingBottom: 32, width: '100%', maxWidth: 680, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, marginBottom: 10 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  trash: { paddingHorizontal: 14, paddingVertical: 18, borderLeftWidth: 1, borderLeftColor: colors.line },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  post: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  nameUnread: { fontWeight: '900' },
  postUnread: { color: colors.ink, fontWeight: '700' },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  streak: { fontSize: 12.5, color: colors.warn, fontWeight: '700' },
  streakZero: { color: colors.muted, fontWeight: '600' },
  badge: { fontSize: 11, color: colors.warn, fontWeight: '700', backgroundColor: colors.warnSoft, paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.xs, overflow: 'hidden' },

  newsHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  newsAuthor: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  newsTime: { fontSize: 11.5, color: colors.muted, marginTop: 1 },
  newsImage: { width: '100%', height: 240, backgroundColor: colors.bg },
  newsBody: { ...type.body, fontSize: 14.5, lineHeight: 21 },
  newsActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  action: { fontSize: 14, color: colors.ink, fontWeight: '700' },
  open: { fontSize: 13, color: colors.brand, fontWeight: '700' },
});

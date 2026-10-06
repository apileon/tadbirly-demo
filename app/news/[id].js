import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, Image, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type, shadow } from '../../lib/theme';
import { Avatar, EmptyState } from '../../components/ui';
import { notify, confirmAsync } from '../../lib/notify';
import { timeAgo } from '../../lib/news';
import { useReportSheet, useBlockedIds, ReportButton } from '../../lib/moderation';
import { t } from '../../lib/i18n';

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

export default function NewsDetail() {
  const { id } = useLocalSearchParams();
  const { session } = useAuth();
  const router = useRouter();
  const uid = session?.user?.id;
  const [post, setPost] = useState(null);
  const [likes, setLikes] = useState([]);
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  // One like/unlike at a time: a quick double tap could otherwise let the
  // delete overtake the insert and leave the heart out of sync with the server.
  const likeBusy = useRef(false);
  // Report the post or a comment; content from people I blocked is hidden.
  const blockedIds = useBlockedIds();
  const safety = useReportSheet();

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('news_posts')
      .select('*, author:profiles!news_posts_author_id_fkey(id, full_name)')
      .eq('id', id).single();
    setPost(data);
    const { data: l } = await supabase.from('news_likes').select('user_id').eq('news_id', id);
    setLikes(l ?? []);
    const { data: c } = await supabase
      .from('news_comments')
      .select('*, author:profiles!news_comments_author_id_fkey(id, full_name)')
      .eq('news_id', id).order('created_at', { ascending: true });
    setComments(c ?? []);
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const liked = likes.some((l) => l.user_id === uid);

  async function toggleLike() {
    if (!uid || likeBusy.current) return;
    likeBusy.current = true;
    const wasLiked = liked;
    const show = (on) => setLikes((prev) => {
      const without = prev.filter((l) => l.user_id !== uid);
      return on ? [...without, { user_id: uid }] : without;
    });
    show(!wasLiked); // optimistic
    let error = null;
    try {
      ({ error } = wasLiked
        ? await supabase.from('news_likes').delete().eq('news_id', id).eq('user_id', uid)
        : await supabase.from('news_likes').insert({ news_id: id, user_id: uid }));
    } catch (e) {
      error = e;
    } finally {
      likeBusy.current = false;
    }
    // 23505 = the like already exists on the server, which is the state we wanted.
    if (error && error.code !== '23505') {
      show(wasLiked); // roll back — the heart must not claim something that didn't happen
      notify(t('Could not update your like'), error.message);
    }
  }

  async function addComment() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    let error = null;
    try {
      ({ error } = await supabase.from('news_comments').insert({ news_id: id, author_id: uid, body }));
    } catch (e) {
      error = e;
    } finally {
      setSending(false);
    }
    // Keep what they wrote when it fails, so they can simply tap Post again.
    if (error) return notify(t('Could not comment'), error.message);
    // Only clear if they haven't started typing something new meanwhile.
    setText((cur) => (cur.trim() === body ? '' : cur));
    load();
  }

  async function removeComment(c) {
    if (!(await confirmAsync(t('Delete comment?'), '', t('Delete')))) return;
    setComments((prev) => prev.filter((x) => x.id !== c.id));
    const { error } = await supabase.from('news_comments').delete().eq('id', c.id);
    if (error) { notify(t('Could not delete'), error.message); load(); }
  }

  async function removePost() {
    if (!(await confirmAsync(t('Delete this news post?'), t('It disappears for everyone, with its comments.'), t('Delete')))) return;
    const { error } = await supabase.from('news_posts').delete().eq('id', id);
    if (error) return notify(t('Could not delete'), error.message);
    router.back();
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <EmptyState icon="newspaper-outline" title={t('This post no longer exists.')} />;

  const mine = post.author?.id === uid;
  const authorBlocked = !mine && !!post.author?.id && blockedIds.has(post.author.id);
  const visibleComments = comments.filter((c) => !c.author?.id || c.author.id === uid || !blockedIds.has(c.author.id));
  const hiddenCount = comments.length - visibleComments.length;

  if (authorBlocked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <EmptyState
          icon="ban-outline"
          title={t('You blocked this author')}
          text={t('Their posts are hidden. You can unblock them from their profile.')}
          action={t('Open profile')}
          onAction={() => router.push(`/user/${post.author.id}`)}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={visibleComments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <View style={styles.postCard}>
              <TouchableOpacity style={styles.head} onPress={() => post.author?.id && router.push(`/user/${post.author.id}`)}>
                <Avatar name={post.author?.full_name} id={post.author?.id} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.author} numberOfLines={1}>{post.author?.full_name ?? t('Organizer')}</Text>
                  <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
                </View>
                {mine ? (
                  <TouchableOpacity onPress={removePost} hitSlop={HIT} accessibilityLabel={t('Delete post')}>
                    <Ionicons name="trash-outline" size={19} color={colors.muted} />
                  </TouchableOpacity>
                ) : (
                  <ReportButton
                    onPress={() => safety.open({ type: 'news', id: post.id, userId: post.author?.id, name: post.author?.full_name })}
                  />
                )}
              </TouchableOpacity>

              {post.image_url ? <Image source={{ uri: post.image_url }} style={styles.image} resizeMode="cover" /> : null}

              <Text style={styles.body}>{post.body}</Text>

              <View style={styles.actions}>
                <TouchableOpacity
                  onPress={toggleLike}
                  hitSlop={HIT}
                  style={styles.actionBtn}
                  accessibilityRole="button"
                  accessibilityLabel={liked ? t('Unlike') : t('Like')}
                  accessibilityState={{ selected: liked }}
                >
                  <Ionicons name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? colors.danger : colors.body} />
                  <Text style={[styles.action, liked && { color: colors.danger }]}>{likes.length}</Text>
                </TouchableOpacity>
                <View style={styles.actionBtn}>
                  <Ionicons name="chatbubble-outline" size={19} color={colors.body} />
                  <Text style={styles.action}>{visibleComments.length}</Text>
                </View>
              </View>
            </View>

            <Text style={styles.commentsTitle}>{t('Comments')}</Text>
            {visibleComments.length === 0 && hiddenCount === 0 && <Text style={styles.noComments}>{t('No comments yet. Be the first.')}</Text>}
            {hiddenCount > 0 && (
              <Text style={styles.noComments}>
                {hiddenCount === 1
                  ? t('1 comment from people you blocked is hidden.')
                  : t('{n} comments from people you blocked are hidden.', { n: hiddenCount })}
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.comment}>
            <TouchableOpacity onPress={() => item.author?.id && router.push(`/user/${item.author.id}`)}>
              <Avatar name={item.author?.full_name} id={item.author?.id} size={32} />
            </TouchableOpacity>
            <View style={styles.bubble}>
              <Text style={styles.commentAuthor}>{item.author?.full_name ?? t('User')}</Text>
              <Text style={styles.commentBody}>{item.body}</Text>
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </View>
            {(item.author?.id === uid || mine) && (
              <TouchableOpacity onPress={() => removeComment(item)} hitSlop={HIT} accessibilityLabel={t('Delete comment')} style={styles.iconHit}>
                <Ionicons name="close" size={16} color={colors.muted} />
              </TouchableOpacity>
            )}
            {item.author?.id !== uid && (
              <TouchableOpacity
                onPress={() => safety.open({ type: 'comment', id: item.id, userId: item.author?.id, name: item.author?.full_name })}
                hitSlop={HIT}
                accessibilityLabel={t('Report comment')}
                style={styles.iconHit}
              >
                <Ionicons name="flag-outline" size={14} color={colors.muted} />
              </TouchableOpacity>
            )}
          </View>
        )}
      />
      <View style={styles.inputBar}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={t('Add a comment…')}
            placeholderTextColor={colors.faint}
            onSubmitEditing={addComment}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.send, (sending || !text.trim()) && { opacity: 0.5 }]}
            onPress={addComment}
            disabled={sending}
            accessibilityRole="button"
            accessibilityLabel={sending ? t('Posting…') : t('Post')}
          >
            {sending ? <ActivityIndicator size="small" color={colors.onBrand} /> : <Ionicons name="arrow-up" size={20} color={colors.onBrand} />}
          </TouchableOpacity>
        </View>
      </View>
      {safety.sheet}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 24, width: '100%', maxWidth: 680, alignSelf: 'center' },
  postCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    overflow: 'hidden', ...shadow.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  author: { ...type.title, fontSize: 15 },
  time: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  image: { width: '100%', height: 300, backgroundColor: colors.line },
  body: { ...type.body, color: colors.ink, paddingHorizontal: 16, paddingVertical: 14 },
  actions: { flexDirection: 'row', gap: 20, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.line },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  action: { fontSize: 14, color: colors.body, fontWeight: '700' },
  commentsTitle: { ...type.caption, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 22, marginBottom: 8 },
  noComments: { fontSize: 13.5, color: colors.muted, paddingVertical: 8 },
  comment: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  bubble: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 12,
  },
  commentAuthor: { fontSize: 13, fontWeight: '700', color: colors.ink },
  commentBody: { fontSize: 14, color: colors.body, lineHeight: 20, marginTop: 2 },
  iconHit: { paddingTop: 10, paddingHorizontal: 2 },
  inputBar: { backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line },
  inputRow: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center', width: '100%', maxWidth: 680, alignSelf: 'center' },
  input: {
    flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill,
    paddingVertical: 11, paddingHorizontal: 16, fontSize: 14, color: colors.ink, outlineStyle: 'none',
  },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});

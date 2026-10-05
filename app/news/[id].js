import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, Image, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import { notify, confirmAsync } from '../../lib/notify';
import { timeAgo } from '../../lib/news';
import { useReportSheet, useBlockedIds, ReportButton } from '../../lib/moderation';

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
      notify('Could not update your like', error.message);
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
    if (error) return notify('Could not comment', error.message);
    // Only clear if they haven't started typing something new meanwhile.
    setText((cur) => (cur.trim() === body ? '' : cur));
    load();
  }

  async function removeComment(c) {
    if (!(await confirmAsync('Delete comment?', '', 'Delete'))) return;
    setComments((prev) => prev.filter((x) => x.id !== c.id));
    const { error } = await supabase.from('news_comments').delete().eq('id', c.id);
    if (error) { notify('Could not delete', error.message); load(); }
  }

  async function removePost() {
    if (!(await confirmAsync('Delete this news post?', 'It disappears for everyone, with its comments.', 'Delete'))) return;
    const { error } = await supabase.from('news_posts').delete().eq('id', id);
    if (error) return notify('Could not delete', error.message);
    router.back();
  }

  if (loading) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;
  if (!post) return <Text style={styles.empty}>This post no longer exists.</Text>;

  const mine = post.author?.id === uid;
  const authorBlocked = !mine && !!post.author?.id && blockedIds.has(post.author.id);
  const visibleComments = comments.filter((c) => !c.author?.id || c.author.id === uid || !blockedIds.has(c.author.id));
  const hiddenCount = comments.length - visibleComments.length;

  if (authorBlocked) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 30 }}>🚫</Text>
        <Text style={styles.blockedTitle}>You blocked this author</Text>
        <Text style={styles.blockedSub}>Their posts are hidden. You can unblock them from their profile.</Text>
        <TouchableOpacity onPress={() => router.push(`/user/${post.author.id}`)} style={{ marginTop: 14 }}>
          <Text style={{ color: colors.brand, fontWeight: '800' }}>Open profile</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={visibleComments}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingBottom: 20 }}
        ListHeaderComponent={
          <View>
            <TouchableOpacity style={styles.head} onPress={() => post.author?.id && router.push(`/user/${post.author.id}`)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(post.author?.full_name ?? '?')[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.author}>{post.author?.full_name ?? 'Organizer'}</Text>
                <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
              </View>
              {mine ? (
                <TouchableOpacity onPress={removePost} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ fontSize: 16 }}>🗑️</Text>
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
              <TouchableOpacity onPress={toggleLike} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={[styles.action, liked && { color: colors.danger }]}>{liked ? '❤️' : '🤍'} {likes.length}</Text>
              </TouchableOpacity>
              <Text style={styles.action}>💬 {visibleComments.length}</Text>
            </View>

            <Text style={styles.commentsTitle}>Comments</Text>
            {visibleComments.length === 0 && hiddenCount === 0 && <Text style={styles.noComments}>No comments yet — be the first.</Text>}
            {hiddenCount > 0 && (
              <Text style={styles.noComments}>{hiddenCount} comment{hiddenCount === 1 ? '' : 's'} from people you blocked {hiddenCount === 1 ? 'is' : 'are'} hidden.</Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.comment}>
            <TouchableOpacity onPress={() => item.author?.id && router.push(`/user/${item.author.id}`)}>
              <View style={styles.avatarSm}><Text style={styles.avatarSmText}>{(item.author?.full_name ?? '?')[0]}</Text></View>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.commentBody}>
                <Text style={styles.commentAuthor}>{item.author?.full_name ?? 'User'} </Text>
                {item.body}
              </Text>
              <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
            </View>
            {(item.author?.id === uid || mine) && (
              <TouchableOpacity onPress={() => removeComment(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ fontSize: 13, color: colors.muted }}>✕</Text>
              </TouchableOpacity>
            )}
            {item.author?.id !== uid && (
              <TouchableOpacity
                onPress={() => safety.open({ type: 'comment', id: item.id, userId: item.author?.id, name: item.author?.full_name })}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel="Report comment"
              >
                <Text style={{ fontSize: 13, color: colors.muted }}>⚑</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Add a comment…"
          placeholderTextColor={colors.muted}
          onSubmitEditing={addComment}
          blurOnSubmit={false}
        />
        <TouchableOpacity style={[styles.post, sending && { opacity: 0.5 }]} onPress={addComment} disabled={sending}>
          <Text style={styles.postText}>{sending ? 'Posting…' : 'Post'}</Text>
        </TouchableOpacity>
      </View>
      {safety.sheet}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 16 },
  author: { fontSize: 15, fontWeight: '700', color: colors.ink },
  time: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  image: { width: '100%', height: 300, backgroundColor: colors.card },
  body: { fontSize: 15, color: colors.ink, lineHeight: 22, padding: 16, backgroundColor: colors.card },
  actions: { flexDirection: 'row', gap: 18, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  action: { fontSize: 15, color: colors.ink, fontWeight: '700' },
  commentsTitle: { fontSize: 13, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  noComments: { fontSize: 13.5, color: colors.muted, paddingHorizontal: 16, paddingVertical: 10 },
  comment: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 16, paddingVertical: 8 },
  avatarSm: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarSmText: { color: colors.brand, fontWeight: '800', fontSize: 13 },
  commentAuthor: { fontWeight: '800', color: colors.ink },
  commentBody: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  inputRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line, alignItems: 'center' },
  input: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: 16, fontSize: 14, color: colors.ink },
  post: { paddingHorizontal: 14, paddingVertical: 10 },
  postText: { color: colors.brand, fontWeight: '800', fontSize: 14 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 60 },
  blockedTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginTop: 10 },
  blockedSub: { fontSize: 13.5, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 },
});

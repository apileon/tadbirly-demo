import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, Keyboard, LayoutAnimation, UIManager,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import { confirmAsync, notify } from '../../lib/notify';
import { useReportSheet, useBlockedIds, ReportButton } from '../../lib/moderation';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// The database rejects longer messages (supabase/23, B15).
const MAX_MESSAGE = 4000;

// Group chat for one event: the organizer + everyone accepted.
export default function EventChat() {
  const { postId } = useLocalSearchParams();
  const { session } = useAuth();
  const router = useRouter();
  const uid = session?.user?.id;
  const [post, setPost] = useState(null);
  const [members, setMembers] = useState(0);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [denied, setDenied] = useState(false);
  const listRef = useRef(null);
  // Report: header ⚑ (the chat) or long-press someone's message. Messages from
  // people I blocked are hidden on this device.
  const safety = useReportSheet();
  const blockedIds = useBlockedIds();

  const load = useCallback(async () => {
    const { data: ok } = await supabase.rpc('can_access_event_chat', { p: postId });
    if (ok === false) { setDenied(true); return; }
    const { data: p } = await supabase.from('posts').select('title, author_id, status').eq('id', postId).single();
    setPost(p);
    const { count } = await supabase.from('applications').select('*', { count: 'exact', head: true }).eq('post_id', postId).eq('status', 'accepted');
    setMembers((count ?? 0) + 1); // + organizer
    const { data, error } = await supabase
      .from('event_messages')
      .select('*, sender:profiles!event_messages_sender_id_fkey(full_name)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) setDenied(true);
    setMessages(data ?? []);
  }, [postId]);

  useEffect(() => {
    load();
    // A fresh name for every subscription: supabase.channel(name) returns the
    // EXISTING channel for a name it already has, and adding postgres_changes
    // listeners to a subscribed one throws — blanking the whole app when this
    // screen is mounted twice.
    const channel = supabase
      .channel(`event-chat:${postId}:${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'event_messages', filter: `post_id=eq.${postId}` },
        (payload) => {
          // Only refetch when it's somebody else's message — ours is already on screen.
          if (payload.new?.sender_id === uid) return;
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          load();
        })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'event_messages' },
        (payload) => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setMessages((prev) => prev.filter((m) => m.id !== payload.old?.id));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [postId, load, uid]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const s = Keyboard.addListener(showEvt, () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    });
    return () => s.remove();
  }, []);

  async function send() {
    const body = text.trim();
    if (!body) return; // whitespace-only never goes out (the server refuses it anyway)
    if (body.length > MAX_MESSAGE) return notify('Message too long', `Please keep it under ${MAX_MESSAGE} characters.`);
    setText('');
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    setMessages((prev) => [...prev, { id: tempId, post_id: postId, sender_id: uid, body, created_at: new Date().toISOString(), pending: true }]);

    const { data, error } = await supabase
      .from('event_messages')
      .insert({ post_id: postId, sender_id: uid, body })
      .select('*, sender:profiles!event_messages_sender_id_fkey(full_name)')
      .single();

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(body);
      return notify('Could not send', error.message.includes('policy')
        ? 'Only the organizer and accepted participants can write here.'
        : error.message);
    }
    setMessages((prev) => {
      const rest = prev.filter((m) => m.id !== tempId);
      return rest.some((m) => m.id === data.id) ? rest : [...rest, data];
    });
  }

  async function remove(m) {
    if (m.sender_id !== uid) return;
    if (!(await confirmAsync('Delete message?', 'This removes it for everyone.', 'Delete'))) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    const { error } = await supabase.from('event_messages').delete().eq('id', m.id);
    if (error) { notify('Could not delete', error.message); load(); }
  }

  function reportMessage(m) {
    safety.open({ type: 'event_message', id: m.id, userId: m.sender_id, name: m.sender?.full_name ?? 'this member', label: 'message' });
  }

  if (denied) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 30 }}>🔒</Text>
        <Text style={styles.deniedTitle}>Accepted participants only</Text>
        <Text style={styles.deniedSub}>This chat opens once the organizer accepts your application.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={{ color: colors.brand, fontWeight: '700' }}>‹ Back</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={[styles.top, styles.topRow]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>🎪 {post?.title ?? 'Event chat'}</Text>
          <Text style={styles.sub}>{members} member{members === 1 ? '' : 's'} · organizer + accepted participants{post?.status === 'completed' ? ' · 🏁 finished' : ''}</Text>
        </View>
        <ReportButton
          onPress={() => safety.open({
            type: 'event', id: postId, postId,
            userId: post?.author_id && post.author_id !== uid ? post.author_id : null,
            name: 'the organizer', label: 'event chat',
          })}
        />
      </View>
      <FlatList
        ref={listRef}
        data={messages.filter((m) => m.sender_id === uid || !blockedIds.has(m.sender_id))}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet. Say hi to the group 👋</Text>}
        renderItem={({ item }) => {
          const mine = item.sender_id === uid;
          const isOrg = item.sender_id === post?.author_id;
          return (
            <View style={[styles.wrap, mine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
              {!mine && (
                <Text style={styles.sender}>{item.sender?.full_name ?? 'Member'}{isOrg ? ' · organizer' : ''}</Text>
              )}
              <TouchableOpacity
                activeOpacity={mine ? 0.7 : 1}
                onLongPress={() => (mine ? remove(item) : reportMessage(item))}
                delayLongPress={350}
                style={[styles.bubble, mine ? styles.mine : isOrg ? styles.org : styles.theirs]}
              >
                <Text style={[styles.body, mine && { color: '#fff' }]}>{item.body}</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message the group…"
          placeholderTextColor={colors.muted}
          maxLength={MAX_MESSAGE}
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={send}>
          <Ionicons name="send" color="#fff" size={18} />
        </TouchableOpacity>
      </View>
      {safety.sheet}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  top: { backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 15, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  wrap: { marginBottom: 10 },
  sender: { fontSize: 11, color: colors.muted, fontWeight: '700', marginBottom: 3, marginLeft: 6 },
  bubble: { maxWidth: '80%', paddingVertical: 10, paddingHorizontal: 13, borderRadius: 16 },
  mine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  theirs: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  org: { backgroundColor: colors.warnSoft, borderWidth: 1, borderColor: '#e6d9a6', borderBottomLeftRadius: 4 },
  body: { fontSize: 14, lineHeight: 20, color: colors.ink },
  inputRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line },
  input: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: 16, fontSize: 14, color: colors.ink },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, lineHeight: 20 },
  deniedTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginTop: 10 },
  deniedSub: { fontSize: 13.5, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 20 },
});

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView,
  Platform, Keyboard, LayoutAnimation, UIManager, Animated, AppState,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius, type } from '../../lib/theme';
import { Avatar, Button, IconButton, EmptyState } from '../../components/ui';
import { sharedStreak } from '../../lib/social';
import { confirmAsync, notify } from '../../lib/notify';
import { useReportSheet } from '../../lib/moderation';
import { t, dateLocale } from '../../lib/i18n';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// The database rejects longer messages (supabase/23, B15).
const MAX_MESSAGE = 4000;

// Presence heartbeat while you're looking at the chat. The server treats a
// heartbeat younger than 20 s as "they can see it" and skips the push, so 8 s
// leaves room for one lost beat.
const HEARTBEAT_MS = 8000;

const fire = (fn, c) => { supabase.rpc(fn, { c }).then(() => {}, () => {}); };

// Leaving goes out as a keepalive request when possible. The regular client's
// request is cancelled when the page is closed or frozen, and then the server
// would think you're still reading for another 20 s — and swallow the push.
function leavePresence(chatId, token) {
  const viaClient = () => fire('leave_chat_presence', chatId);
  const restUrl = supabase.rest?.url;
  const key = supabase.supabaseKey;
  if (Platform.OS !== 'web' || !token || !restUrl || !key || typeof fetch !== 'function') {
    viaClient();
    return;
  }
  try {
    fetch(`${restUrl}/rpc/leave_chat_presence`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ c: chatId }),
    }).then((r) => { if (!r.ok) viaClient(); }, viaClient); // e.g. expired token: the client refreshes it
  } catch {
    viaClient();
  }
}

// ---------------------------------------------------------------------------
//  "typing…" channels, shared by every mounted copy of the same chat.
//  Both phones must use exactly `typing:<chat id>`, and one browser can hold
//  only one channel per topic: supabase.channel() hands back the existing one,
//  and the server keeps a single join per topic. So copies of the same chat
//  (Chat → Profile → Message used to stack a second one) share a channel, and
//  it's removed only when the last copy closes — one copy leaving must not cut
//  the other off.
// ---------------------------------------------------------------------------
const typingHubs = new Map();    // topic -> { ch, listeners }
const typingClosing = new Map(); // topic -> removal still in flight

function joinTyping(topic, listener) {
  let hub = typingHubs.get(topic);
  if (!hub) {
    const created = { ch: null, listeners: new Set() };
    hub = created;
    typingHubs.set(topic, created);
    // A removal still in flight would hand back the dying channel — wait it out.
    Promise.resolve(typingClosing.get(topic)).then(() => {
      if (typingHubs.get(topic) !== created) return; // everyone left meanwhile
      created.ch = supabase
        .channel(topic, { config: { broadcast: { self: false } } })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          created.listeners.forEach((fn) => fn(payload));
        })
        .subscribe();
    });
  }
  hub.listeners.add(listener);

  let left = false;
  return {
    send(payload) {
      // Only over the open socket: before the join completes, send() falls back
      // to a REST call (plus a console warning) for every keystroke.
      if (!hub.ch || hub.ch.state !== 'joined') return;
      Promise.resolve(hub.ch.send({ type: 'broadcast', event: 'typing', payload })).catch(() => {});
    },
    leave() {
      if (left) return;
      left = true;
      hub.listeners.delete(listener);
      if (hub.listeners.size > 0 || typingHubs.get(topic) !== hub) return;
      typingHubs.delete(topic);
      const ch = hub.ch;
      hub.ch = null;
      if (!ch) return;
      const closing = supabase.removeChannel(ch).catch(() => {}).finally(() => {
        if (typingClosing.get(topic) === closing) typingClosing.delete(topic);
      });
      typingClosing.set(topic, closing);
    },
  };
}

// Whether the person can actually see this screen right now: on web the tab
// must be visible AND the window focused; natively the app must be active
// ('unknown' only shows up for a moment at launch, when the app is in front).
function inFront() {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible'
      && (typeof document.hasFocus !== 'function' || document.hasFocus());
  }
  const s = AppState.currentState;
  return s === 'active' || s === 'unknown' || s == null;
}

// Only friendlier words for the server's refusals; the rules live in supabase/23.
function sendError(error) {
  const msg = error?.message || '';
  if (/row-level security|violates .*policy/i.test(msg)) return t('You can’t message this person right now.');
  return msg || t('Please try again.');
}

export default function ChatRoom() {
  const { id } = useLocalSearchParams();
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [header, setHeader] = useState({ name: '', streak: 0, otherId: null, avatar: null });
  const router = useRouter();
  // Header flag button: report this conversation and/or block the other person.
  // Blocking also stops new messages both ways (enforced by the database).
  const safety = useReportSheet({
    onBlocked: () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/chats'); },
  });
  const [theyType, setTheyType] = useState(false);
  const listRef = useRef(null);
  const lift = useRef(new Animated.Value(0)).current; // input bar lift on keyboard
  const typing = useRef(null);      // this screen's handle on the shared typing channel
  const typingTimer = useRef(null);
  const lastSent = useRef(0);
  // True only while this chat is the focused screen AND it's in front of the
  // person. Messages are marked read only then — a chat left open in a
  // background tab, or covered by another screen, must not eat unread badges.
  const lookingRef = useRef(false);
  // Read synchronously by leavePresence() while the page is being hidden.
  const tokenRef = useRef(null);
  tokenRef.current = session?.access_token ?? null;

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', id)
      .order('created_at', { ascending: true });
    setMessages(data ?? []);
    // Covers messages that landed before the realtime channel was up.
    if (lookingRef.current) fire('mark_chat_read', id);
  }, [id]);

  // Other member + shared-events streak.
  useEffect(() => {
    if (!uid) return;
    (async () => {
      const { data: chat } = await supabase
        .from('chats')
        .select('participant_id, organizer_id, participant:profiles!chats_participant_id_fkey(full_name, avatar_url), organizer:profiles!chats_organizer_id_fkey(full_name, avatar_url)')
        .eq('id', id).single();
      if (!chat) return;
      const iAmOrg = chat.organizer_id === uid;
      const otherId = iAmOrg ? chat.participant_id : chat.organizer_id;
      const otherP = iAmOrg ? chat.participant : chat.organizer;
      const name = otherP?.full_name ?? t('Chat');
      const { data: aw } = await supabase.from('awards').select('recipient_id, post_id').in('recipient_id', [uid, otherId]).eq('verified', true);
      const mine = (aw ?? []).filter((r) => r.recipient_id === uid).map((r) => r.post_id);
      const theirs = (aw ?? []).filter((r) => r.recipient_id === otherId).map((r) => r.post_id);
      setHeader({ name, streak: sharedStreak(mine, theirs), otherId, avatar: otherP?.avatar_url ?? null });
    })();
  }, [id, uid]);

  // Realtime: new + deleted messages appear/disappear instantly.
  useEffect(() => {
    load();
    // A fresh name for every subscription. supabase.channel(name) returns the
    // EXISTING channel for a name it already has, and adding postgres_changes
    // listeners to a subscribed (or still-leaving) channel throws — which
    // blanked the whole app when this chat was open twice at once.
    const channel = supabase
      .channel(`chat:${id}:${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${id}` },
        (payload) => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
          // Unread until they can actually see it; the focus effect below marks
          // it read the moment they come back.
          if (payload.new?.sender_id !== uid && lookingRef.current) fire('mark_chat_read', id);
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `chat_id=eq.${id}` },
        (payload) => setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m))))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' },
        (payload) => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setMessages((prev) => prev.filter((m) => m.id !== payload.old?.id));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, load, uid]);

  // Presence heartbeat + read receipts, only while you're really looking.
  // The server skips the push for a fresh heartbeat, so the heartbeat has to
  // stop the instant you can't see the chat: tab hidden, window blurred, app
  // in the background, page closed, or another screen pushed on top (which on
  // web keeps this one mounted, just hidden — hence focus, not mount).
  useFocusEffect(useCallback(() => {
    if (!uid || !id) return undefined;
    let timer = null;
    let disposed = false;

    const stopBeating = () => { clearInterval(timer); timer = null; };

    const update = () => {
      if (disposed) return;
      const now = inFront();
      if (now === lookingRef.current) return;
      lookingRef.current = now;
      if (now) {
        fire('touch_chat_presence', id);
        fire('mark_chat_read', id); // whatever arrived while they were away
        stopBeating();
        timer = setInterval(() => fire('touch_chat_presence', id), HEARTBEAT_MS);
      } else {
        stopBeating();
        leavePresence(id, tokenRef.current);
      }
    };

    // The page is going away (closed, navigated off, or frozen into the
    // back/forward cache) — leave now; 'pageshow' brings it back if restored.
    const onPageHide = () => {
      lookingRef.current = false;
      stopBeating();
      leavePresence(id, tokenRef.current);
    };

    update();

    let unlisten = () => {};
    if (Platform.OS === 'web') {
      // Natively `window` exists but has no addEventListener/document.
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && typeof document !== 'undefined') {
        // Some browsers still report the old document.hasFocus() while the
        // window focus/blur event is being dispatched — look again a tick later.
        const onFocusChange = () => setTimeout(update, 0);
        document.addEventListener('visibilitychange', update);
        window.addEventListener('focus', onFocusChange);
        window.addEventListener('blur', onFocusChange);
        window.addEventListener('pageshow', update);
        window.addEventListener('pagehide', onPageHide);
        unlisten = () => {
          document.removeEventListener('visibilitychange', update);
          window.removeEventListener('focus', onFocusChange);
          window.removeEventListener('blur', onFocusChange);
          window.removeEventListener('pageshow', update);
          window.removeEventListener('pagehide', onPageHide);
        };
      }
    } else {
      const sub = AppState.addEventListener('change', update);
      unlisten = () => sub?.remove?.();
    }

    // Runs on blur (another screen on top) and on unmount.
    return () => {
      disposed = true;
      unlisten();
      stopBeating();
      const wasLooking = lookingRef.current;
      lookingRef.current = false;
      if (wasLooking) leavePresence(id, tokenRef.current);
    };
  }, [id, uid]));

  // Smooth keyboard lift (native). On web the browser handles the keyboard itself.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      Animated.spring(lift, { toValue: 1, useNativeDriver: false, friction: 8 }).start();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    });
    const h = Keyboard.addListener(hideEvt, () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      Animated.spring(lift, { toValue: 0, useNativeDriver: false, friction: 8 }).start();
    });
    return () => { s.remove(); h.remove(); };
  }, [lift]);

  // Live "typing…" over a broadcast channel (nothing is stored).
  useEffect(() => {
    if (!uid || !id) return undefined;
    const handle = joinTyping(`typing:${id}`, (payload) => {
      if (!payload || payload.uid === uid) return;
      setTheyType(true);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTheyType(false), 2500);
    });
    typing.current = handle;
    return () => {
      clearTimeout(typingTimer.current);
      handle.leave();
      if (typing.current === handle) typing.current = null;
    };
  }, [id, uid]);

  function onType(value) {
    setText(value);
    const now = Date.now();
    if (typing.current && value && now - lastSent.current > 1200) {
      lastSent.current = now;
      typing.current.send({ uid });
    }
  }

  // Optimistic send: the bubble appears instantly, then reconciles with the server.
  async function send() {
    const body = text.trim();
    if (!body) return; // whitespace-only never goes out (the server refuses it anyway)
    if (body.length > MAX_MESSAGE) return notify(t('Message too long'), t('Please keep it under {n} characters.', { n: MAX_MESSAGE }));
    setText('');
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const optimistic = { id: tempId, chat_id: id, sender_id: uid, body, created_at: new Date().toISOString(), pending: true };
    setMessages((prev) => [...prev, optimistic]);

    const { data, error } = await supabase
      .from('messages')
      .insert({ chat_id: id, sender_id: uid, body })
      .select()
      .single();

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setText(body);
      return notify(t('Could not send'), sendError(error));
    }
    setMessages((prev) => {
      const rest = prev.filter((m) => m.id !== tempId);
      return rest.some((m) => m.id === data.id) ? rest : [...rest, data];
    });
  }

  async function remove(m) {
    if (m.sender_id !== uid) return;
    if (!(await confirmAsync(t('Delete message?'), t('This removes it for both of you.'), t('Delete')))) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    const { error } = await supabase.from('messages').delete().eq('id', m.id);
    if (error) { notify(t('Could not delete'), error.message); load(); }
  }

  // fromChat lets their profile's "Message" button come back here instead of
  // stacking a second copy of this same chat on top.
  function openProfile() {
    if (header.otherId) router.push(`/user/${header.otherId}?fromChat=${id}`);
  }

  const barStyle = { transform: [{ scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.01] }) }] };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.streakBar}>
        <TouchableOpacity
          style={styles.who}
          onPress={openProfile}
          disabled={!header.otherId}
        >
          <Avatar uri={header.avatar} name={header.name} id={header.otherId} size={34} />
          <View>
            <Text style={styles.streakName}>{header.name}</Text>
            <View style={styles.streakRow}>
              <Ionicons name="flame-outline" size={13} color={colors.warn} />
              <Text style={styles.streakFire}>
                {header.streak === 1 ? t('1 event together') : t('{n} events together', { n: header.streak })}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
        <Button
          title={t('Profile')}
          icon="person-outline"
          variant="soft"
          size="sm"
          onPress={openProfile}
          disabled={!header.otherId}
        />
        <IconButton
          icon="flag-outline"
          size={36}
          color={colors.muted}
          label={t('Report or block')}
          style={{ marginLeft: 8 }}
          onPress={() => header.otherId && safety.open({ type: 'chat', id, userId: header.otherId, name: header.name })}
        />
      </View>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<EmptyState icon="hand-left-outline" title={t('Say hello')} />}
        renderItem={({ item, index }) => {
          const mine = item.sender_id === uid;
          const prev = messages[index - 1];
          const next = messages[index + 1];
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(item.created_at);
          const startsGroup = newDay || !prev || prev.sender_id !== item.sender_id;
          const endsGroup = !next || next.sender_id !== item.sender_id || dayKey(next.created_at) !== dayKey(item.created_at);

          return (
            <View>
              {newDay && (
                <View style={styles.dayRow}>
                  <View style={styles.dayLine} />
                  <Text style={styles.dayText}>{dayLabel(item.created_at)}</Text>
                  <View style={styles.dayLine} />
                </View>
              )}
              <TouchableOpacity
                activeOpacity={mine ? 0.7 : 1}
                onLongPress={() => remove(item)}
                delayLongPress={350}
                style={[
                  styles.bubble,
                  mine ? styles.mine : styles.theirs,
                  !startsGroup && (mine ? { borderTopRightRadius: 6 } : { borderTopLeftRadius: 6 }),
                  !endsGroup && { marginBottom: 2, ...(mine ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }) },
                ]}
              >
                <Text style={[styles.body, mine && { color: colors.onBrand }]}>{item.body}</Text>
                {endsGroup && (
                  <View style={styles.stampRow}>
                    <Text style={[styles.stamp, mine ? styles.stampMine : styles.stampTheirs]}>
                      {clock(item.created_at)}
                    </Text>
                    {mine ? (
                      <Ionicons
                        name={item.pending ? 'time-outline' : item.read_at ? 'checkmark-done' : 'checkmark'}
                        size={13}
                        color={STAMP_MINE}
                        accessibilityLabel={item.pending ? t('Sending') : item.read_at ? t('Read') : t('Sent')}
                      />
                    ) : null}
                  </View>
                )}
              </TouchableOpacity>
            </View>
          );
        }}
      />
      {theyType && (
        <View style={styles.typingRow}>
          <View style={styles.typingBubble}>
            <Text style={styles.typingText}>{header.name ? t('{name} is typing…', { name: header.name }) : t('Typing…')}</Text>
          </View>
        </View>
      )}
      <Animated.View style={[styles.inputRow, barStyle]}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onType}
          placeholder={t('Message…')}
          placeholderTextColor={colors.faint}
          maxLength={MAX_MESSAGE}
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <TouchableOpacity style={styles.sendBtn} onPress={send} accessibilityRole="button" accessibilityLabel={t('Send')}>
          <Ionicons name="send" color={colors.onBrand} size={18} />
        </TouchableOpacity>
      </Animated.View>
      {safety.sheet}
    </KeyboardAvoidingView>
  );
}

const dayKey = (iso) => new Date(iso).toDateString();
const clock = (iso) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('Today');
  if (d.toDateString() === yest.toDateString()) return t('Yesterday');
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' });
}

// Time stamps and ticks on my own (brand-coloured) bubbles.
const STAMP_MINE = 'rgba(255,255,255,0.7)';

const styles = StyleSheet.create({
  list: { padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 },
  dayLine: { flex: 1, height: 1, backgroundColor: colors.line },
  dayText: { ...type.caption },
  stampRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, alignSelf: 'flex-end' },
  stamp: { fontSize: 10 },
  stampMine: { color: STAMP_MINE },
  stampTheirs: { color: colors.muted },
  streakBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  who: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  streakName: { fontSize: 15, fontWeight: '800', color: colors.ink },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  streakFire: { fontSize: 12.5, fontWeight: '700', color: colors.warn },
  bubble: { maxWidth: '78%', paddingVertical: 10, paddingHorizontal: 13, borderRadius: radius.lg, marginBottom: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 4 },
  body: { fontSize: 14, lineHeight: 20, color: colors.ink },
  typingRow: { paddingHorizontal: 16, paddingBottom: 6 },
  typingBubble: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, borderBottomLeftRadius: 4, paddingVertical: 8, paddingHorizontal: 13 },
  typingText: { fontSize: 12.5, color: colors.muted, fontStyle: 'italic' },
  inputRow: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line },
  input: { flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: 16, fontSize: 14, color: colors.ink },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});

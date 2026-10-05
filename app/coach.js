import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/auth';
import { colors, radius, typeMeta } from '../lib/theme';
import { askCoach, getCoachPlan, getCoachStatus, coachErrorText, COACH_MAX_QUESTION } from '../lib/coach';

// Real AI coach: every answer comes from Claude via the `career-coach` edge
// function, using only the student's own academic data + open events.

const STARTERS = [
  'Which events should I join to strengthen my university application?',
  'How can I prepare for IELTS while at school?',
  'Qaysi tadbirlar menga ko‘proq foyda beradi?',
  'Как подготовиться к поступлению за границу?',
];

let nextId = 1;
const newId = () => `m${nextId++}`;

export default function Coach() {
  const router = useRouter();
  const { session } = useAuth();
  const scrollRef = useRef(null);

  const [messages, setMessages] = useState([]); // {id, role:'user'|'assistant'|'error', content, events?, retry?}
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState(null); // {used, cap}
  const [blocked, setBlocked] = useState(null); // 'not_configured' | 'daily_limit' | 'global_limit'

  // Free probe: show "Coach is coming soon" straight away if not set up yet.
  useEffect(() => {
    if (!session) return undefined;
    let alive = true;
    getCoachStatus().then((res) => {
      if (alive && !res.ok && res.code === 'not_configured') setBlocked('not_configured');
    });
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages, busy]);

  const run = useCallback(async (kind, question) => {
    if (busy || !session) return;
    // History = everything already on screen except error bubbles.
    const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    if (kind === 'chat') {
      setMessages((prev) => [...prev.filter((m) => m.role !== 'error'), { id: newId(), role: 'user', content: question }]);
      setInput('');
    } else {
      setMessages((prev) => [...prev.filter((m) => m.role !== 'error'), { id: newId(), role: 'user', content: '📋 Make my personalised 3-step plan', isPlan: true }]);
    }
    setBusy(true);
    const res = kind === 'plan' ? await getCoachPlan(history) : await askCoach(question, history);
    setBusy(false);

    if (res.ok) {
      if (res.used != null && res.cap != null) setUsage({ used: res.used, cap: res.cap });
      setMessages((prev) => [...prev, { id: newId(), role: 'assistant', content: res.reply, events: res.events }]);
      return;
    }
    if (res.code === 'not_configured' || res.code === 'daily_limit' || res.code === 'global_limit') {
      setBlocked(res.code);
      if (res.code === 'daily_limit' && res.cap) setUsage({ used: res.cap, cap: res.cap });
    }
    const canRetry = !['not_configured', 'daily_limit', 'global_limit', 'unauthorized', 'bad_request'].includes(res.code);
    if (res.code === 'not_configured') {
      setMessages((prev) => prev.slice(0, -1));
      if (kind === 'chat') setInput(question);
      return;
    }
    setMessages((prev) => {
      // Drop the question bubble we just added so a retry doesn't duplicate it.
      const withoutLast = prev.slice(0, -1);
      return [
        ...withoutLast,
        {
          id: newId(),
          role: 'error',
          content: coachErrorText(res),
          retry: canRetry ? { kind, question } : null,
          draft: kind === 'chat' ? question : null,
        },
      ];
    });
    if (kind === 'chat' && !canRetry) setInput(question);
  }, [busy, session, messages]);

  const send = () => {
    const q = input.trim();
    if (!q || busy || blocked) return;
    run('chat', q.slice(0, COACH_MAX_QUESTION));
  };

  if (!session) {
    return (
      <View style={[styles.wrap, { padding: 18 }]}>
        <Text style={styles.empty}>Sign in to use the AI Career Coach.</Text>
      </View>
    );
  }

  const disabled = busy || !!blocked;
  const left = usage ? Math.max(usage.cap - usage.used, 0) : null;

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>🧭 AI Career Coach</Text>
          <Text style={styles.heroBody}>
            Ask about universities, IELTS/SAT, Milliy Sertifikat, skills or which Tadbirly events to join.
            English, O‘zbekcha or Русский.
          </Text>
          <Text style={styles.disclosure}>Answers are generated by AI (Claude) and can be wrong.</Text>
          {left != null && <Text style={styles.quota}>{left} of {usage.cap} answers left today</Text>}
        </View>

        {blocked === 'not_configured' && (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Coach is coming soon</Text>
            <Text style={styles.bannerBody}>We're finishing the setup. Check back shortly!</Text>
          </View>
        )}

        {messages.length === 0 && !blocked && (
          <View style={{ marginTop: 16 }}>
            <TouchableOpacity style={styles.planBig} onPress={() => run('plan')} activeOpacity={0.85} disabled={disabled}>
              <Text style={styles.planBigTitle}>📋 Get my plan</Text>
              <Text style={styles.planBigBody}>A personalised 3-step plan from your profile, events and awards.</Text>
            </TouchableOpacity>
            <Text style={styles.h2}>Or ask something</Text>
            {STARTERS.map((q) => (
              <TouchableOpacity key={q} style={styles.starter} onPress={() => run('chat', q)} disabled={disabled} activeOpacity={0.8}>
                <Text style={styles.starterText}>{q}</Text>
              </TouchableOpacity>
            ))}
            <Text style={styles.privacy}>
              The coach sees your studies, skills, scores, honors and Tadbirly events — not your name or contacts.
              Please don't share phone numbers, emails or addresses in the chat.
            </Text>
          </View>
        )}

        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <View key={m.id} style={[styles.bubble, styles.mine]}>
                <Text style={styles.mineText}>{m.content}</Text>
              </View>
            );
          }
          if (m.role === 'error') {
            return (
              <View key={m.id} style={styles.errorBox}>
                <Text style={styles.errorText}>{m.content}</Text>
                {m.retry && (
                  <TouchableOpacity onPress={() => run(m.retry.kind, m.retry.question)} disabled={busy}>
                    <Text style={styles.retry}>↻ Try again</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }
          return (
            <View key={m.id} style={{ marginBottom: 10 }}>
              <View style={[styles.bubble, styles.theirs]}>
                <Text style={styles.theirsText} selectable>{m.content}</Text>
              </View>
              {(m.events ?? []).map((e) => (
                <TouchableOpacity key={e.id} style={styles.eventCard} onPress={() => router.push(`/post/${e.id}`)} activeOpacity={0.85}>
                  <Text style={styles.eventTitle} numberOfLines={2}>{typeMeta(e.category).emoji} {e.title}</Text>
                  <Text style={styles.eventMeta}>{[e.category, e.date].filter(Boolean).join(' · ')}  → View & apply</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
        })}

        {busy && <Typing />}
      </ScrollView>

      {blocked === 'daily_limit' || blocked === 'global_limit' ? (
        <View style={styles.limitBar}>
          <Text style={styles.limitText}>
            {blocked === 'daily_limit'
              ? `Daily limit reached (${usage?.cap ?? 10} answers). New answers tomorrow.`
              : 'The coach is very busy today. Please come back tomorrow.'}
          </Text>
        </View>
      ) : (
        <View style={styles.composer}>
          {messages.length > 0 && blocked !== 'not_configured' && (
            <TouchableOpacity style={styles.planChip} onPress={() => run('plan')} disabled={disabled} activeOpacity={0.85}>
              <Text style={[styles.planChipText, disabled && { opacity: 0.5 }]}>📋 Get my plan</Text>
            </TouchableOpacity>
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder={blocked === 'not_configured' ? 'Coach is coming soon' : 'Ask your coach…'}
              placeholderTextColor={colors.muted}
              multiline
              maxLength={COACH_MAX_QUESTION}
              editable={!blocked}
              onSubmitEditing={Platform.OS === 'web' ? send : undefined}
              blurOnSubmit={Platform.OS === 'web'}
              returnKeyType={Platform.OS === 'web' ? 'send' : 'default'}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || disabled) && { opacity: 0.45 }]}
              onPress={send}
              disabled={!input.trim() || disabled}
              accessibilityLabel="Send question"
            >
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendText}>↑</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Typing() {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];
  useEffect(() => {
    const useNativeDriver = Platform.OS !== 'web';
    const anims = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(v, { toValue: 1, duration: 320, useNativeDriver }),
          Animated.timing(v, { toValue: 0.3, duration: 320, useNativeDriver }),
          Animated.delay((2 - i) * 160),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={[styles.bubble, styles.theirs, styles.typing]} accessibilityLabel="Coach is typing">
      {dots.map((v, i) => <Animated.View key={i} style={[styles.dot, { opacity: v }]} />)}
      <Text style={styles.typingText}>Coach is thinking…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  hero: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: 16 },
  heroTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  heroBody: { color: 'rgba(255,255,255,0.85)', fontSize: 13.5, marginTop: 6, lineHeight: 19 },
  disclosure: { color: 'rgba(255,255,255,0.6)', fontSize: 11.5, marginTop: 8, fontStyle: 'italic' },
  quota: { color: '#bfe0c8', fontSize: 12, marginTop: 6, fontWeight: '700' },
  banner: { backgroundColor: colors.warnSoft, borderRadius: radius.md, padding: 14, marginTop: 14 },
  bannerTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  bannerBody: { color: colors.ink, fontSize: 13, marginTop: 4 },
  planBig: { backgroundColor: colors.brand, borderRadius: radius.md, padding: 16 },
  planBigTitle: { color: '#fff', fontWeight: '800', fontSize: 16 },
  planBigBody: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 4, lineHeight: 18 },
  h2: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  starter: { backgroundColor: colors.card, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 8, borderWidth: 1, borderColor: colors.line },
  starterText: { color: colors.ink, fontSize: 14 },
  privacy: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  bubble: { maxWidth: '88%', paddingVertical: 10, paddingHorizontal: 13, borderRadius: 16, marginTop: 10 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  mineText: { color: '#fff', fontSize: 14.5, lineHeight: 20 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.line },
  theirsText: { color: colors.ink, fontSize: 14.5, lineHeight: 21 },
  eventCard: { alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: 12, marginTop: 6 },
  eventTitle: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  eventMeta: { color: colors.brand, fontSize: 12, marginTop: 4, fontWeight: '600' },
  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: 12, marginTop: 10 },
  errorText: { color: colors.danger, fontSize: 13.5, lineHeight: 19 },
  retry: { color: colors.danger, fontWeight: '800', marginTop: 8 },
  typing: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted, marginRight: 4 },
  typingText: { color: colors.muted, fontSize: 12.5, marginLeft: 6 },
  composer: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 12, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 22 : 10 },
  planChip: { alignSelf: 'flex-start', backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 8 },
  planChipText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  input: {
    flex: 1, minHeight: 42, maxHeight: 120, backgroundColor: colors.bg, borderRadius: 20,
    paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 15, color: colors.ink,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  sendText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  limitBar: { backgroundColor: colors.warnSoft, padding: 14, paddingBottom: Platform.OS === 'ios' ? 24 : 14 },
  limitText: { color: colors.ink, fontSize: 13.5, textAlign: 'center', fontWeight: '600' },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 21 },
});

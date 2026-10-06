import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Animated, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/auth';
import { colors, radius, type, shadow, typeMeta } from '../lib/theme';
import { EmptyState, SectionHeader } from '../components/ui';
import { askCoach, getCoachPlan, getCoachStatus, coachErrorText, COACH_MAX_QUESTION } from '../lib/coach';
import { t } from '../lib/i18n';

// Real AI coach: every answer comes from Claude via the `career-coach` edge
// function, using only the student's own academic data + open events.

// The English starters are shown (and sent) in the reader's language; the
// Uzbek and Russian ones are there to show the coach speaks both.
const STARTERS = [
  { text: 'Which events should I join to strengthen my university application?', translate: true },
  { text: 'How can I prepare for IELTS while at school?', translate: true },
  { text: 'Qaysi tadbirlar menga ko‘proq foyda beradi?' },
  { text: 'Как подготовиться к поступлению за границу?' },
];

// lib/coach's messages, translatable (the two with numbers or server text
// in them are spelled out here so they can carry placeholders).
function coachError(res) {
  if (res?.code === 'daily_limit') return t("You've used all {n} coach answers for today. Come back tomorrow!", { n: res.cap ?? 10 });
  if (res?.code === 'bad_request') return res.message ? t("Couldn't send that: {reason}.", { reason: res.message }) : t("Couldn't send that question.");
  return t(coachErrorText(res));
}

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
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [messages, busy]);

  const run = useCallback(async (kind, question) => {
    if (busy || !session) return;
    // History = everything already on screen except error bubbles.
    const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    if (kind === 'chat') {
      setMessages((prev) => [...prev.filter((m) => m.role !== 'error'), { id: newId(), role: 'user', content: question }]);
      setInput('');
    } else {
      setMessages((prev) => [...prev.filter((m) => m.role !== 'error'), { id: newId(), role: 'user', content: t('Make my personalised 3-step plan'), isPlan: true }]);
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
          content: coachError(res),
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
      <View style={styles.wrap}>
        <EmptyState icon="compass-outline" title={t('Sign in to use the AI Career Coach.')} />
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
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={styles.heroHead}>
            <View style={styles.heroIcon}>
              <Ionicons name="compass-outline" size={22} color={colors.onBrand} />
            </View>
            <Text style={styles.heroTitle}>{t('AI Career Coach')}</Text>
          </View>
          <Text style={styles.heroBody}>
            {t('Ask about universities, IELTS/SAT, Milliy Sertifikat, skills or which Tadbirly events to join. English, O‘zbekcha or Русский.')}
          </Text>
          <Text style={styles.disclosure}>{t('Answers are generated by AI (Claude) and can be wrong.')}</Text>
          {left != null && (
            <View style={styles.quota}>
              <Ionicons name="chatbubbles-outline" size={13} color={colors.lime} />
              <Text style={styles.quotaText}>{t('{left} of {cap} answers left today', { left, cap: usage.cap })}</Text>
            </View>
          )}
        </View>

        {blocked === 'not_configured' && (
          <View style={styles.banner}>
            <Ionicons name="time-outline" size={20} color={colors.warn} />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>{t('Coach is coming soon')}</Text>
              <Text style={styles.bannerBody}>{t("We're finishing the setup. Check back shortly!")}</Text>
            </View>
          </View>
        )}

        {messages.length === 0 && !blocked && (
          <View style={{ marginTop: 16 }}>
            <TouchableOpacity style={[styles.planBig, disabled && { opacity: 0.6 }]} onPress={() => run('plan')} activeOpacity={0.85} disabled={disabled}>
              <View style={styles.planIcon}>
                <Ionicons name="list-outline" size={22} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.planBigTitle}>{t('Get my plan')}</Text>
                <Text style={styles.planBigBody}>{t('A personalised 3-step plan from your profile, events and awards.')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </TouchableOpacity>
            <SectionHeader title={t('Or ask something')} />
            {STARTERS.map((s) => {
              const q = s.translate ? t(s.text) : s.text;
              return (
                <TouchableOpacity key={s.text} style={styles.starter} onPress={() => run('chat', q)} disabled={disabled} activeOpacity={0.8}>
                  <Ionicons name="chatbubble-ellipses-outline" size={17} color={colors.brand} />
                  <Text style={styles.starterText}>{q}</Text>
                </TouchableOpacity>
              );
            })}
            <View style={styles.privacy}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.muted} />
              <Text style={styles.privacyText}>
                {t("The coach sees your studies, skills, scores, honors and Tadbirly events, not your name or contacts. Please don't share phone numbers, emails or addresses in the chat.")}
              </Text>
            </View>
          </View>
        )}

        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <View key={m.id} style={[styles.bubble, styles.mine]}>
                {m.isPlan ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="list-outline" size={16} color={colors.onBrand} />
                    <Text style={styles.mineText}>{m.content}</Text>
                  </View>
                ) : (
                  <Text style={styles.mineText}>{m.content}</Text>
                )}
              </View>
            );
          }
          if (m.role === 'error') {
            return (
              <View key={m.id} style={styles.errorBox}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
                  <Text style={[styles.errorText, { flex: 1 }]}>{m.content}</Text>
                </View>
                {m.retry && (
                  <TouchableOpacity onPress={() => run(m.retry.kind, m.retry.question)} disabled={busy} style={styles.retryBtn}>
                    <Ionicons name="refresh" size={15} color={colors.danger} />
                    <Text style={styles.retry}>{t('Try again')}</Text>
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
                  <View style={styles.eventIcon}>
                    <Ionicons name={typeMeta(e.category).icon} size={17} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle} numberOfLines={2}>{e.title}</Text>
                    <Text style={styles.eventMeta} numberOfLines={1}>{[e.category ? t(e.category) : null, e.date].filter(Boolean).join(' · ')}</Text>
                    <Text style={styles.eventCta}>{t('View and apply')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={17} color={colors.brand} />
                </TouchableOpacity>
              ))}
            </View>
          );
        })}

        {busy && <Typing />}
      </ScrollView>

      {blocked === 'daily_limit' || blocked === 'global_limit' ? (
        <View style={styles.limitBar}>
          <Ionicons name="time-outline" size={18} color={colors.warn} />
          <Text style={styles.limitText}>
            {blocked === 'daily_limit'
              ? t('Daily limit reached ({n} answers). New answers tomorrow.', { n: usage?.cap ?? 10 })
              : t('The coach is very busy today. Please come back tomorrow.')}
          </Text>
        </View>
      ) : (
        <View style={styles.composer}>
          <View style={styles.composerInner}>
            {messages.length > 0 && blocked !== 'not_configured' && (
              <TouchableOpacity style={[styles.planChip, disabled && { opacity: 0.5 }]} onPress={() => run('plan')} disabled={disabled} activeOpacity={0.85}>
                <Ionicons name="list-outline" size={14} color={colors.brand} />
                <Text style={styles.planChipText}>{t('Get my plan')}</Text>
              </TouchableOpacity>
            )}
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder={blocked === 'not_configured' ? t('Coach is coming soon') : t('Ask your coach…')}
                placeholderTextColor={colors.faint}
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
                accessibilityLabel={t('Send question')}
              >
                {busy ? <ActivityIndicator color={colors.onBrand} size="small" /> : <Ionicons name="arrow-up" size={20} color={colors.onBrand} />}
              </TouchableOpacity>
            </View>
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
    <View style={[styles.bubble, styles.theirs, styles.typing]} accessibilityLabel={t('Coach is typing')}>
      {dots.map((v, i) => <Animated.View key={i} style={[styles.dot, { opacity: v }]} />)}
      <Text style={styles.typingText}>{t('Coach is thinking…')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  page: { padding: 16, paddingBottom: 8, width: '100%', maxWidth: 720, alignSelf: 'center' },
  hero: { backgroundColor: colors.brand, borderRadius: radius.lg, padding: 18, ...shadow.md },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...type.h2, color: colors.onBrand },
  heroBody: { fontSize: 14, lineHeight: 20, color: colors.onBrand, opacity: 0.9, marginTop: 10 },
  disclosure: { fontSize: 12, color: colors.onBrand, opacity: 0.65, marginTop: 8, fontStyle: 'italic' },
  quota: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  quotaText: { color: colors.lime, fontSize: 12.5, fontWeight: '700' },
  banner: { flexDirection: 'row', gap: 10, backgroundColor: colors.warnSoft, borderRadius: radius.lg, padding: 14, marginTop: 14 },
  bannerTitle: { ...type.title, fontSize: 15 },
  bannerBody: { ...type.small, color: colors.body, marginTop: 2 },
  planBig: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 16, ...shadow.sm,
  },
  planIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  planBigTitle: { ...type.title },
  planBigBody: { ...type.small, marginTop: 2 },
  starter: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8,
    borderWidth: 1, borderColor: colors.line,
  },
  starterText: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 19 },
  privacy: { flexDirection: 'row', gap: 8, marginTop: 10 },
  privacyText: { ...type.small, fontSize: 12, flex: 1 },
  bubble: { maxWidth: '88%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.lg, marginTop: 10 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  mineText: { color: colors.onBrand, fontSize: 14.5, lineHeight: 20 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.line },
  theirsText: { color: colors.ink, fontSize: 14.5, lineHeight: 21 },
  eventCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, marginTop: 6, ...shadow.sm,
  },
  eventIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  eventTitle: { ...type.label, fontSize: 14 },
  eventMeta: { ...type.small, fontSize: 12, marginTop: 2 },
  eventCta: { color: colors.brand, fontSize: 12, marginTop: 3, fontWeight: '700' },
  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: 12, marginTop: 10 },
  errorText: { color: colors.danger, fontSize: 13.5, lineHeight: 19 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, marginLeft: 26, alignSelf: 'flex-start' },
  retry: { color: colors.danger, fontWeight: '800' },
  typing: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.muted, marginRight: 4 },
  typingText: { color: colors.muted, fontSize: 12.5, marginLeft: 6 },
  composer: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 12, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 22 : 10 },
  composerInner: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  planChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12, marginBottom: 8,
  },
  planChipText: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end' },
  input: {
    flex: 1, minHeight: 42, maxHeight: 120, backgroundColor: colors.bg, borderRadius: 21, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 15, color: colors.ink,
  },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  limitBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.warnSoft, padding: 14, paddingBottom: Platform.OS === 'ios' ? 24 : 14,
  },
  limitText: { color: colors.ink, fontSize: 13.5, textAlign: 'center', fontWeight: '600', flexShrink: 1 },
});

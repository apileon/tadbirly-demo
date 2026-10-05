import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView,
  ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { supabase } from './supabase';
import { notify } from './notify';
import { colors, radius } from './theme';

// ============================================================
//  Safety tools required by the App Store (Guideline 1.2) and Google Play:
//  report objectionable content, block abusive users, delete your account.
//
//  Screens use:
//    const safety = useReportSheet({ onBlocked });
//    safety.open({ type: 'news', id: post.id, userId: post.author_id, name });
//    ...and render {safety.sheet} once anywhere in the screen.
// ============================================================

// getUser() is a network call: on a blip it resolves with user: null instead
// of throwing, so check before touching the id.
async function myId() {
  const { data: auth } = await supabase.auth.getUser();
  return auth?.user?.id ?? null;
}
// Local read (no network) — enough to key the blocked-users cache.
async function sessionUserId() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export const REPORT_REASONS = [
  { key: 'spam', label: 'Spam or scam' },
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'inappropriate', label: 'Inappropriate or offensive content' },
  { key: 'other', label: 'Something else' },
];

// What each target is called in the sheet's title.
const TARGET_LABEL = {
  user: 'profile',
  event: 'event',
  news: 'post',
  comment: 'comment',
  message: 'message',
  event_message: 'message',
  team: 'team',
  chat: 'conversation',
};

// A column the database doesn't have yet (supabase/27 not run): PostgREST
// answers PGRST204, Postgres 42703.
const missingColumn = (e) => !!e && (e.code === 'PGRST204' || e.code === '42703');
// A function that doesn't exist yet: PGRST202 / 42883.
const missingFunction = (e) => !!e && (e.code === 'PGRST202' || e.code === '42883');

// File a report. Returns { error } like any supabase call — never throws.
//   targetType: user | event | news | comment | message | event_message | team | chat
//   targetId:   that row's id
//   reportedUserId: who wrote it (so the admin can act on the person)
// Old callers passing { postId, reportedUserId, reason } still work.
export async function reportContent({ targetType, targetId, reportedUserId, postId, reason, details } = {}) {
  try {
    const me = await myId();
    if (!me) return { error: { message: 'Please log in again to send a report.' } };
    const type = targetType ?? (postId ? 'event' : 'user');
    const tid = targetId ?? postId ?? reportedUserId ?? null;
    const cleanDetails = details ? String(details).trim().slice(0, 1000) : null;
    const base = {
      reporter_id: me,
      // posts.id only — the old column has a foreign key to events.
      post_id: type === 'event' ? (postId ?? tid) : null,
      reported_user_id: reportedUserId ?? (type === 'user' ? tid : null),
      reason: reason ?? null,
    };
    let { error } = await supabase.from('reports').insert({
      ...base,
      target_type: type,
      target_id: tid,
      details: cleanDetails || null,
    });
    if (missingColumn(error)) {
      // Before supabase/27: keep the essentials in the columns that exist.
      const legacyReason = [reason, type !== 'event' && type !== 'user' ? `${type}:${tid}` : null, cleanDetails]
        .filter(Boolean).join(' · ').slice(0, 500);
      ({ error } = await supabase.from('reports').insert({ ...base, reason: legacyReason || null }));
    }
    return { error: error ?? null };
  } catch (e) {
    return { error: { message: e?.message ?? 'Network error' } };
  }
}

// ---------- Blocking ----------
// A small cache of who I blocked, shared by every screen, so content from
// blocked people can be hidden without an extra request each time.
let blockedCache = { me: null, ids: new Set(), loaded: false };
const listeners = new Set();
function emit() { listeners.forEach((fn) => { try { fn(blockedCache.ids); } catch { /* ignore */ } }); }

export async function getBlockedIds(force = false) {
  const me = await sessionUserId();
  if (!me) return new Set();
  if (!force && blockedCache.loaded && blockedCache.me === me) return blockedCache.ids;
  const { data, error } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', me);
  if (error) return blockedCache.me === me ? blockedCache.ids : new Set();
  blockedCache = { me, ids: new Set((data ?? []).map((r) => r.blocked_id)), loaded: true };
  emit();
  return blockedCache.ids;
}

// Set of user ids I blocked; re-renders when I block/unblock someone.
export function useBlockedIds() {
  const [ids, setIds] = useState(blockedCache.ids);
  useEffect(() => {
    let alive = true;
    const fn = (next) => { if (alive) setIds(new Set(next)); };
    listeners.add(fn);
    getBlockedIds().then((s) => { if (alive) setIds(new Set(s)); });
    return () => { alive = false; listeners.delete(fn); };
  }, []);
  return ids;
}

// Block a user: they can't message you or send friend requests (enforced by
// the database), and their content is hidden from you. Returns { error }.
export async function blockUser(blockedId) {
  const me = await myId();
  if (!me) return { error: { message: 'Not signed in' } };
  if (!blockedId || blockedId === me) return { error: { message: "You can't block yourself." } };
  const { error } = await supabase.from('blocks').insert({ blocker_id: me, blocked_id: blockedId });
  // 23505 = already blocked, which is what they wanted anyway.
  if (error && error.code !== '23505') return { error };
  if (blockedCache.me !== me) blockedCache = { me, ids: new Set(), loaded: false };
  blockedCache.ids = new Set(blockedCache.ids).add(blockedId);
  emit();
  return { error: null };
}

export async function unblockUser(blockedId) {
  const me = await myId();
  if (!me) return { error: { message: 'Not signed in' } };
  const { error } = await supabase.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', blockedId);
  if (error) return { error };
  const next = new Set(blockedCache.ids);
  next.delete(blockedId);
  blockedCache.ids = next;
  emit();
  return { error: null };
}

// ---------- Contact details (phone / Telegram / LinkedIn) ----------
// Shown only to the person, their friends, and the organizer <-> applicant
// pairs (rules live in public.contact_details, supabase/27). Returns
// { phone, telegram, linkedin } or null when you may not see them.
export async function fetchContactDetails(targetId) {
  if (!targetId) return null;
  try {
    const { data, error } = await supabase.rpc('contact_details', { target: targetId });
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      return row && (row.phone || row.telegram || row.linkedin) ? row : null;
    }
    if (!missingFunction(error)) return null;
    // Database without supabase/27 yet: behave exactly as before.
    const { data: p } = await supabase.from('profiles').select('phone, telegram, linkedin').eq('id', targetId).maybeSingle();
    return p && (p.phone || p.telegram || p.linkedin) ? p : null;
  } catch {
    return null;
  }
}

// ---------- Account deletion ----------
// Permanently delete the signed-in account (calls the edge function).
export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) {
    // FunctionsHttpError hides the server's message in the response body.
    let msg = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) msg = body.error;
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  return data;
}

// ============================================================
//  The Report / Block sheet (one component for every screen)
// ============================================================

// Alerts shown while a Modal is closing get swallowed on iOS — wait for it.
function afterSheetCloses(fn) {
  setTimeout(fn, Platform.OS === 'ios' ? 450 : 50);
}

// target: { type, id, userId?, name?, postId?, label? }
//   userId — the person behind the content; enables the Block option
//   name   — shown as "Block <name>"
export function ReportSheet({ visible, target, onClose, onBlocked }) {
  const [reason, setReason] = useState(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [step, setStep] = useState('report'); // report | confirmBlock
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(null);
  const blocked = useBlockedIds();

  useEffect(() => {
    if (!visible) return;
    setReason(null); setDetails(''); setAlsoBlock(false); setStep('report'); setBusy(false);
    sessionUserId().then(setMe);
  }, [visible, target?.type, target?.id]);

  if (!target) return null;
  const what = target.label ?? TARGET_LABEL[target.type] ?? 'content';
  const canBlock = !!target.userId && target.userId !== me;
  const isBlocked = canBlock && blocked.has(target.userId);
  const who = target.name || 'this person';

  async function sendReport() {
    if (!reason || busy) return;
    setBusy(true);
    const { error } = await reportContent({
      targetType: target.type,
      targetId: target.id,
      reportedUserId: target.userId ?? null,
      postId: target.postId,
      reason,
      details,
    });
    if (error) {
      setBusy(false);
      return notify('Could not send the report', error.message);
    }
    let blockedNow = false;
    if (alsoBlock && canBlock && !isBlocked) {
      const { error: bErr } = await blockUser(target.userId);
      blockedNow = !bErr;
    }
    setBusy(false);
    onClose?.();
    afterSheetCloses(() => {
      notify(
        'Report sent',
        'Thank you. Our team reviews every report within 24 hours and removes content and users that break the Community Rules.'
          + (blockedNow ? `\n\nYou also blocked ${who}.` : ''),
      );
      if (blockedNow) onBlocked?.(target.userId);
    });
  }

  async function doBlock() {
    if (busy) return;
    setBusy(true);
    const { error } = await blockUser(target.userId);
    setBusy(false);
    if (error) return notify('Could not block', error.message);
    onClose?.();
    afterSheetCloses(() => {
      notify('Blocked', `${who} can't message you or send you requests anymore, and you won't see their content. You can unblock them from their profile.`);
      onBlocked?.(target.userId);
    });
  }

  async function doUnblock() {
    if (busy) return;
    setBusy(true);
    const { error } = await unblockUser(target.userId);
    setBusy(false);
    if (error) return notify('Could not unblock', error.message);
    onClose?.();
    afterSheetCloses(() => notify('Unblocked', `You'll see ${who}'s content again.`));
  }

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18 }}>
            {step === 'confirmBlock' ? (
              <>
                <Text style={s.title}>Block {who}?</Text>
                <Text style={s.sub}>
                  They won't be able to message you or send you friend requests, and their posts, comments and
                  messages will be hidden from you. They are not told that you blocked them.
                </Text>
                <View style={s.row}>
                  <TouchableOpacity style={[s.btn, s.ghost]} onPress={() => setStep('report')} disabled={busy}>
                    <Text style={s.ghostText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btn, s.danger]} onPress={doBlock} disabled={busy}>
                    {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Block</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={s.title}>Report this {what}</Text>
                <Text style={s.sub}>
                  Reports are anonymous to the person you report. Our team reviews them within 24 hours.
                </Text>
                {REPORT_REASONS.map((r) => {
                  const on = reason === r.key;
                  return (
                    <TouchableOpacity
                      key={r.key}
                      style={[s.reason, on && s.reasonOn]}
                      onPress={() => setReason(r.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                    >
                      <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>
                      <Text style={[s.reasonText, on && { color: colors.brand }]}>{r.label}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TextInput
                  style={s.input}
                  value={details}
                  onChangeText={setDetails}
                  placeholder={reason === 'other' ? 'What happened? (helps us act faster)' : 'Add details (optional)'}
                  placeholderTextColor={colors.muted}
                  multiline
                  maxLength={1000}
                />
                {canBlock && !isBlocked && (
                  <TouchableOpacity style={s.check} onPress={() => setAlsoBlock((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: alsoBlock }}>
                    <View style={[s.box, alsoBlock && s.boxOn]}>{alsoBlock ? <Text style={s.tick}>✓</Text> : null}</View>
                    <Text style={s.checkText}>Also block {who}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[s.btn, s.primary, !reason && { opacity: 0.45 }]} onPress={sendReport} disabled={!reason || busy}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Send report</Text>}
                </TouchableOpacity>

                {canBlock && (
                  <>
                    <View style={s.divider} />
                    {isBlocked ? (
                      <TouchableOpacity style={[s.btn, s.ghost]} onPress={doUnblock} disabled={busy}>
                        <Text style={s.ghostText}>Unblock {who}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={[s.btn, s.dangerGhost]} onPress={() => setStep('confirmBlock')} disabled={busy}>
                        <Text style={s.dangerGhostText}>🚫 Block {who} without reporting</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
                <TouchableOpacity style={s.cancel} onPress={onClose} disabled={busy}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// One sheet per screen: const safety = useReportSheet(); safety.open({...}); {safety.sheet}
export function useReportSheet({ onBlocked } = {}) {
  const [target, setTarget] = useState(null);
  const [visible, setVisible] = useState(false);
  const open = useCallback((t) => { setTarget(t); setVisible(true); }, []);
  const close = useCallback(() => setVisible(false), []);
  const sheet = (
    <ReportSheet visible={visible} target={target} onClose={close} onBlocked={onBlocked} />
  );
  return { open, close, sheet };
}

// Small "⚑ Report" pill for screen headers and bars.
export function ReportButton({ onPress, label = '⚑ Report', style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[s.pill, style]}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Report or block"
    >
      <Text style={s.pillText}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(17,21,17,0.45)', justifyContent: 'flex-end', alignItems: 'center' },
  sheet: {
    width: '100%', maxWidth: 520, maxHeight: '88%', backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    ...(Platform.OS === 'web' ? { marginBottom: 0 } : {}),
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 6, marginBottom: 12, lineHeight: 19 },
  reason: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, marginBottom: 8, backgroundColor: colors.bg,
  },
  reasonOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  reasonText: { fontSize: 14.5, fontWeight: '700', color: colors.ink, flex: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  input: {
    minHeight: 64, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12,
    fontSize: 14, color: colors.ink, backgroundColor: colors.bg, marginTop: 4, textAlignVertical: 'top',
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: colors.danger, backgroundColor: colors.danger },
  tick: { color: '#fff', fontSize: 13, fontWeight: '900' },
  checkText: { fontSize: 14, color: colors.ink, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btn: { flex: 1, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primary: { backgroundColor: colors.brand },
  danger: { backgroundColor: colors.danger },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  ghost: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line },
  ghostText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  dangerGhost: { backgroundColor: colors.dangerSoft },
  dangerGhostText: { color: colors.danger, fontSize: 14.5, fontWeight: '800' },
  divider: { height: 1, backgroundColor: colors.line, marginTop: 16 },
  cancel: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  cancelText: { color: colors.muted, fontSize: 14.5, fontWeight: '700' },
  pill: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 11 },
  pillText: { color: colors.muted, fontWeight: '800', fontSize: 12.5 },
});

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { notify } from '../lib/notify';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius, type, shadow, column, awardMeta } from '../lib/theme';
import { Button, Avatar, EmptyState, SectionHeader, TextField, reliabilityText } from '../components/ui';
import { pickImage, uploadAvatar, canPickImage } from '../lib/news';
import { t } from '../lib/i18n';

// MILLIY certificate subjects, grouped. Subject names are saved in English
// ("Subject: score") and only translated for display.
const MILLIY_GROUPS = [
  { title: 'Natural and exact sciences', icon: 'calculator-outline', subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology'] },
  { title: 'Humanities and social sciences', icon: 'library-outline', subjects: ['History', 'Geography', 'Uzbek Language & Literature', 'Russian Language & Literature', 'Karakalpak Language & Literature'] },
  { title: 'Foreign and modern languages', icon: 'language-outline', subjects: ['English', 'German', 'French', 'Arabic', 'Turkish', 'Uzbek (as foreign)', 'Russian (as foreign)'] },
];

export default function Passport() {
  const { session, profile, refreshProfile } = useAuth();
  const uid = session?.user?.id;
  const [form, setForm] = useState(null);
  const [awards, setAwards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // True while there are typed-in changes not saved yet. Coming back to this
  // screen (from the photo picker, another tab…) refetches, and that used to
  // overwrite whatever had been typed.
  const dirty = useRef(false);

  const load = useCallback(async () => {
    const [{ data: p }, { data: aw }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).single(),
      supabase
        .from('awards')
        .select('*, badge:badges(name, emoji), post:posts(title)')
        .eq('recipient_id', uid)
        .order('created_at', { ascending: false }),
    ]);
    setAwards(aw ?? []);
    setLoading(false);
    if (dirty.current) {
      // Keep their edits; only the photo comes from the server.
      setForm((f) => (f ? { ...f, avatar_url: p?.avatar_url ?? null } : f));
      return;
    }
    setForm({
      university: p?.university ?? '',
      major: p?.major ?? '',
      academic_year: p?.academic_year ?? '',
      languages: (p?.languages ?? []).join(', '),
      skills: (p?.skills ?? []).join(', '),
      honors: (p?.honors ?? []).join(', '),
      bio: p?.bio ?? '',
      ielts: p?.ielts ?? '',
      sat: p?.sat ?? '',
      act: p?.act ?? '',
      milliy: p?.milliy ?? '',
      telegram: p?.telegram ?? '',
      phone: p?.phone ?? '',
      linkedin: p?.linkedin ?? '',
      avatar_url: p?.avatar_url ?? null,
    });
  }, [uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save() {
    const testError = validateTests(form);
    if (testError) return notify(t('Check your test scores'), testError);
    setSaving(true);
    const patch = {
      university: form.university || null,
      major: form.major || null,
      academic_year: form.academic_year || null,
      languages: form.languages ? form.languages.split(',').map((s) => s.trim()).filter(Boolean) : [],
      skills: form.skills ? form.skills.split(',').map((s) => s.trim()).filter(Boolean) : [],
      honors: form.honors ? form.honors.split(',').map((s) => s.trim()).filter(Boolean) : [],
      bio: form.bio || null,
      ielts: normScore(form.ielts) || null,
      sat: normScore(form.sat) || null,
      act: normScore(form.act) || null,
      milliy: form.milliy || null, // "Subject: score" — the score is normalised in MilliyPicker
      telegram: form.telegram ? form.telegram.trim().replace(/^@/, '') : null,
      phone: form.phone ? form.phone.trim() : null,
      linkedin: form.linkedin ? form.linkedin.trim() : null,
    };
    const { error } = await supabase.from('profiles').update(patch).eq('id', uid);
    setSaving(false);
    if (error) return notify(t('Could not save'), error.message);
    dirty.current = false;
    // Show the scores as stored ("6,5" typed -> "6.5" saved).
    setForm((f) => ({ ...f, ielts: patch.ielts ?? '', sat: patch.sat ?? '', act: patch.act ?? '' }));
    await refreshProfile();
    notify(t('Saved'), t('Your passport is updated.'));
  }

  async function changePhoto() {
    const file = await pickImage({ square: true }); // square crop natively
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return notify(t('Image too large'), t('Please pick a photo under 5 MB.'));
    try {
      const url = await uploadAvatar(file);
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', uid);
      if (error) throw error;
      setForm((f) => ({ ...f, avatar_url: url }));
      await refreshProfile();
      notify(t('Photo updated'), '');
    } catch (e) {
      notify(t('Could not upload'), e.message);
    }
  }

  async function removePhoto() {
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', uid);
    if (error) return notify(t('Could not remove'), error.message);
    setForm((f) => ({ ...f, avatar_url: null }));
    await refreshProfile();
  }

  async function togglePin(award) {
    const next = !award.pinned;
    const { error } = await supabase.from('awards').update({ pinned: next }).eq('id', award.id);
    if (error) {
      if (String(error.message).includes('PIN_LIMIT')) notify(t('Pin limit'), t('You can pin at most 5 events. Unpin one first.'));
      else notify(t('Could not update'), error.message);
      return;
    }
    load();
  }

  if (loading || !form) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;

  const verified = awards.filter((a) => a.verified).length;
  const pinnedCount = awards.filter((a) => a.pinned).length;
  const set = (key) => (v) => { dirty.current = true; setForm((f) => ({ ...f, [key]: v })); };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {/* Profile picture */}
      <View style={styles.photoBlock}>
        <Avatar uri={form.avatar_url} name={profile?.full_name} id={uid} size={92} />
        {canPickImage ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button
              title={form.avatar_url ? t('Change photo') : t('Add a photo')}
              icon="camera-outline"
              variant="soft"
              size="sm"
              onPress={changePhoto}
            />
            {form.avatar_url ? (
              <TouchableOpacity onPress={removePhoto} style={styles.removeBtn} accessibilityRole="button">
                <Ionicons name="trash-outline" size={15} color={colors.danger} />
                <Text style={styles.removeText}>{t('Remove')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Reputation header */}
      <View style={styles.repRow}>
        <Rep icon="shield-checkmark-outline" value={reliabilityText(profile?.reliability, { hasHistory: verified > 0 })} label={t('Reliability')} />
        <Rep icon="checkmark-circle-outline" value={verified} label={t('Verified events')} />
        <Rep icon="pin-outline" value={pinnedCount + '/5'} label={t('Pinned')} />
      </View>
      <Text style={styles.note}>{t('Reliability is earned from verified events and cannot be edited. Each verified event raises it.')}</Text>

      {/* Pinned / achievements */}
      <SectionHeader title={t('Achievements')} style={{ marginTop: 24 }} />
      {awards.length === 0 ? (
        <View style={styles.card}>
          <EmptyState
            icon="medal-outline"
            title={t('No badges yet')}
            text={t('When an organizer verifies you attended their event, your medal appears here.')}
            style={{ paddingVertical: 24 }}
          />
        </View>
      ) : (
        awards.map((a) => (
          <View key={a.id} style={styles.card}>
            <View style={styles.awardTop}>
              <View style={styles.awardEmojiBox}>
                <Text style={styles.awardEmoji}>{awardMeta(a).emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.awardName}>
                  {t(awardMeta(a).label)} · {a.badge?.emoji ?? ''} {a.badge?.name ?? t('Badge')}
                </Text>
                <View style={styles.awardMetaRow}>
                  <Text style={styles.awardEvent} numberOfLines={1}>{a.post?.title}</Text>
                  {a.verified ? (
                    <View style={styles.verified}>
                      <Ionicons name="checkmark-circle" size={13} color={colors.brand} />
                      <Text style={styles.verifiedText}>{t('Verified')}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity
                onPress={() => togglePin(a)}
                style={[styles.pin, a.pinned && styles.pinOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: !!a.pinned }}
              >
                <Ionicons name={a.pinned ? 'pin' : 'pin-outline'} size={14} color={a.pinned ? colors.brand : colors.muted} />
                <Text style={[styles.pinText, a.pinned && { color: colors.brand }]}>{a.pinned ? t('Pinned') : t('Pin')}</Text>
              </TouchableOpacity>
            </View>
            {a.note ? <Text style={styles.awardNote}>“{a.note}”</Text> : null}
          </View>
        ))
      )}

      {/* Sticky "about me" note */}
      <SectionHeader title={t('About me')} style={{ marginTop: 24 }} />
      <View style={styles.sticky}>
        <TextInput
          style={styles.stickyInput}
          value={form.bio}
          onChangeText={set('bio')}
          multiline
          placeholder={t("Write something about yourself: what drives you, what you're proud of…")}
          placeholderTextColor={colors.faint}
        />
      </View>

      {/* Editable passport */}
      <SectionHeader title={t('Student passport')} style={{ marginTop: 24, marginBottom: 0 }} />
      <View style={styles.card}>
        <TextField style={{ marginTop: 0 }} label={t('University / School')} value={form.university} onChangeText={set('university')} placeholder={t('e.g. Inha University / School №1')} />
        <TextField label={t('Major')} value={form.major} onChangeText={set('major')} placeholder={t('e.g. Computer Science')} />
        <TextField label={t('Academic year')} value={form.academic_year} onChangeText={set('academic_year')} placeholder={t('e.g. 2nd year')} />
        <TextField label={t('Honors (comma-separated)')} value={form.honors} onChangeText={set('honors')} placeholder={t("Dean's List, Gold medalist, Olympiad winner")} />
        <TextField label={t('Languages (comma-separated)')} value={form.languages} onChangeText={set('languages')} placeholder={t('Uzbek, Russian, English')} />
        <TextField label={t('Skills (comma-separated)')} value={form.skills} onChangeText={set('skills')} placeholder={t('Figma, Public speaking, React')} />
      </View>

      <SectionHeader title={t('Standardized tests')} style={{ marginTop: 24, marginBottom: 0 }} />
      <View style={styles.card}>
        <View style={styles.testRow}>
          <View style={{ flex: 1 }}>
            <TextField style={{ marginTop: 0 }} label="IELTS" value={form.ielts} onChangeText={set('ielts')} keyboardType="decimal-pad" placeholder={t('0 to 9, e.g. 7.5')} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField style={{ marginTop: 0 }} label="SAT" value={form.sat} onChangeText={set('sat')} keyboardType="number-pad" placeholder="400-1600" />
          </View>
        </View>
        <View style={styles.testRow}>
          <View style={{ flex: 1 }}>
            <TextField label="ACT" value={form.act} onChangeText={set('act')} keyboardType="number-pad" placeholder="1-36" />
          </View>
          <View style={{ flex: 1 }} />
        </View>
        <MilliyPicker value={form.milliy} onChange={set('milliy')} />
      </View>

      <SectionHeader title={t('Contact')} style={{ marginTop: 24, marginBottom: 4 }} />
      <Text style={[styles.note, { marginTop: 0, marginBottom: 10 }]}>{t('Shown on your public profile and on every event you post, so people can reach you directly.')}</Text>
      <View style={styles.card}>
        <TextField style={{ marginTop: 0 }} label={t('Telegram username')} icon="paper-plane-outline" value={form.telegram} onChangeText={set('telegram')} placeholder="@username" />
        <TextField label={t('Phone')} icon="call-outline" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="+998 90 123 45 67" />
        <TextField label="LinkedIn" icon="logo-linkedin" value={form.linkedin} onChangeText={set('linkedin')} placeholder="linkedin.com/in/yourname" />
      </View>

      <Button title={t('Save passport')} icon="checkmark" onPress={save} loading={saving} style={{ marginTop: 8 }} />
      <Text style={[styles.note, { textAlign: 'center' }]}>{t('Organizers and employers see this. Verified data (badges, reliability) cannot be faked.')}</Text>
    </ScrollView>
  );
}

function MilliyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [score, setScore] = useState('');
  return (
    <View>
      <Text style={styles.label}>{t('MILLIY certificate')}</Text>
      <TouchableOpacity style={styles.picker} onPress={() => setOpen(true)} activeOpacity={0.8} accessibilityRole="button">
        <Ionicons name="ribbon-outline" size={18} color={colors.faint} />
        <Text style={{ flex: 1, color: value ? colors.ink : colors.faint, fontSize: 15 }}>{value || t('Choose a subject and enter your score')}</Text>
        <Ionicons name="chevron-down" size={17} color={colors.faint} />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={type.h2}>{t('MILLIY subject')}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t('Close')}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 320 }}>
              {MILLIY_GROUPS.map((g) => (
                <View key={g.title}>
                  <View style={styles.groupHead}>
                    <Ionicons name={g.icon} size={15} color={colors.brand} />
                    <Text style={styles.groupTitle}>{t(g.title)}</Text>
                  </View>
                  {g.subjects.map((s) => (
                    <TouchableOpacity key={s} onPress={() => setSubject(s)} style={[styles.subjRow, subject === s && styles.subjOn]} activeOpacity={0.8}>
                      <Text style={[styles.subjText, subject === s && { color: colors.brand, fontWeight: '700' }]}>{t(s)}</Text>
                      {subject === s ? <Ionicons name="checkmark" size={18} color={colors.brand} /> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
            <TextField label={t('Score')} value={score} onChangeText={setScore} keyboardType="numeric" placeholder={t('e.g. 120 (max 189.9)')} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Button title={t('Cancel')} variant="ghost" style={{ flex: 1 }} onPress={() => setOpen(false)} />
              <Button title={t('Save')} variant="primary" style={{ flex: 1 }} onPress={() => {
                if (!subject) { setOpen(false); return; }
                const s = normScore(score);
                if (s) {
                  const n = Number(s);
                  if (!Number.isFinite(n) || n < 0 || n > 189.9) { notify(t('Invalid MILLIY score'), t('Enter a score between 0 and 189.9.')); return; }
                }
                onChange(s ? `${subject}: ${s}` : subject);
                setOpen(false);
              }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Russian and Uzbek phone keyboards type a decimal comma ("6,5"), and
// Number('6,5') is NaN — which used to block saving the whole passport.
// Every score goes through this before it is checked AND before it is saved.
function normScore(v) {
  return (v ?? '').toString().trim().replace(',', '.');
}

function validateTests(form) {
  const ielts = normScore(form.ielts), sat = normScore(form.sat), act = normScore(form.act);
  if (ielts) {
    const n = Number(ielts);
    if (!Number.isFinite(n) || n < 0 || n > 9) return t('IELTS must be between 0 and 9 (e.g. 7.5).');
    if ((n * 2) % 1 !== 0) return t('IELTS is scored in half-points, e.g. 6.5 or 7.0.');
  }
  if (sat) {
    const n = Number(sat);
    if (!Number.isInteger(n) || n < 400 || n > 1600) return t('SAT must be a whole number between 400 and 1600.');
  }
  if (act) {
    const n = Number(act);
    if (!Number.isInteger(n) || n < 1 || n > 36) return t('ACT must be a whole number between 1 and 36.');
  }
  return null;
}

function Rep({ icon, value, label }) {
  return (
    <View style={styles.rep}>
      <Ionicons name={icon} size={18} color={colors.brand} />
      <Text style={styles.repValue}>{value}</Text>
      <Text style={styles.repLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 50, ...column },
  card: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    padding: 16, marginBottom: 12, ...shadow.sm,
  },
  photoBlock: { alignItems: 'center', marginBottom: 20, marginTop: 4 },
  removeBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, minHeight: 38 },
  removeText: { color: colors.danger, fontWeight: '700', fontSize: 13.5 },
  repRow: { flexDirection: 'row', gap: 10 },
  rep: {
    flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', ...shadow.sm,
  },
  repValue: { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 6 },
  repLabel: { ...type.caption, marginTop: 2, textAlign: 'center' },
  note: { ...type.small, fontSize: 12, marginTop: 10 },
  awardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  awardEmojiBox: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' },
  awardEmoji: { fontSize: 26 },
  awardName: { ...type.title, fontSize: 15 },
  awardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  awardEvent: { ...type.small, fontSize: 12.5, flexShrink: 1 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verifiedText: { fontSize: 12, fontWeight: '700', color: colors.brand },
  awardNote: { ...type.body, fontSize: 14, marginTop: 12, fontStyle: 'italic' },
  pin: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
  },
  pinOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  pinText: { fontSize: 12.5, fontWeight: '700', color: colors.muted },
  label: { ...type.label, marginTop: 14, marginBottom: 7 },
  picker: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md,
    minHeight: 50, paddingHorizontal: 14,
  },
  sticky: {
    backgroundColor: colors.warnSoft, borderRadius: radius.sm, padding: 16, minHeight: 110,
    borderWidth: 1, borderColor: colors.line,
    ...shadow.sm,
  },
  stickyInput: {
    fontSize: 15, lineHeight: 22, color: colors.ink, minHeight: 80, textAlignVertical: 'top', fontStyle: 'italic',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null),
  },
  testRow: { flexDirection: 'row', gap: 12 },
  modalWrap: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: 30,
    width: '100%', maxWidth: 620, alignSelf: 'center',
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 8 },
  groupTitle: { ...type.caption, color: colors.brand, textTransform: 'uppercase', letterSpacing: 0.6 },
  subjRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, marginBottom: 6,
  },
  subjOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  subjText: { fontSize: 14, color: colors.ink },
});

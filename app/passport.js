import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, ActivityIndicator, TouchableOpacity, Modal } from 'react-native';
import { notify } from '../lib/notify';

// MILLIY certificate subjects, grouped.
const MILLIY_GROUPS = [
  { title: '🧮 Natural & Exact Sciences', subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology'] },
  { title: '📚 Humanities & Social Sciences', subjects: ['History', 'Geography', 'Uzbek Language & Literature', 'Russian Language & Literature', 'Karakalpak Language & Literature'] },
  { title: '🌐 Foreign & Modern Languages', subjects: ['English', 'German', 'French', 'Arabic', 'Turkish', 'Uzbek (as foreign)', 'Russian (as foreign)'] },
];
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius, awardMeta } from '../lib/theme';
import { Button, Card, Avatar } from '../components/ui';
import { pickImage, uploadAvatar, canPickImage } from '../lib/news';

export default function Passport() {
  const { session, profile, refreshProfile } = useAuth();
  const uid = session?.user?.id;
  const [form, setForm] = useState(null);
  const [awards, setAwards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', uid).single();
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
    const { data: aw } = await supabase
      .from('awards')
      .select('*, badge:badges(name, emoji), post:posts(title)')
      .eq('recipient_id', uid)
      .order('created_at', { ascending: false });
    setAwards(aw ?? []);
    setLoading(false);
  }, [uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function save() {
    const testError = validateTests(form);
    if (testError) return notify('Check your test scores', testError);
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
    if (error) return notify('Could not save', error.message);
    // Show the scores as stored ("6,5" typed -> "6.5" saved).
    setForm((f) => ({ ...f, ielts: patch.ielts ?? '', sat: patch.sat ?? '', act: patch.act ?? '' }));
    await refreshProfile();
    notify('Saved ✅', 'Your passport is updated.');
  }

  async function changePhoto() {
    const file = await pickImage({ square: true }); // square crop natively
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return notify('Image too large', 'Please pick a photo under 5 MB.');
    try {
      const url = await uploadAvatar(file);
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', uid);
      if (error) throw error;
      setForm((f) => ({ ...f, avatar_url: url }));
      await refreshProfile();
      notify('Photo updated 📸', '');
    } catch (e) {
      notify('Could not upload', e.message);
    }
  }

  async function removePhoto() {
    await supabase.from('profiles').update({ avatar_url: null }).eq('id', uid);
    setForm((f) => ({ ...f, avatar_url: null }));
    await refreshProfile();
  }

  async function togglePin(award) {
    const next = !award.pinned;
    const { error } = await supabase.from('awards').update({ pinned: next }).eq('id', award.id);
    if (error) {
      if (String(error.message).includes('PIN_LIMIT')) notify('Pin limit', 'You can pin at most 5 events. Unpin one first.');
      else notify('Could not update', error.message);
      return;
    }
    load();
  }

  if (loading || !form) return <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />;

  const verified = awards.filter((a) => a.verified).length;
  const pinnedCount = awards.filter((a) => a.pinned).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 50 }}>
      {/* Profile picture */}
      <View style={styles.photoBlock}>
        <Avatar uri={form.avatar_url} name={profile?.full_name} id={uid} size={92} />
        {canPickImage ? (
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 10 }}>
            <TouchableOpacity onPress={changePhoto}>
              <Text style={styles.photoBtn}>{form.avatar_url ? 'Change photo' : '📸 Add a photo'}</Text>
            </TouchableOpacity>
            {form.avatar_url ? (
              <TouchableOpacity onPress={removePhoto}><Text style={[styles.photoBtn, { color: colors.danger }]}>Remove</Text></TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* Reputation header */}
      <View style={styles.repRow}>
        <Rep value={`${profile?.reliability ?? 75}%`} label="Reliability" />
        <Rep value={verified} label="Verified events" />
        <Rep value={pinnedCount + '/5'} label="Pinned" />
      </View>
      <Text style={styles.note}>Reliability is earned from verified events — it cannot be edited. Each verified event raises it.</Text>

      {/* Pinned / achievements */}
      <Text style={styles.h2}>🏅 Achievements</Text>
      {awards.length === 0 ? (
        <Text style={styles.empty}>No badges yet. When an organizer verifies you attended their event, your medal appears here.</Text>
      ) : (
        awards.map((a) => (
          <Card key={a.id}>
            <View style={styles.awardTop}>
              <Text style={styles.awardEmoji}>{awardMeta(a).emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.awardName}>{awardMeta(a).label} · {a.badge?.emoji ?? ''} {a.badge?.name ?? 'Badge'}</Text>
                <Text style={styles.awardEvent}>{a.post?.title}{a.verified ? ' · ✔ Verified' : ''}</Text>
              </View>
              <TouchableOpacity onPress={() => togglePin(a)}>
                <Text style={[styles.pin, a.pinned && styles.pinOn]}>{a.pinned ? '📌 Pinned' : '📍 Pin'}</Text>
              </TouchableOpacity>
            </View>
            {a.note ? <Text style={styles.awardNote}>“{a.note}”</Text> : null}
          </Card>
        ))
      )}

      {/* Sticky "about me" note */}
      <Text style={styles.h2}>📝 About me</Text>
      <View style={styles.sticky}>
        <TextInput
          style={styles.stickyInput}
          value={form.bio}
          onChangeText={(t) => setForm({ ...form, bio: t })}
          multiline
          placeholder="Write something about yourself — what drives you, what you're proud of…"
          placeholderTextColor="#9a8f5f"
        />
      </View>

      {/* Editable passport */}
      <Text style={styles.h2}>🪪 Student Passport</Text>
      <Field label="University / School" v={form.university} on={(t) => setForm({ ...form, university: t })} placeholder="e.g. Inha University / School №1" />
      <Field label="Major" v={form.major} on={(t) => setForm({ ...form, major: t })} placeholder="e.g. Computer Science" />
      <Field label="Academic year" v={form.academic_year} on={(t) => setForm({ ...form, academic_year: t })} placeholder="e.g. 2nd year" />
      <Field label="Honors (comma-separated)" v={form.honors} on={(t) => setForm({ ...form, honors: t })} placeholder="Dean's List, Gold medalist, Olympiad winner" />
      <Field label="Languages (comma-separated)" v={form.languages} on={(t) => setForm({ ...form, languages: t })} placeholder="Uzbek, Russian, English" />
      <Field label="Skills (comma-separated)" v={form.skills} on={(t) => setForm({ ...form, skills: t })} placeholder="Figma, Public speaking, React" />

      <Text style={styles.h2}>📊 Standardized tests</Text>
      <View style={styles.testRow}>
        <View style={{ flex: 1 }}><Field label="IELTS" v={form.ielts} on={(t) => setForm({ ...form, ielts: t })} keyboardType="decimal-pad" placeholder="0–9, e.g. 7.5" /></View>
        <View style={{ flex: 1 }}><Field label="SAT" v={form.sat} on={(t) => setForm({ ...form, sat: t })} keyboardType="number-pad" placeholder="400–1600" /></View>
      </View>
      <View style={styles.testRow}>
        <View style={{ flex: 1 }}><Field label="ACT" v={form.act} on={(t) => setForm({ ...form, act: t })} keyboardType="number-pad" placeholder="1–36" /></View>
        <View style={{ flex: 1 }} />
      </View>
      <MilliyPicker value={form.milliy} onChange={(v) => setForm({ ...form, milliy: v })} />

      <Text style={styles.h2}>📞 Contact</Text>
      <Text style={styles.note}>Shown on your public profile — and on every event you post, so people can reach you directly.</Text>
      <Field label="Telegram username" v={form.telegram} on={(t) => setForm({ ...form, telegram: t })} placeholder="@username" />
      <Field label="Phone" v={form.phone} on={(t) => setForm({ ...form, phone: t })} keyboardType="phone-pad" placeholder="+998 90 123 45 67" />
      <Field label="LinkedIn" v={form.linkedin} on={(t) => setForm({ ...form, linkedin: t })} placeholder="linkedin.com/in/yourname" />

      <Button title="Save passport" onPress={save} loading={saving} style={{ marginTop: 18 }} />
      <Text style={styles.note}>Organizers and employers see this. Verified data (badges, reliability) cannot be faked.</Text>
    </ScrollView>
  );
}

function MilliyPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [score, setScore] = useState('');
  return (
    <View>
      <Text style={styles.label}>MILLIY certificate</Text>
      <TouchableOpacity style={styles.input} onPress={() => setOpen(true)}>
        <Text style={{ color: value ? colors.ink : colors.muted, fontSize: 14 }}>{value || 'Choose subject & enter score'}</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>MILLIY subject</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {MILLIY_GROUPS.map((g) => (
                <View key={g.title}>
                  <Text style={styles.groupTitle}>{g.title}</Text>
                  {g.subjects.map((s) => (
                    <TouchableOpacity key={s} onPress={() => setSubject(s)} style={[styles.subjRow, subject === s && styles.subjOn]}>
                      <Text style={[styles.subjText, subject === s && { color: colors.brand, fontWeight: '700' }]}>{subject === s ? '✓ ' : ''}{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
            <Text style={styles.label}>Score</Text>
            <TextInput style={styles.input} value={score} onChangeText={setScore} keyboardType="numeric" placeholder="e.g. 120 (max 189.9)" placeholderTextColor={colors.muted} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setOpen(false)} />
              <Button title="Save" variant="green" style={{ flex: 1 }} onPress={() => {
                if (!subject) { setOpen(false); return; }
                const s = normScore(score);
                if (s) {
                  const n = Number(s);
                  if (!Number.isFinite(n) || n < 0 || n > 189.9) { notify('Invalid MILLIY score', 'Enter a score between 0 and 189.9.'); return; }
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
    if (!Number.isFinite(n) || n < 0 || n > 9) return 'IELTS must be between 0 and 9 (e.g. 7.5).';
    if ((n * 2) % 1 !== 0) return 'IELTS is scored in half-points — e.g. 6.5 or 7.0.';
  }
  if (sat) {
    const n = Number(sat);
    if (!Number.isInteger(n) || n < 400 || n > 1600) return 'SAT must be a whole number between 400 and 1600.';
  }
  if (act) {
    const n = Number(act);
    if (!Number.isInteger(n) || n < 1 || n > 36) return 'ACT must be a whole number between 1 and 36.';
  }
  return null;
}

function Rep({ value, label }) {
  return (
    <View style={styles.rep}>
      <Text style={styles.repValue}>{value}</Text>
      <Text style={styles.repLabel}>{label}</Text>
    </View>
  );
}
function Field({ label, v, on, placeholder, multiline, keyboardType }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { height: 80, textAlignVertical: 'top' }]}
        value={v}
        onChangeText={on}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  photoBlock: { alignItems: 'center', marginBottom: 18 },
  photoBtn: { color: colors.brand, fontWeight: '800', fontSize: 13.5 },
  repRow: { flexDirection: 'row', gap: 10 },
  rep: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, alignItems: 'center' },
  repValue: { fontSize: 20, fontWeight: '800', color: colors.brand },
  repLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  note: { fontSize: 11.5, color: colors.muted, marginTop: 8, lineHeight: 17 },
  h2: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 22, marginBottom: 10 },
  empty: { fontSize: 13.5, color: colors.muted, lineHeight: 20 },
  awardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  awardEmoji: { fontSize: 30 },
  awardName: { fontSize: 15, fontWeight: '800', color: colors.ink },
  awardEvent: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  awardNote: { fontSize: 13.5, color: colors.ink, marginTop: 10, fontStyle: 'italic', lineHeight: 20 },
  pin: { fontSize: 12.5, fontWeight: '700', color: colors.muted, paddingVertical: 4, paddingHorizontal: 8 },
  pinOn: { color: colors.brand },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
  sticky: {
    backgroundColor: '#fdf6c8', borderRadius: 6, padding: 16, minHeight: 110,
    borderWidth: 1, borderColor: '#f0e6a8',
    transform: [{ rotate: '-1deg' }],
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  stickyInput: { fontSize: 15, lineHeight: 22, color: '#4a4320', minHeight: 80, textAlignVertical: 'top', fontStyle: 'italic' },
  testRow: { flexDirection: 'row', gap: 12 },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: colors.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 30 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginBottom: 12 },
  groupTitle: { fontSize: 13, fontWeight: '800', color: colors.brand, marginTop: 12, marginBottom: 6 },
  subjRow: { paddingVertical: 11, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, marginBottom: 6 },
  subjOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  subjText: { fontSize: 14, color: colors.ink },
});


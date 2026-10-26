import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Switch, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, type, EVENT_TYPES, EVENT_TYPE_KEYS, CITIES, EVENT_LANGUAGES, kindFor } from '../lib/theme';
import { Chip, TextField, Button, Stepper } from './ui';
import FormatPicker from './FormatPicker';
import MapPreview from './MapPreview';
import { pickAndUpload, canPickImage } from '../lib/news';
import { notify } from '../lib/notify';
import { searchPlaces } from '../lib/discover';
import {
  parseEventDate, spotsValue, startTimeValue, formatStartTime, TITLE_MAX, DESCRIPTION_MAX,
} from '../lib/events';
import { t } from '../lib/i18n';
import { extractOpportunity, applyExtracted, keepPasted, PASTE_MAX } from '../lib/opportunities';

// The event form shared by "Post an event" and "Edit event", so both always
// offer — and check — exactly the same things.

export const MAX_QUESTIONS = 5;

// Columns added by supabase/29_growth.sql. Left out when saving to a
// database that doesn't have them yet, so posting keeps working.
const GROWTH_KEYS = ['language', 'is_free', 'fee', 'is_online', 'lat', 'lng', 'questions'];
// Columns added by supabase/32_tournaments.sql, same idea.
const TOURNAMENT_KEYS = ['team_size', 'format', 'group_count', 'advance_per_group'];

const clampInt = (v, min, max, dflt) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isNaN(n) ? dflt : Math.min(max, Math.max(min, n));
};
// Once the matches exist the format belongs to them (the database keeps it too).
const formatLocked = (form) => form.tournament_stage === 'running' || form.tournament_stage === 'finished';

export function emptyEventForm(profile) {
  return {
    title: '', type: '', custom: '', cover_url: null,
    team_mode: 'solo', team_size: 4, format: 'playoff', group_count: 2, advance_per_group: 2, tournament_stage: 'setup',
    is_online: false, city: profile?.city ?? 'Tashkent', location: '', lat: null, lng: null,
    date: '', time: '', deadline: '',
    language: '', is_free: true, fee: '',
    looking_for: '', spots: '', description: '',
    questions: [],
  };
}

export function eventFormFromPost(p) {
  const known = EVENT_TYPE_KEYS.includes(p.category);
  return {
    title: p.title ?? '',
    type: known ? p.category : 'Other',
    custom: known ? '' : (p.category ?? ''),
    cover_url: p.cover_url ?? null,
    team_mode: p.team_mode === 'team' || (p.format && p.format !== 'none') ? 'team' : 'solo',
    team_size: clampInt(p.team_size ?? p.team_min, 2, 20, 4),
    format: p.format && p.format !== 'none' ? p.format : 'playoff',
    group_count: clampInt(p.group_count, 1, 16, 2),
    advance_per_group: clampInt(p.advance_per_group, 1, 8, 2),
    tournament_stage: p.tournament_stage ?? 'setup',
    is_online: !!p.is_online,
    city: p.city ?? 'Tashkent',
    location: p.location ?? '',
    lat: typeof p.lat === 'number' ? p.lat : null,
    lng: typeof p.lng === 'number' ? p.lng : null,
    date: p.event_date ?? '',
    time: formatStartTime(p.start_time),        // "15:00:00" from the database -> "15:00"
    deadline: p.deadline ?? '',
    language: p.language ?? '',
    is_free: p.is_free !== false,
    fee: p.fee ?? '',
    looking_for: p.looking_for ?? '',
    spots: p.spots != null ? String(p.spots) : '',
    description: p.description ?? '',
    questions: Array.isArray(p.questions) ? p.questions.filter((q) => q?.q).map((q) => ({ q: q.q, required: !!q.required })) : [],
    status: p.status,
  };
}

// Checks beyond lib/events' eventFormProblem: category, team size, deadline,
// questions. Returns [title, message] or null.
export function extraFormProblem(form) {
  if (!form.type) return [t('Pick a category'), t('Choose what kind of event this is.')];
  if (form.team_mode === 'team') {
    const n = parseInt(String(form.team_size ?? ''), 10);
    if (!n || n < 2 || n > 20) return [t('Team size'), t('Players per team must be between 2 and 20')];
  }
  const dl = String(form.deadline ?? '').trim();
  if (dl) {
    if (!parseEventDate(dl)) return [t('Check the deadline'), t('Use the format YYYY-MM-DD, e.g. 2026-10-05.')];
    const ev = String(form.date ?? '').trim();
    if (ev && dl > ev) return [t('Check the deadline'), t('Applications should close on or before the event day.')];
  }
  if (!form.is_free && !String(form.fee ?? '').trim()) {
    return [t('Add the price'), t('Write how much it costs, e.g. 50 000 UZS.')];
  }
  return null;
}

// The row to save. `originalTime`: the start time the event had when the
// edit form opened — start_time is only sent when there is or was one.
export function eventRow(form, { originalTime = '' } = {}) {
  const startTime = startTimeValue(form.time);
  const category = form.type === 'Other' ? (String(form.custom).trim() || 'Other') : form.type;
  const questions = (form.questions ?? [])
    .map((q) => ({ q: String(q.q ?? '').trim().slice(0, 200), required: !!q.required }))
    .filter((q) => q.q)
    .slice(0, MAX_QUESTIONS);
  return {
    title: String(form.title).trim(),
    kind: kindFor(form.type),
    category,
    city: form.is_online ? null : (form.city || null),
    location: form.is_online ? null : (String(form.location).trim() || null),
    event_date: String(form.date).trim() || null,
    ...(startTime || originalTime ? { start_time: startTime } : {}),
    deadline: String(form.deadline ?? '').trim() || null,
    spots: spotsValue(form.spots),
    looking_for: String(form.looking_for).trim() || null,
    description: String(form.description).trim() || null,
    ...teamFields(form),
    cover_url: form.cover_url,
    language: form.language || null,
    is_free: !!form.is_free,
    fee: form.is_free ? null : (String(form.fee).trim().slice(0, 60) || null),
    is_online: !!form.is_online,
    lat: form.is_online ? null : form.lat,
    lng: form.is_online ? null : form.lng,
    questions,
  };
}

// "Teams event" switch → team_mode (kept for older app versions and the
// feed's Teams pill) + players per team + format. team_min mirrors the size.
function teamFields(form) {
  const team = form.team_mode === 'team';
  const size = clampInt(form.team_size, 2, 20, 4);
  const row = { team_mode: team ? 'team' : 'solo', team_min: team ? size : null, team_size: team ? size : null };
  if (formatLocked(form)) return row;
  const format = team ? (form.format || 'playoff') : 'none';
  return {
    ...row,
    format,
    group_count: format === 'groups' || format === 'hybrid' ? clampInt(form.group_count, 1, 16, 2) : null,
    advance_per_group: format === 'hybrid' ? clampInt(form.advance_per_group, 1, 8, 2) : null,
  };
}

const missingColumn = (e) => e && (e.code === 'PGRST204' || e.code === '42703');

// Runs save(row); if the database doesn't know the newer columns yet, tries
// again without them instead of failing.
export async function saveWithFallback(row, save) {
  const res = await save(row);
  if (!missingColumn(res?.error)) return res;
  const older = { ...row };
  TOURNAMENT_KEYS.forEach((k) => delete older[k]);
  const res2 = await save(older);
  if (!missingColumn(res2?.error)) return res2;
  GROWTH_KEYS.forEach((k) => delete older[k]);
  return save(older);
}

export default function EventFormFields({ form, set }) {
  const [uploading, setUploading] = useState(false);
  const [placeQ, setPlaceQ] = useState('');
  const [places, setPlaces] = useState(null);
  const [searching, setSearching] = useState(false);

  async function chooseCover() {
    setUploading(true);
    try { const url = await pickAndUpload('covers'); if (url) set('cover_url', url); }
    catch (e) { notify(t('Could not upload'), e.message); }
    setUploading(false);
  }

  async function findPlace() {
    setSearching(true);
    const found = await searchPlaces(placeQ || form.location);
    setSearching(false);
    setPlaces(found);
  }

  function pickPlace(p) {
    set('lat', p.lat);
    set('lng', p.lng);
    if (!String(form.location).trim()) set('location', p.label.split(',').slice(0, 2).join(',').trim());
    setPlaces(null);
    setPlaceQ('');
  }

  const questions = form.questions ?? [];
  const setQuestion = (i, patch) => set('questions', questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  return (
    <View>
      {/* Cover */}
      <Label text={t('Cover photo')} />
      {form.cover_url ? (
        <View>
          <Image source={{ uri: form.cover_url }} style={styles.cover} resizeMode="contain" />
          <View style={styles.coverActions}>
            {canPickImage && (
              <TouchableOpacity onPress={chooseCover} disabled={uploading}>
                <Text style={styles.coverAction}>{uploading ? t('Uploading…') : t('Change')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => set('cover_url', null)}>
              <Text style={[styles.coverAction, { color: colors.danger }]}>{t('Remove')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : canPickImage ? (
        <TouchableOpacity style={styles.coverPick} onPress={chooseCover} disabled={uploading} activeOpacity={0.85}>
          {uploading ? <ActivityIndicator color={colors.brand} /> : <Ionicons name="image-outline" size={28} color={colors.brand} />}
          <Text style={styles.coverPickText}>{uploading ? t('Uploading…') : t('Add a cover photo')}</Text>
          <Text style={styles.coverPickHint}>{t('Events with a photo get far more applications')}</Text>
        </TouchableOpacity>
      ) : null}

      <TextField label={t('Title')} value={form.title} onChangeText={(v) => set('title', v)} maxLength={TITLE_MAX}
        placeholder={t('e.g. TashMUN 2026: delegates wanted')} />

      <Label text={t('Category')} />
      <View style={styles.chips}>
        {EVENT_TYPES.map((tp) => (
          <Chip key={tp.key} on={form.type === tp.key} onPress={() => set('type', tp.key)} text={t(tp.key)} icon={tp.icon} />
        ))}
      </View>
      {form.type === 'Other' && (
        <TextField value={form.custom} onChangeText={(v) => set('custom', v)} placeholder={t('Write your own theme, e.g. Startup pitch night')} style={{ marginTop: 8 }} />
      )}

      {/* Teams: students still apply alone; the organizer makes the teams. */}
      <Label text={t('Teams')} />
      <ToggleRow icon="people-outline" label={t('Teams event')} value={form.team_mode === 'team'} onChange={(v) => set('team_mode', v ? 'team' : 'solo')} />
      {form.team_mode === 'team' && (
        <View style={styles.teamBox}>
          <Text style={[styles.hint, { marginTop: 0 }]}>{t('Students apply alone with one button. You make the teams from the accepted players.')}</Text>
          <Stepper label={t('Players per team')} value={form.team_size} min={2} max={20} onChange={(v) => set('team_size', v)} style={{ marginTop: 12 }} />
          {formatLocked(form) ? (
            <Text style={styles.hint}>{t('The matches have started, so the format can no longer change.')}</Text>
          ) : (
            <>
              <Text style={[styles.label, { marginTop: 14 }]}>{t('Format')}</Text>
              <FormatPicker value={form.format} onChange={(v) => set('format', v)} />
              {form.format === 'groups' || form.format === 'hybrid' ? (
                <Stepper label={t('Groups')} value={form.group_count} min={1} max={16} onChange={(v) => set('group_count', v)} style={{ marginTop: 12 }} />
              ) : null}
              {form.format === 'hybrid' ? (
                <Stepper label={t('Teams going through from each group')} value={form.advance_per_group} min={1} max={8} onChange={(v) => set('advance_per_group', v)} style={{ marginTop: 10 }} />
              ) : null}
            </>
          )}
        </View>
      )}

      {/* Where */}
      <Label text={t('Where')} />
      <ToggleRow icon="laptop-outline" label={t('This event is online')} value={form.is_online} onChange={(v) => set('is_online', v)} />
      {!form.is_online && (
        <>
          <View style={[styles.chips, { marginTop: 10 }]}>
            {CITIES.map((c) => <Chip key={c} on={form.city === c} onPress={() => set('city', c)} text={t(c)} />)}
          </View>
          <TextField label={t('Venue / address')} icon="location-outline" value={form.location} onChangeText={(v) => set('location', v)}
            placeholder={t('e.g. WIUT, Labzak street 12')} />
          {typeof form.lat === 'number' ? (
            <View style={{ marginTop: 10 }}>
              <MapPreview lat={form.lat} lng={form.lng} height={160} />
              <TouchableOpacity onPress={() => { set('lat', null); set('lng', null); }} style={styles.pinRemove}>
                <Ionicons name="close-circle-outline" size={15} color={colors.danger} />
                <Text style={styles.pinRemoveText}>{t('Remove map pin')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.findRow}>
              <TextField value={placeQ} onChangeText={setPlaceQ} placeholder={t('Search the map, e.g. Westminster University Tashkent')}
                icon="map-outline" style={{ flex: 1, marginTop: 10 }} onSubmitEditing={findPlace} returnKeyType="search" />
              <Button title={t('Find')} size="sm" variant="soft" loading={searching} onPress={findPlace} style={{ marginTop: 10, minHeight: 50 }} />
            </View>
          )}
          {places && (
            <View style={styles.places}>
              {places.length === 0 ? (
                <Text style={styles.placeNone}>{t('Nothing found. Try the venue name or a street.')}</Text>
              ) : places.map((p, i) => (
                <TouchableOpacity key={`${p.lat},${p.lng},${i}`} style={styles.place} onPress={() => pickPlace(p)}>
                  <Ionicons name="location" size={15} color={colors.brand} />
                  <Text style={styles.placeText} numberOfLines={2}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </>
      )}

      {/* When */}
      <View style={styles.pair}>
        <TextField label={t('Date (YYYY-MM-DD)')} value={form.date} onChangeText={(v) => set('date', v)} placeholder="2026-11-20" style={{ flex: 1 }} />
        {/* Number pad: "18.30" / "18,30" are accepted, see parseStartTime */}
        <TextField label={t('Start time (HH:MM)')} value={form.time} onChangeText={(v) => set('time', v)} maxLength={5}
          keyboardType="decimal-pad" placeholder="18:30" style={{ flex: 1 }} />
      </View>
      <TextField label={t('Applications close (YYYY-MM-DD)')} value={form.deadline} onChangeText={(v) => set('deadline', v)}
        placeholder={t('Optional')} hint={t('Students who saved your event get a reminder the day before.')} />
      <Text style={styles.hint}>
        {t('Time is optional. Accepted students get a reminder the evening before, and 2 hours before the start if you add a time.')}
      </Text>

      {/* Language + price */}
      <Label text={t('Language of the event')} />
      <View style={styles.chips}>
        {EVENT_LANGUAGES.map((l) => (
          <Chip key={l.key} on={form.language === l.key} onPress={() => set('language', form.language === l.key ? '' : l.key)} text={t(l.label)} />
        ))}
      </View>

      <Label text={t('Price')} />
      <View style={styles.modeRow}>
        <Mode on={form.is_free} icon="gift-outline" title={t('Free')} onPress={() => set('is_free', true)} />
        <Mode on={!form.is_free} icon="cash-outline" title={t('Paid')} onPress={() => set('is_free', false)} />
      </View>
      {!form.is_free && (
        <TextField label={t('How much?')} value={form.fee} onChangeText={(v) => set('fee', v)} maxLength={60} placeholder="50 000 UZS" />
      )}

      <TextField label={t('Who are you looking for?')} value={form.looking_for} onChangeText={(v) => set('looking_for', v)}
        placeholder={t('e.g. Delegates, designers, backend devs')} />
      <TextField label={t('Spots available')} value={form.spots} onChangeText={(v) => set('spots', v)} keyboardType="number-pad" placeholder={t('e.g. 20')} />
      <TextField label={t('Details')} value={form.description} onChangeText={(v) => set('description', v)} multiline maxLength={DESCRIPTION_MAX}
        inputStyle={{ minHeight: 120, textAlignVertical: 'top' }} placeholder={t('Describe it clearly: format, requirements, what participants get…')} />

      {/* Application questions */}
      <Label text={t('Questions for applicants')} />
      <Text style={styles.hint}>{t('Optional. Applicants answer these when they apply; you see the answers in Applicants.')}</Text>
      {questions.map((q, i) => (
        <View key={i} style={styles.question}>
          <TextField value={q.q} onChangeText={(v) => setQuestion(i, { q: v })} maxLength={200}
            placeholder={t('e.g. Why do you want to join?')} style={{ flex: 1, marginTop: 0 }} />
          <View style={styles.qActions}>
            <TouchableOpacity onPress={() => setQuestion(i, { required: !q.required })} style={styles.qReq}>
              <Ionicons name={q.required ? 'checkbox' : 'square-outline'} size={18} color={q.required ? colors.brand : colors.muted} />
              <Text style={styles.qReqText}>{t('Required')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => set('questions', questions.filter((_, j) => j !== i))} accessibilityLabel={t('Remove question')}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </TouchableOpacity>
          </View>
        </View>
      ))}
      {questions.length < MAX_QUESTIONS && (
        <Button title={t('Add a question')} icon="add" variant="ghost" size="sm" style={{ marginTop: 10, alignSelf: 'flex-start' }}
          onPress={() => set('questions', [...questions, { q: '', required: false }])} />
      )}
    </View>
  );
}

// "Paste a Telegram post or link" → the edge function fills the form in.
// Collapsed by default; the organizer still checks everything and publishes.
export function PasteToFill({ setForm }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);       // { ok, text }

  async function fill() {
    const pasted = text.trim();
    if (!pasted || busy) return;
    setBusy(true);
    setMsg(null);
    const res = await extractOpportunity(pasted);
    setBusy(false);
    if (res.ok) {
      setForm((f) => applyExtracted(f, res.data, pasted));
      setMsg({ ok: true, text: t('Filled in. Check every field before publishing.') });
    } else {
      setForm((f) => keepPasted(f, pasted));
      setMsg({ ok: false, text: t("Auto-fill isn't available — fill in manually. Your text is in Details.") });
    }
  }

  return (
    <View style={styles.paste}>
      <TouchableOpacity style={styles.pasteHead} onPress={() => setOpen((v) => !v)} activeOpacity={0.8} accessibilityRole="button">
        <Text style={styles.pasteTitle}>📋 {t('Paste a Telegram post or link')}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
      </TouchableOpacity>
      {open && (
        <View>
          <TextField value={text} onChangeText={setText} multiline maxLength={PASTE_MAX} style={{ marginTop: 6 }}
            inputStyle={{ minHeight: 90, textAlignVertical: 'top' }} placeholder={t('Paste the post text or a link here')} />
          <Button title={t('Fill form')} icon="sparkles-outline" size="sm" variant="soft" loading={busy} disabled={!text.trim()}
            onPress={fill} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
          {msg ? <Text style={[styles.hint, msg.ok && { color: colors.brand }]}>{msg.text}</Text> : null}
        </View>
      )}
    </View>
  );
}

function Label({ text }) {
  return <Text style={styles.label}>{text}</Text>;
}

function Mode({ on, icon, title, sub, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.mode, on && styles.modeOn]} activeOpacity={0.85}>
      <Ionicons name={icon} size={18} color={on ? colors.onBrand : colors.brand} />
      <Text style={[styles.modeTitle, on && { color: colors.onBrand }]}>{title}</Text>
      {sub ? <Text style={[styles.modeSub, on && { color: 'rgba(255,255,255,0.85)' }]}>{sub}</Text> : null}
    </TouchableOpacity>
  );
}

function ToggleRow({ icon, label, value, onChange }) {
  return (
    <View style={styles.toggleRow}>
      <Ionicons name={icon} size={18} color={colors.muted} />
      <Text style={styles.toggleText}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.lineStrong, true: colors.brand }} thumbColor="#fff" activeThumbColor="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...type.label, marginTop: 18, marginBottom: 8 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  cover: { width: '100%', height: 280, borderRadius: radius.md, backgroundColor: '#14181a' },
  coverActions: { flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 10 },
  coverAction: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  coverPick: { backgroundColor: colors.card, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: radius.lg, paddingVertical: 26, alignItems: 'center', gap: 6 },
  coverPickText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  coverPickHint: { fontSize: 12, color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeRow: { flexDirection: 'row', gap: 10 },
  mode: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, gap: 4 },
  modeOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  modeTitle: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  modeSub: { fontSize: 12, color: colors.muted, lineHeight: 16 },
  teamBox: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginTop: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: 12 },
  toggleText: { flex: 1, fontSize: 14.5, color: colors.ink, fontWeight: '500' },
  findRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  places: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, marginTop: 8, overflow: 'hidden' },
  place: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  placeText: { flex: 1, fontSize: 13.5, color: colors.body },
  placeNone: { padding: 12, fontSize: 13.5, color: colors.muted },
  pinRemove: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'center', marginTop: 8, padding: 4 },
  pinRemoveText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  pair: { flexDirection: 'row', gap: 10 },
  question: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 10, marginTop: 10 },
  qActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 2 },
  qReq: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qReqText: { fontSize: 13, color: colors.body, fontWeight: '600' },
  paste: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14 },
  pasteHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pasteTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
});

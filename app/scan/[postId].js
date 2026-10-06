import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { colors, radius, type, shadow } from '../../lib/theme';
import { Button, Avatar, EmptyState } from '../../components/ui';
import { parseTicket } from '../../components/Ticket';
import { canUseCamera } from '../../lib/native';
import { buzz } from '../../lib/feedback';
import { t } from '../../lib/i18n';

// Loaded only where the camera module exists (web, and app builds after it was added).
const Camera = canUseCamera() ? require('expo-camera') : null;

// Organizer check-in: scan participants' QR tickets, or tick them off the list.
export default function Scan() {
  const { postId } = useLocalSearchParams();
  const [tab, setTab] = useState(Camera ? 'scan' : 'list');
  const [people, setPeople] = useState([]);
  const [last, setLast] = useState(null);       // { ok, name, already, error }
  const [q, setQ] = useState('');
  const busy = useRef(false);
  const lastCode = useRef({ value: null, at: 0 });

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('applications')
      .select('id, checked_in, applicant:profiles!applications_applicant_id_fkey(id, full_name, avatar_url, university)')
      .eq('post_id', postId)
      .eq('status', 'accepted');
    setPeople((data ?? []).sort((a, b) => String(a.applicant?.full_name).localeCompare(String(b.applicant?.full_name))));
  }, [postId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function onScan({ data }) {
    // The camera reports the same code many times a second.
    const now = Date.now();
    if (busy.current || (lastCode.current.value === data && now - lastCode.current.at < 4000)) return;
    lastCode.current = { value: data, at: now };
    const ticket = parseTicket(data);
    if (!ticket) { setLast({ ok: false, error: t('This is not a Tadbirly ticket.') }); return; }
    if (ticket.postId !== postId) { setLast({ ok: false, error: t('This ticket is for a different event.') }); return; }
    busy.current = true;
    const { data: res, error } = await supabase.rpc('check_in_by_code', { p_post: postId, p_code: ticket.code });
    busy.current = false;
    if (error) { setLast({ ok: false, error: error.message }); return; }
    setLast(res);
    if (res?.ok) { try { buzz(); } catch { /* no vibration */ } load(); }
  }

  async function toggle(row) {
    const next = !row.checked_in;
    setPeople((ps) => ps.map((p) => (p.id === row.id ? { ...p, checked_in: next } : p)));
    const { error } = await supabase.from('applications').update({ checked_in: next }).eq('id', row.id);
    if (error) load();
  }

  const done = people.filter((p) => p.checked_in).length;
  const shown = people.filter((p) => !q.trim() || String(p.applicant?.full_name ?? '').toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.top}>
        <View style={styles.counter}>
          <Text style={styles.counterNum}>{done}<Text style={styles.counterOf}> / {people.length}</Text></Text>
          <Text style={styles.counterLabel}>{t('checked in')}</Text>
        </View>
        <View style={styles.segment}>
          {[['scan', t('Scan'), 'qr-code-outline'], ['list', t('List'), 'list-outline']].map(([k, label, icon]) => (
            <TouchableOpacity key={k} onPress={() => setTab(k)} style={[styles.segBtn, tab === k && styles.segOn]} disabled={k === 'scan' && !Camera}>
              <Ionicons name={icon} size={15} color={tab === k ? colors.ink : colors.muted} />
              <Text style={[styles.segText, tab === k && { color: colors.ink }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'scan' && Camera ? (
        <ScanPane Camera={Camera} onScan={onScan} last={last} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            people.length > 6 ? (
              <View style={styles.search}>
                <Ionicons name="search" size={17} color={colors.faint} />
                <TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder={t('Find by name')} placeholderTextColor={colors.faint} />
              </View>
            ) : null
          }
          ListEmptyComponent={<EmptyState icon="people-outline" title={t('Nobody accepted yet')} text={t('Accept applicants first; they appear here to check in.')} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => toggle(item)} activeOpacity={0.8}>
              <Avatar uri={item.applicant?.avatar_url} id={item.applicant?.id} name={item.applicant?.full_name} size={38} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.applicant?.full_name}</Text>
                {item.applicant?.university ? <Text style={styles.sub} numberOfLines={1}>{item.applicant.university}</Text> : null}
              </View>
              <Ionicons name={item.checked_in ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={item.checked_in ? colors.accent : colors.faint} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function ScanPane({ Camera, onScan, last }) {
  const [perm, requestPerm] = Camera.useCameraPermissions();
  if (!perm) return null;
  if (!perm.granted) {
    return (
      <EmptyState
        icon="camera-outline"
        title={t('Camera access needed')}
        text={t('Allow the camera to scan participants\' QR tickets. You can also check people in from the List.')}
        action={t('Allow camera')}
        onAction={requestPerm}
      />
    );
  }
  return (
    <View style={styles.scanWrap}>
      <View style={styles.cameraBox}>
        <Camera.CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScan}
        />
        <View style={styles.frame} pointerEvents="none" />
      </View>
      {last ? (
        <View style={[styles.result, { backgroundColor: last.ok ? (last.already ? colors.warnSoft : colors.accentSoft) : colors.dangerSoft }]}>
          <Ionicons
            name={last.ok ? (last.already ? 'alert-circle' : 'checkmark-circle') : 'close-circle'}
            size={28}
            color={last.ok ? (last.already ? colors.warn : colors.accent) : colors.danger}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.resultTitle}>
              {last.ok ? (last.already ? t('Already checked in') : t('Welcome!')) : t('Not checked in')}
            </Text>
            <Text style={styles.resultSub}>{last.ok ? last.name : last.error}</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.scanHint}>{t('Point the camera at a participant\'s ticket.')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  counter: { flex: 1 },
  counterNum: { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  counterOf: { fontSize: 16, color: colors.muted, fontWeight: '600' },
  counterLabel: { ...type.small, marginTop: -2 },
  segment: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.md, padding: 3 },
  segBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.sm },
  segOn: { backgroundColor: colors.card, ...shadow.sm },
  segText: { fontSize: 13.5, fontWeight: '600', color: colors.muted },
  scanWrap: { flex: 1, padding: 16, alignItems: 'center' },
  cameraBox: { width: '100%', maxWidth: 420, aspectRatio: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' },
  frame: { position: 'absolute', top: '18%', left: '18%', right: '18%', bottom: '18%', borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)', borderRadius: 18 },
  scanHint: { ...type.body, color: colors.muted, marginTop: 18, textAlign: 'center' },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%', maxWidth: 420, borderRadius: radius.lg, padding: 16, marginTop: 16 },
  resultTitle: { fontSize: 16, fontWeight: '800', color: colors.ink },
  resultSub: { fontSize: 14, color: colors.body, marginTop: 2 },
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 620, alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 12, height: 44, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 14.5, color: colors.ink, outlineStyle: 'none' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, marginBottom: 8 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
});

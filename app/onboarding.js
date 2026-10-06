import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius, type, EVENT_TYPES, CITIES } from '../lib/theme';
import { Button, Logo } from '../components/ui';
import { notify } from '../lib/notify';
import { t, LANGUAGES, useLocale } from '../lib/i18n';
import { invalidate } from '../lib/cache';

const INTERESTS = EVENT_TYPES.filter((e) => e.key !== 'Other');

// Three quick steps after sign-up: language, interests, city. Opened again
// with ?edit=1 (Feed tip, Settings) to change interests later.
export default function Onboarding() {
  const router = useRouter();
  const { edit } = useLocalSearchParams();
  const editing = edit === '1';
  const { session, profile, refreshProfile } = useAuth();
  const { locale, setLocale } = useLocale();
  const [step, setStep] = useState(editing ? 1 : 0);
  const [interests, setInterests] = useState(profile?.interests ?? []);
  const [city, setCity] = useState(profile?.city ?? 'Tashkent');
  const [busy, setBusy] = useState(false);

  const toggle = (k) => setInterests((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));

  async function finish() {
    setBusy(true);
    const { error } = await supabase
      .from('profiles')
      .update({ interests, city, onboarded: true, locale })
      .eq('id', session.user.id);
    setBusy(false);
    if (error) {
      // Database without 29_growth.sql: keep the city, let them in anyway.
      if (error.code === 'PGRST204' || error.code === '42703') {
        await supabase.from('profiles').update({ city }).eq('id', session.user.id);
      } else {
        return notify(t('Could not save'), error.message);
      }
    }
    invalidate('feed:');
    await refreshProfile();
    if (editing && router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  const steps = editing ? 2 : 3;
  const shown = editing ? step : step + 1;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.top}>
          <Logo size={40} />
          <Text style={styles.stepText}>{t('Step {n} of {m}', { n: shown, m: steps })}</Text>
        </View>
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${(shown / steps) * 100}%` }]} />
        </View>

        {step === 0 && (
          <>
            <Text style={styles.h}>{t('Welcome to Tadbirly')}</Text>
            <Text style={styles.sub}>{t('Which language do you prefer?')}</Text>
            {LANGUAGES.map((l) => (
              <Option key={l.key} label={l.label} on={locale === l.key} onPress={() => setLocale(l.key)} />
            ))}
            <Button title={t('Continue')} icon="arrow-forward" onPress={() => setStep(1)} style={styles.next} />
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.h}>{t('What are you into?')}</Text>
            <Text style={styles.sub}>{t('Pick a few. Your "For you" feed puts these first.')}</Text>
            <View style={styles.grid}>
              {INTERESTS.map((e) => {
                const on = interests.includes(e.key);
                return (
                  <TouchableOpacity key={e.key} style={[styles.tile, on && styles.tileOn]} onPress={() => toggle(e.key)} activeOpacity={0.85}>
                    <Ionicons name={e.icon} size={22} color={on ? colors.onBrand : colors.brand} />
                    <Text style={[styles.tileText, on && { color: colors.onBrand }]}>{t(e.key)}</Text>
                    {on ? <Ionicons name="checkmark-circle" size={16} color={colors.onBrand} style={styles.tick} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Button
              title={interests.length ? t('Continue') : t('Skip for now')}
              icon="arrow-forward"
              variant={interests.length ? 'primary' : 'ghost'}
              onPress={() => setStep(2)}
              style={styles.next}
            />
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.h}>{t('Where are you based?')}</Text>
            <Text style={styles.sub}>{t('Events in your city show up higher.')}</Text>
            <View style={styles.cityGrid}>
              {CITIES.map((c) => (
                <TouchableOpacity key={c} style={[styles.city, city === c && styles.cityOn]} onPress={() => setCity(c)} activeOpacity={0.85}>
                  <Text style={[styles.cityText, city === c && { color: colors.onBrand }]}>{t(c)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button title={editing ? t('Save') : t("Let's go")} icon={editing ? 'checkmark' : 'rocket-outline'} loading={busy} onPress={finish} style={styles.next} />
            <TouchableOpacity onPress={() => setStep(1)} style={styles.back}>
              <Text style={styles.backText}>{t('Back')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Option({ label, on, onPress }) {
  return (
    <TouchableOpacity style={[styles.option, on && styles.optionOn]} onPress={onPress} activeOpacity={0.85}>
      <Text style={[styles.optionText, on && { color: colors.brand }]}>{label}</Text>
      <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.brand : colors.faint} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40, width: '100%', maxWidth: 520, alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepText: { ...type.small, fontWeight: '600' },
  progress: { height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: 16, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.brand },
  h: { ...type.h1, marginTop: 28 },
  sub: { ...type.body, color: colors.muted, marginTop: 6, marginBottom: 18 },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: 15, paddingHorizontal: 16, marginBottom: 10 },
  optionOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  optionText: { fontSize: 16, fontWeight: '600', color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '31%', minWidth: 96, flexGrow: 1, aspectRatio: 1.1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  tileOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  tileText: { fontSize: 13, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  tick: { position: 'absolute', top: 8, right: 8 },
  cityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  city: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  cityOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  cityText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  next: { marginTop: 24 },
  back: { alignItems: 'center', paddingVertical: 14 },
  backText: { color: colors.muted, fontWeight: '600' },
});

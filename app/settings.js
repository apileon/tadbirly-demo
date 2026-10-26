import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius, themePref, setThemePref, column } from '../lib/theme';
import { SectionHeader } from '../components/ui';
import { notify } from '../lib/notify';
import { t, LANGUAGES, useLocale } from '../lib/i18n';

const THEMES = [
  { key: 'system', label: 'Same as my phone', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

export default function Settings() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const { locale, setLocale } = useLocale();
  const [theme, setTheme] = useState(themePref);

  function pickLanguage(key) {
    if (key === locale) return;
    // Remembered on the profile too, so notifications can follow it later.
    if (session?.user?.id) supabase.from('profiles').update({ locale: key }).eq('id', session.user.id).then(() => {}, () => {});
    setLocale(key);
  }

  function pickTheme(key) {
    setTheme(key);
    const applied = setThemePref(key);
    if (!applied && key !== themePref) {
      notify(t('Saved'), t('Close and reopen Tadbirly to switch the look.'));
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page}>
      <SectionHeader title={t('Language')} style={{ marginTop: 4 }} />
      <View style={styles.group}>
        {LANGUAGES.map((l, i) => (
          <Row key={l.key} label={l.label} on={locale === l.key} onPress={() => pickLanguage(l.key)} last={i === LANGUAGES.length - 1} />
        ))}
      </View>

      <SectionHeader title={t('Appearance')} />
      <View style={styles.group}>
        {THEMES.map((th, i) => (
          <Row key={th.key} icon={th.icon} label={t(th.label)} on={theme === th.key} onPress={() => pickTheme(th.key)} last={i === THEMES.length - 1} />
        ))}
      </View>
      {Platform.OS !== 'web' && theme !== themePref ? (
        <Text style={styles.note}>{t('Close and reopen Tadbirly to switch the look.')}</Text>
      ) : null}

      <SectionHeader title={t('Your feed')} />
      <View style={styles.group}>
        <TouchableOpacity style={[styles.row, { borderBottomWidth: 0 }]} onPress={() => router.push('/onboarding?edit=1')} activeOpacity={0.7}>
          <Ionicons name="sparkles-outline" size={19} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{t('Interests and city')}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {[...(profile?.interests ?? []).map((x) => t(x)), profile?.city ? t(profile.city) : null].filter(Boolean).join(' · ') || t('Not set yet')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.faint} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Row({ icon, label, on, onPress, last }) {
  return (
    <TouchableOpacity style={[styles.row, last && { borderBottomWidth: 0 }]} onPress={onPress} activeOpacity={0.7} accessibilityRole="radio" accessibilityState={{ checked: !!on }}>
      {icon ? <Ionicons name={icon} size={19} color={colors.muted} /> : null}
      <Text style={[styles.label, { flex: 1 }]}>{label}</Text>
      {on ? <Ionicons name="checkmark" size={20} color={colors.brand} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, ...column },
  group: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  label: { fontSize: 15, fontWeight: '600', color: colors.ink },
  sub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  note: { fontSize: 12.5, color: colors.muted, marginTop: 8, textAlign: 'center' },
});

// Tadbirly in English, Uzbek and Russian.
//
// Text stays in English in the code, wrapped in t():
//     t('Saved events')                     → "Saqlangan tadbirlar"
//     t('{n} spots', { n: 5 })              → "5 ta joy"
// The English sentence is the key; lib/locales/uz.js and ru.js map it to the
// translation. Anything not translated yet simply shows in English.
//
// The language is chosen once, before the app draws (saved choice → phone
// language → English). Changing it re-renders the UI in place: the providers
// (auth, badges, realtime) and the navigation stay as they are. Screens are
// re-drawn by app/_layout.js (see ScreenGate), because text computed with the
// plain t() doesn't subscribe to anything by itself.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, radius } from './theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import uz from './locales/uz';
import ru from './locales/ru';

export const LANGUAGES = [
  { key: 'en', label: 'English' },
  { key: 'uz', label: "O'zbekcha" },
  { key: 'ru', label: 'Русский' },
];
const DICTS = { uz, ru };
const STORE_KEY = 'tdb:locale';

function deviceLocale() {
  let tag = '';
  try {
    tag = Platform.OS === 'web' && typeof navigator !== 'undefined'
      ? navigator.language
      : Intl.DateTimeFormat().resolvedOptions().locale;
  } catch { /* no Intl */ }
  const base = String(tag || '').slice(0, 2).toLowerCase();
  return base === 'uz' || base === 'ru' ? base : 'en';
}

let current = deviceLocale();

export const getLocale = () => current;

// BCP-47 tag for dates and numbers (toLocaleDateString etc.).
export const dateLocale = () => ({ uz: 'uz-UZ', ru: 'ru-RU' }[current] ?? 'en-GB');

export function t(text, vars) {
  let s = (current !== 'en' && DICTS[current]?.[text]) || text;
  if (vars) {
    for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  }
  return s;
}

// Russian/Uzbek plural-aware helper for counts: tn(n, '{n} spot', '{n} spots').
// Uzbek and Russian entries hold their own forms in the dictionaries.
export function tn(n, one, many) {
  return t(n === 1 ? one : many, { n });
}

const LocaleContext = createContext({ locale: current, setLocale: () => {} });

// True once a language has been picked on purpose — a saved choice from an
// earlier visit, or a tap on a language switch this time. Onboarding skips
// its language step then.
let chosen = false;
export const hasChosenLocale = () => chosen;

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(current);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((saved) => {
        if (saved && (saved === 'en' || DICTS[saved])) { current = saved; chosen = true; setLocaleState(saved); }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setLocale = useCallback((next) => {
    if (!(next === 'en' || DICTS[next])) return;
    chosen = true;
    current = next;
    setLocaleState(next);
    AsyncStorage.setItem(STORE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  if (!ready) return null;
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

// Compact EN / UZ / RU switch (login & sign-up, top-right).
export function LanguageSwitch({ style }) {
  const { locale, setLocale } = useLocale();
  return (
    <View style={[switchStyles.wrap, style]} accessibilityRole="radiogroup" accessibilityLabel={t('Language')}>
      {LANGUAGES.map((l) => {
        const on = l.key === locale;
        return (
          <TouchableOpacity
            key={l.key}
            onPress={() => setLocale(l.key)}
            activeOpacity={0.8}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            accessibilityLabel={l.label}
            style={[switchStyles.item, on && switchStyles.itemOn]}
          >
            <Text style={[switchStyles.text, on && switchStyles.textOn]}>{l.key.toUpperCase()}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const switchStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', padding: 3, gap: 2,
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
  },
  item: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: radius.pill },
  itemOn: { backgroundColor: colors.brand },
  text: { fontSize: 12, fontWeight: '700', color: colors.muted, letterSpacing: 0.4 },
  textOn: { color: colors.onBrand },
});

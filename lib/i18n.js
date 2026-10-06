// Tadbirly in English, Uzbek and Russian.
//
// Text stays in English in the code, wrapped in t():
//     t('Saved events')                     → "Saqlangan tadbirlar"
//     t('{n} spots', { n: 5 })              → "5 ta joy"
// The English sentence is the key; lib/locales/uz.js and ru.js map it to the
// translation. Anything not translated yet simply shows in English.
//
// The language is chosen once, before the app draws (saved choice → phone
// language → English), and changing it redraws the whole app.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
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

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(current);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((saved) => {
        if (saved && (saved === 'en' || DICTS[saved])) { current = saved; setLocaleState(saved); }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  function setLocale(next) {
    if (!(next === 'en' || DICTS[next])) return;
    current = next;
    setLocaleState(next);
    AsyncStorage.setItem(STORE_KEY, next).catch(() => {});
  }

  if (!ready) return null;
  // key: a new language redraws every screen, including text computed outside
  // React components with the plain t().
  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      <React.Fragment key={locale}>{children}</React.Fragment>
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

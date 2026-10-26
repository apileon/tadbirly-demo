import { Platform, Appearance } from 'react-native';

// ---------------------------------------------------------------------------
//  Light / dark
//  Every screen builds its StyleSheet once, when its file loads, from the
//  `colors` below — so the theme is decided here, before any screen loads,
//  and a change of setting applies on the next launch (the web reloads the
//  page straight away). Preference: 'system' (default) | 'light' | 'dark'.
// ---------------------------------------------------------------------------
const THEME_KEY = 'tdb:theme';
const THEME_FILE = 'theme-pref.txt';

function themeFile() {
  // Required lazily: the web build has no document directory.
  const { File, Paths } = require('expo-file-system');
  return new File(Paths.document, THEME_FILE);
}

function readThemePref() {
  try {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' ? window.localStorage.getItem(THEME_KEY) : null;
    }
    const f = themeFile();
    return f.exists ? f.textSync().trim() : null;
  } catch {
    return null;
  }
}

export const themePref = ['light', 'dark'].includes(readThemePref()) ? readThemePref() : 'system';
export const scheme = themePref === 'system' ? (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light') : themePref;
export const isDark = scheme === 'dark';

// Saves the preference. Returns true when it already applied (web reload),
// false when the app has to be restarted to see it.
export function setThemePref(pref) {
  const value = ['light', 'dark'].includes(pref) ? pref : 'system';
  try {
    if (Platform.OS === 'web') {
      window.localStorage.setItem(THEME_KEY, value);
      window.location.reload();
      return true;
    }
    themeFile().write(value);
  } catch { /* storage unavailable: nothing to save */ }
  return false;
}

// Tadbirly design tokens. Neutral surfaces with a single deep-green brand
// colour; lime is reserved for the logo and small highlights.
const light = {
  bg: '#f4f6f3',
  card: '#ffffff',
  ink: '#161b17',
  body: '#3c443d',      // long-form text, a step softer than ink
  muted: '#6f786f',
  faint: '#9aa29a',     // placeholders, disabled
  brand: '#1f5135',
  brandDark: '#163d27',
  brandSoft: '#e3eee6',
  onBrand: '#ffffff',   // text and icons on brand-coloured surfaces
  lime: '#c9f24d',
  accent: '#2f6a47',
  accentSoft: '#e8f1ea',
  warn: '#b7861a',
  warnSoft: '#f7efd9',
  danger: '#c0392b',
  dangerSoft: '#fdecec',
  line: '#e3e7e1',
  lineStrong: '#d3d9d0',
  overlay: 'rgba(10,15,11,0.45)',
};

// Same roles, tuned for dark: lifted surfaces instead of shadows, and a
// brighter green so buttons and links keep their contrast.
const dark = {
  bg: '#0f1310',
  card: '#181d19',
  ink: '#eef2ec',
  body: '#c9d1c7',
  muted: '#93a091',
  faint: '#6b766a',
  brand: '#3f8f5f',
  brandDark: '#2f7a4d',
  brandSoft: '#1f3326',
  onBrand: '#ffffff',
  lime: '#c9f24d',
  accent: '#5fb27f',
  accentSoft: '#1e3226',
  warn: '#e0b448',
  warnSoft: '#3a3020',
  danger: '#ef6b5c',
  dangerSoft: '#3d1f1c',
  line: '#283028',
  lineStrong: '#344034',
  overlay: 'rgba(0,0,0,0.6)',
};

export const colors = isDark ? dark : light;

export const radius = { xs: 8, sm: 10, md: 12, lg: 16, xl: 20, pill: 999 };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// One content column for every screen: fills a phone, and stays a readable
// column in the middle of a laptop instead of stretching across it.
export const layout = { contentMax: 640 };
// Spread into a page / list container style.
export const column = { width: '100%', maxWidth: layout.contentMax, alignSelf: 'center' };

// One type scale for the whole app. Spread into a style: [type.title, {...}].
export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6, color: colors.ink },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  h2: { fontSize: 19, lineHeight: 25, fontWeight: '700', letterSpacing: -0.2, color: colors.ink },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: colors.ink },
  body: { fontSize: 15, lineHeight: 22, color: colors.body },
  small: { fontSize: 13, lineHeight: 18, color: colors.muted },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.ink },
  caption: { fontSize: 11.5, lineHeight: 15, fontWeight: '600', letterSpacing: 0.3, color: colors.muted },
};

// Soft, layered shadows. On web a real box-shadow renders far cleaner than
// React Native's shadow* props.
const mkShadow = (y, blur, opacity, elevation) =>
  Platform.OS === 'web'
    ? { boxShadow: `0 1px 2px rgba(16,24,18,0.04), 0 ${y}px ${blur}px rgba(16,24,18,${opacity})` }
    : { shadowColor: '#101812', shadowOpacity: opacity, shadowRadius: blur / 2, shadowOffset: { width: 0, height: y }, elevation };
export const shadow = {
  sm: mkShadow(2, 8, 0.05, 1),
  md: mkShadow(6, 20, 0.07, 3),
  lg: mkShadow(12, 32, 0.12, 8),
};

// Avatars: everyone without a photo gets a stable colour of their own.
export const AVATAR_COLORS = [
  '#1f5135', '#4a7d7a', '#52657d', '#7d5266',
  '#a06a3f', '#5a7d52', '#7d6b52', '#6b5a8a',
];
export function avatarColor(id) {
  if (!id) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function initialsOf(name) {
  const parts = String(name ?? '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

// Coarse kind (drives card / hero colours).
export const CATEGORIES = {
  event: { label: 'Event', emoji: '🎪', color: colors.brand, soft: colors.brandSoft },
  internship: { label: 'Internship', emoji: '💼', color: colors.warn, soft: colors.warnSoft },
  mun: { label: 'MUN', emoji: '🌍', color: '#3f6b5e', soft: '#e2eeea' },
};
export const CATEGORY_ORDER = ['event', 'internship', 'mun'];

// Event types organizers choose from; students filter the feed by these.
// `icon` is an Ionicons name, used wherever the UI shows the type as a label.
export const EVENT_TYPES = [
  { key: 'MUN', emoji: '🌍', icon: 'globe-outline' },
  { key: 'Hackathon', emoji: '💻', icon: 'code-slash-outline' },
  { key: 'Quiz', emoji: '🧠', icon: 'bulb-outline' },
  { key: 'Competition', emoji: '🏆', icon: 'trophy-outline' },
  { key: 'Olympiad', emoji: '📐', icon: 'calculator-outline' },
  { key: 'Debate', emoji: '🎤', icon: 'mic-outline' },
  { key: 'Workshop', emoji: '🛠️', icon: 'construct-outline' },
  { key: 'Conference', emoji: '🎓', icon: 'school-outline' },
  { key: 'Volunteering', emoji: '🤝', icon: 'heart-outline' },
  { key: 'Internship', emoji: '💼', icon: 'briefcase-outline' },
  { key: 'Sports', emoji: '⚽', icon: 'football-outline' },
  { key: 'Other', emoji: '✨', icon: 'sparkles-outline' },
];
export const EVENT_TYPE_KEYS = EVENT_TYPES.map((t) => t.key);

// Emoji, icon + label for whatever is stored in posts.category (custom text → "Other" style).
export function typeMeta(category) {
  const found = EVENT_TYPES.find((t) => t.key === category);
  return found ?? { key: category || 'Other', emoji: '✨', icon: 'sparkles-outline' };
}
export const isOtherType = (category) => !category || !EVENT_TYPE_KEYS.includes(category) || category === 'Other';

// Cities offered at sign-up and when posting an event.
export const CITIES = ['Tashkent', 'Samarkand', 'Bukhara', 'Namangan', 'Andijan', 'Fergana', 'Nukus', 'Karshi', 'Termez', 'Jizzakh', 'Navoi', 'Urgench'];

// Language an event is held in (posts.language).
export const EVENT_LANGUAGES = [
  { key: 'uz', label: "O'zbekcha" },
  { key: 'ru', label: 'Русский' },
  { key: 'en', label: 'English' },
  { key: 'mixed', label: 'Mixed' },
];

// Award kinds an organizer can give.
export const AWARD_KINDS = [
  { key: 'winner', place: 1, emoji: '🥇', label: '1st place', points: 100 },
  { key: 'winner', place: 2, emoji: '🥈', label: '2nd place', points: 75 },
  { key: 'winner', place: 3, emoji: '🥉', label: '3rd place', points: 50 },
  { key: 'medal', emoji: '🏅', label: 'Medal', points: 30 },
  { key: 'mention', emoji: '🎖️', label: 'Honourable mention', points: 20 },
  { key: 'participation', emoji: '✅', label: 'Participation', points: 10 },
];
export function awardMeta(a) {
  if (!a) return { emoji: '🏅', label: 'Medal' };
  if (a.kind === 'winner') {
    const m = AWARD_KINDS.find((k) => k.key === 'winner' && k.place === a.place);
    return m ?? { emoji: '🏆', label: 'Winner' };
  }
  const m = AWARD_KINDS.find((k) => k.key === (a.kind ?? 'medal'));
  return m ?? { emoji: '🏅', label: 'Medal' };
}

// Map a chosen type to the coarse kind used for colours.
export function kindFor(type) {
  if (type === 'MUN') return 'mun';
  if (type === 'Internship') return 'internship';
  return 'event';
}

// Tadbirly design tokens — matches the green demo prototype.
export const colors = {
  bg: '#edf1e8',
  card: '#fdfdfa',
  ink: '#232a22',
  muted: '#7f877c',
  brand: '#2d5a3d',
  brandSoft: '#dcead3',
  accent: '#3d5a45',
  accentSoft: '#e6efe2',
  warn: '#c9a227',
  warnSoft: '#eee5c8',
  danger: '#c0392b',
  dangerSoft: '#fdecec',
  line: '#dfe5d8',
};

export const radius = { sm: 12, md: 14, lg: 20, xl: 24, pill: 999 };

// Avatars: everyone without a photo gets a stable colour of their own.
export const AVATAR_COLORS = [
  '#2d5a3d', '#4a7d7a', '#52657d', '#7d5266',
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
  mun: { label: 'MUN', emoji: '🌍', color: '#5a7d52', soft: '#e2ecdb' },
};
export const CATEGORY_ORDER = ['event', 'internship', 'mun'];

// Event types organizers choose from; students filter the feed by these.
export const EVENT_TYPES = [
  { key: 'MUN', emoji: '🌍' },
  { key: 'Hackathon', emoji: '💻' },
  { key: 'Quiz', emoji: '🧠' },
  { key: 'Competition', emoji: '🏆' },
  { key: 'Olympiad', emoji: '📐' },
  { key: 'Debate', emoji: '🎤' },
  { key: 'Workshop', emoji: '🛠️' },
  { key: 'Conference', emoji: '🎓' },
  { key: 'Volunteering', emoji: '🤝' },
  { key: 'Internship', emoji: '💼' },
  { key: 'Sports', emoji: '⚽' },
  { key: 'Other', emoji: '✨' },
];
export const EVENT_TYPE_KEYS = EVENT_TYPES.map((t) => t.key);

// Emoji + label for whatever is stored in posts.category (custom text → "Other" style).
export function typeMeta(category) {
  const found = EVENT_TYPES.find((t) => t.key === category);
  return found ?? { key: category || 'Other', emoji: '✨' };
}
export const isOtherType = (category) => !category || !EVENT_TYPE_KEYS.includes(category) || category === 'Other';

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

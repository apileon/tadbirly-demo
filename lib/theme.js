// Tadbirly design tokens — mirrors the original prototype palette.
export const colors = {
  bg: '#f4f5f7',
  card: '#ffffff',
  ink: '#17203a',
  muted: '#7a839b',
  brand: '#2f6df6',
  brandSoft: '#e8efff',
  accent: '#0eb981',
  accentSoft: '#e2f8f0',
  warn: '#f59e0b',
  warnSoft: '#fef3e0',
  danger: '#ef4444',
  line: '#e7e9ef',
};

export const radius = { sm: 10, md: 12, lg: 16, xl: 20 };

// Category metadata used across the feed, filters and post cards.
export const CATEGORIES = {
  event: { label: 'Event', emoji: '🎪', color: colors.brand, soft: colors.brandSoft },
  request: { label: 'Request', emoji: '🙋', color: colors.accent, soft: colors.accentSoft },
  internship: { label: 'Internship', emoji: '💼', color: colors.warn, soft: colors.warnSoft },
  mun: { label: 'MUN', emoji: '🌍', color: '#8b5cf6', soft: '#efe9ff' },
};

export const CATEGORY_ORDER = ['event', 'request', 'internship', 'mun'];

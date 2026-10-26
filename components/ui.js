import React, { useState, useRef, useEffect } from 'react';
import { Text, TouchableOpacity, View, ActivityIndicator, StyleSheet, Image, TextInput, Animated } from 'react-native';
import { springTo } from './Motion';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, type, shadow, isDark, avatarColor, initialsOf } from '../lib/theme';
import { t } from '../lib/i18n';
import Dot from './Dot';

// The Tadbirly mark: two offset T's, lime behind and deep green in front.
// Drawn with plain views so it stays crisp at any size and needs no image.
export function Logo({ size = 40, variant = 'dark', style }) {
  const f = (n) => size * n;
  const bar = (left, top, w, h, color) => ({
    position: 'absolute',
    left: f(left), top: f(top), width: f(w), height: f(h),
    borderRadius: f(0.06), backgroundColor: color,
  });
  const light = variant === 'light';
  const tile = light ? '#ffffff' : '#111511';   // near-black
  const back = colors.lime;                      // lime T, behind
  const front = light ? '#14532d' : '#ffffff';   // front T
  return (
    <View
      style={[
        {
          width: size, height: size, borderRadius: f(0.27),
          backgroundColor: tile,
          // The near-black tile needs an edge to show on a dark background.
          borderWidth: light || isDark ? Math.max(1, f(0.02)) : 0,
          borderColor: colors.line,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <View style={bar(0.247, 0.333, 0.48, 0.12, back)} />
      <View style={bar(0.427, 0.333, 0.12, 0.413, back)} />
      <View style={bar(0.313, 0.253, 0.48, 0.12, front)} />
      <View style={bar(0.493, 0.253, 0.12, 0.413, front)} />
    </View>
  );
}

// "Tadbirly" set in the brand style, with the "ly" in brand green.
export function Wordmark({ size = 22, style }) {
  return (
    <Text style={[{ fontSize: size, fontWeight: '800', color: colors.ink, letterSpacing: -size * 0.025 }, style]}>
      Tadbir<Text style={{ color: colors.brand }}>ly</Text>
    </Text>
  );
}

// Profile picture, or initials on a colour that's always the same for that person.
export function Avatar({ uri, name, id, size = 44, style }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[box, { backgroundColor: colors.line }, style]} resizeMode="cover" />;
  }
  return (
    <View style={[box, { backgroundColor: avatarColor(id), alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: Math.round(size * 0.38) }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

// Variants: primary (brand), green (same, kept for older screens), dark,
// danger, ghost (white with a hairline border — the secondary action).
const BUTTON = {
  primary: { bg: colors.brand, fg: '#fff' },
  green: { bg: colors.brand, fg: '#fff' },
  // ink turns light in dark mode, so its text uses the page colour.
  dark: { bg: colors.ink, fg: colors.bg },
  danger: { bg: colors.danger, fg: '#fff' },
  ghost: { bg: colors.card, fg: colors.ink, border: colors.lineStrong },
  soft: { bg: colors.brandSoft, fg: colors.brand },
};

export function Button({ title, onPress, variant = 'primary', disabled, loading, icon, size = 'md', style }) {
  const v = BUTTON[variant] ?? BUTTON.primary;
  const small = size === 'sm';
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading) }}
      style={[
        styles.btn,
        small && styles.btnSm,
        { backgroundColor: v.bg, opacity: disabled ? 0.45 : 1 },
        v.border && { borderWidth: 1, borderColor: v.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.btnRow}>
          {icon ? <Ionicons name={icon} size={small ? 16 : 18} color={v.fg} /> : null}
          <Text style={[styles.btnText, small && { fontSize: 13.5 }, { color: v.fg }]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Round icon-only button, e.g. the notification bell.
export function IconButton({ icon, onPress, size = 42, color = colors.ink, badge = 0, label, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[styles.iconBtn, { width: size, height: size, borderRadius: size / 2 }, style]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={color} />
      {badge > 0 && (
        <View style={styles.iconBadge}>
          <Text style={styles.iconBadgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// Labelled text input with an optional leading icon, error and show/hide
// toggle for passwords.
export function TextField({ label, icon, error, secure, hint, style, inputStyle, onFocus, onBlur, ...props }) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  return (
    <View style={[{ marginTop: 14 }, style]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          error && { borderColor: colors.danger },
        ]}
      >
        {icon ? <Ionicons name={icon} size={18} color={focused ? colors.brand : colors.faint} style={{ marginLeft: 14 }} /> : null}
        <TextInput
          placeholderTextColor={colors.faint}
          secureTextEntry={secure && hidden}
          {...props}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[styles.fieldInput, inputStyle]}
        />
        {secure ? (
          <TouchableOpacity
            onPress={() => setHidden((v) => !v)}
            style={{ paddingHorizontal: 14, paddingVertical: 12 }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={colors.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

// Filter pill. `icon` is an Ionicons name.
export function Chip({ text, on, onPress, icon, style }) {
  const fg = on ? colors.bg : colors.body;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={[styles.chip, on && styles.chipOn, style]}
    >
      {icon ? <Ionicons name={icon} size={14} color={on ? colors.bg : colors.muted} /> : null}
      <Text style={[styles.chipText, { color: fg }]}>{text}</Text>
    </TouchableOpacity>
  );
}

// Friendly placeholder for empty lists.
export function EmptyState({ icon = 'sparkles-outline', title, text, action, onAction, style }) {
  return (
    <View style={[styles.empty, style]}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.brand} />
      </View>
      {title ? <Text style={[type.title, { textAlign: 'center' }]}>{title}</Text> : null}
      {text ? <Text style={[type.small, { textAlign: 'center', marginTop: 4, maxWidth: 300 }]}>{text}</Text> : null}
      {action ? <Button title={action} onPress={onAction} size="sm" style={{ marginTop: 16, paddingHorizontal: 20 }} /> : null}
    </View>
  );
}

// Small heading above a group of cards, with an optional link on the right.
export function SectionHeader({ title, action, onAction, style }) {
  return (
    <View style={[styles.sectionHead, style]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.sectionAction}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function Tag({ label, color, soft, icon }) {
  return (
    <View style={[styles.tag, { backgroundColor: soft }]}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <Text style={[styles.tagText, { color }]}>{label}</Text>
    </View>
  );
}

export function Card({ children, style, onPress }) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap activeOpacity={0.9} onPress={onPress} style={[styles.card, style]}>
      {children}
    </Wrap>
  );
}

export function Screen({ children, style }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

// Segmented control (Feed: For you / Upcoming, Portal, Social).
//   options: [{ key, label, icon?, n? }]  — n shows a red dot when > 0
//   tone: 'brand' (pill, green when selected) | 'quiet' (soft, card when selected)
export function Segmented({ options, value, onChange, tone = 'brand', style }) {
  const quiet = tone === 'quiet';
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  // The highlight is one pill that glides to the selected option.
  const pad = quiet ? 3 : 4;
  const [inner, setInner] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const segW = inner && options.length ? inner / options.length : 0;
  const placed = useRef(false);
  useEffect(() => {
    if (!segW) return;
    if (!placed.current) { x.setValue(index * segW); placed.current = true; return; }
    springTo(x, index * segW);
  }, [index, segW, x]);

  return (
    <View
      style={[quiet ? styles.segQuiet : styles.seg, style]}
      accessibilityRole="tablist"
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width - pad * 2 - (quiet ? 0 : 2);   // minus padding (+ border)
        if (w > 0 && Math.abs(w - inner) > 0.5) setInner(w);
      }}
    >
      {segW ? (
        <Animated.View
          style={[
            quiet ? styles.segOnQuiet : styles.segOn,
            styles.segThumb,
            { top: pad, bottom: pad, left: pad, width: segW, borderRadius: quiet ? radius.sm : radius.pill, transform: [{ translateX: x }] },
          ]}
        />
      ) : null}
      {options.map((o) => {
        const on = o.key === value;
        const fg = quiet ? (on ? colors.ink : colors.muted) : (on ? colors.onBrand : colors.muted);
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange?.(o.key)}
            activeOpacity={0.85}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            // Before the first layout there's no gliding pill yet: show the
            // selected one the old way for that single frame.
            style={[quiet ? styles.segBtnQuiet : styles.segBtn, on && !segW && (quiet ? styles.segOnQuiet : styles.segOn)]}
          >
            <View style={styles.segRow}>
              {o.icon ? <Ionicons name={o.icon} size={15} color={fg} /> : null}
              <Text style={[styles.segText, { color: fg }]} numberOfLines={1}>{o.label}</Text>
              <Dot n={o.n ?? 0} plain />
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Application status. `viewer="organizer"` says "Rejected"; the applicant
// sees the gentler "Not selected".
export function StatusPill({ status, viewer }) {
  const map = {
    pending: { label: t('Pending'), icon: 'time-outline', c: colors.warn, b: colors.warnSoft },
    accepted: { label: t('Accepted'), icon: 'checkmark-circle', c: colors.accent, b: colors.accentSoft },
    rejected: {
      label: viewer === 'organizer' ? t('Rejected') : t('Not selected'),
      icon: 'close-circle-outline', c: colors.danger, b: colors.dangerSoft,
    },
  };
  const s = map[status] ?? map.pending;
  return <Tag label={s.label} icon={s.icon} color={s.c} soft={s.b} />;
}

// − 4 + number picker for small counts (players per team, groups…).
export function Stepper({ value, min = 0, max = 99, onChange, label, style }) {
  const n = Number(value) || 0;
  const step = (d) => onChange?.(Math.min(max, Math.max(min, n + d)));
  return (
    <View style={[styles.stepper, style]}>
      {label ? <Text style={styles.stepperLabel} numberOfLines={2}>{label}</Text> : null}
      <View style={styles.stepperBox}>
        <TouchableOpacity onPress={() => step(-1)} disabled={n <= min} style={[styles.stepperBtn, n <= min && { opacity: 0.35 }]}
          accessibilityRole="button" accessibilityLabel={`${label ?? ''} −`} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="remove" size={18} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.stepperValue} accessibilityLiveRegion="polite">{n}</Text>
        <TouchableOpacity onPress={() => step(1)} disabled={n >= max} style={[styles.stepperBtn, n >= max && { opacity: 0.35 }]}
          accessibilityRole="button" accessibilityLabel={`${label ?? ''} +`} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="add" size={18} color={colors.ink} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// A white card with a small uppercase heading.
export function Section({ title, icon, children, style, titleStyle }) {
  return (
    <View style={[styles.sectionCard, style]}>
      {title ? (
        <View style={styles.sectionCardHead}>
          {icon ? <Ionicons name={icon} size={14} color={colors.muted} /> : null}
          <Text style={[styles.sectionTitle, titleStyle]}>{title}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
//  Reliability. Everyone starts at 75% and only verified events/awards raise
//  it, so a bare 75% says nothing — it reads "New" until there is history.
//  hasHistory: pass true when the screen knows of verified events/awards.
// ---------------------------------------------------------------------------
export const DEFAULT_RELIABILITY = 75;
export function isNewReliability(value, hasHistory) {
  if (hasHistory) return false;
  return value == null || !(Number(value) > DEFAULT_RELIABILITY);
}
// "New" or "82%" — or the given pattern ("{n}% reliable") for the number.
export function reliabilityText(value, { hasHistory, format } = {}) {
  if (isNewReliability(value, hasHistory)) return t('New');
  const n = Math.round(Number(value ?? DEFAULT_RELIABILITY));
  return format ? t(format, { n }) : `${n}%`;
}
// Inline shield + text, for meta rows.
export function Reliability({ value, hasHistory, format, icon = 'shield-checkmark-outline', size = 12, color = colors.brand, textStyle, style }) {
  return (
    <View style={[styles.relRow, style]}>
      <Ionicons name={icon} size={size} color={color} />
      <Text style={[styles.relText, textStyle]}>{reliabilityText(value, { hasHistory, format })}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: radius.md,
    minHeight: 50,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSm: { minHeight: 38, paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.sm },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnText: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
  iconBtn: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBadge: {
    position: 'absolute', top: -4, right: -4, minWidth: 19, height: 19, borderRadius: 10,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5, borderWidth: 2, borderColor: colors.card,
  },
  iconBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  fieldLabel: { ...type.label, marginBottom: 7 },
  field: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md,
    minHeight: 50,
  },
  fieldFocused: { borderColor: colors.brand, ...shadow.sm },
  fieldInput: { flex: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: colors.ink, outlineStyle: 'none' },
  fieldError: { color: colors.danger, fontSize: 12.5, marginTop: 6 },
  fieldHint: { ...type.small, fontSize: 12.5, marginTop: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 13, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 },
  sectionTitle: { ...type.caption, textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionAction: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.pill },
  tagText: { fontSize: 11.5, fontWeight: '700' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 12,
    ...shadow.sm,
  },
  screen: { flex: 1, backgroundColor: colors.bg },
  seg: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.line },
  segBtn: { flex: 1, paddingVertical: 9, paddingHorizontal: 6, borderRadius: radius.pill, alignItems: 'center' },
  segOn: { backgroundColor: colors.brand },
  segQuiet: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radius.md, padding: 3 },
  segBtnQuiet: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.sm },
  segOnQuiet: { backgroundColor: colors.card, ...shadow.sm },
  segRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  segThumb: { position: 'absolute', pointerEvents: 'none' },
  segText: { fontSize: 13.5, fontWeight: '700' },
  sectionCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 16, marginBottom: 12 },
  sectionCardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperLabel: { ...type.label, flex: 1 },
  stepperBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.pill },
  stepperBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  stepperValue: { minWidth: 28, textAlign: 'center', fontSize: 16, fontWeight: '800', color: colors.ink },
  relRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  relText: { fontSize: 12.5, color: colors.muted },
});

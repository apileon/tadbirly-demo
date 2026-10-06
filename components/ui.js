import React, { useState } from 'react';
import { Text, TouchableOpacity, View, ActivityIndicator, StyleSheet, Image, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, type, shadow, isDark, avatarColor, initialsOf } from '../lib/theme';

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
});

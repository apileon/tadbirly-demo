import React from 'react';
import { Text, TouchableOpacity, View, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { colors, radius, avatarColor, initialsOf } from '../lib/theme';

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
  const back = '#c9f24d';                        // lime T, behind
  const front = light ? '#14532d' : '#ffffff';   // front T
  return (
    <View
      style={[
        {
          width: size, height: size, borderRadius: f(0.27),
          backgroundColor: tile,
          borderWidth: light ? Math.max(1, f(0.02)) : 0,
          borderColor: '#e2e8dc',
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

// Profile picture, or initials on a colour that's always the same for that person.
export function Avatar({ uri, name, id, size = 44, style }) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) {
    return <Image source={{ uri }} style={[box, { backgroundColor: colors.line }, style]} resizeMode="cover" />;
  }
  return (
    <View style={[box, { backgroundColor: avatarColor(id), alignItems: 'center', justifyContent: 'center' }, style]}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: Math.round(size * 0.38) }}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }) {
  const bg = {
    primary: colors.brand,
    green: colors.accent,
    ghost: colors.bg,
    dark: colors.ink,
    danger: colors.danger,
  }[variant];
  const fg = variant === 'ghost' ? colors.ink : '#fff';
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export function Tag({ label, color, soft }) {
  return (
    <View style={[styles.tag, { backgroundColor: soft }]}>
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
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 15, fontWeight: '700' },
  tag: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 11, borderRadius: radius.pill },
  tagText: { fontSize: 11, fontWeight: '700' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 12,
  },
  screen: { flex: 1, backgroundColor: colors.bg },
});

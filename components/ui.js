import React from 'react';
import { Text, TouchableOpacity, View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors, radius } from '../lib/theme';

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }) {
  const bg = {
    primary: colors.brand,
    green: colors.accent,
    ghost: colors.bg,
    dark: colors.ink,
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
  tag: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 9, borderRadius: 8 },
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

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../lib/theme';

// A small red dot, optionally with a count in it. Renders nothing at 0 so
// callers can drop it in unconditionally.
//   <Dot n={3} />          -> red circle with "3"
//   <Dot n={3} plain />    -> plain red dot, no number
export default function Dot({ n = 0, plain = false, style }) {
  if (!n || n <= 0) return null;

  if (plain) return <View style={[styles.plain, style]} />;

  const label = n > 99 ? '99+' : String(n);
  return (
    <View style={[styles.bubble, label.length > 1 && styles.wide, style]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

// Absolutely positioned version for sitting on top of a tab icon.
export function IconDot({ n = 0, plain = true }) {
  if (!n || n <= 0) return null;
  return (
    <View style={styles.onIcon} pointerEvents="none">
      <Dot n={n} plain={plain} />
    </View>
  );
}

const styles = StyleSheet.create({
  plain: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#e5484d',
    borderWidth: 1.5, borderColor: colors.card,
  },
  bubble: {
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: '#e5484d',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  wide: { paddingHorizontal: 5 },
  text: { color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 14 },
  onIcon: { position: 'absolute', top: -3, right: -6 },
});

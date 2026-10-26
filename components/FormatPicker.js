import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../lib/theme';
import { t } from '../lib/i18n';

// The four tournament formats, with a one-line plain explanation each.
// Shared by the event form and the organizer's Teams & matches screen.
export const FORMAT_INFO = {
  versus: { icon: 'git-compare-outline', title: 'Team vs team', sub: 'Two teams, one match.' },
  groups: { icon: 'grid-outline', title: 'Group stage', sub: 'Everyone plays everyone in their group. Most points wins.' },
  playoff: { icon: 'git-network-outline', title: 'Playoff', sub: 'Knockout: lose once and you are out.' },
  hybrid: { icon: 'layers-outline', title: 'Hybrid', sub: 'Groups first, then the best teams play a knockout.' },
};
export const FORMAT_KEYS = ['versus', 'groups', 'playoff', 'hybrid'];

export const formatTitle = (f) => (FORMAT_INFO[f] ? t(FORMAT_INFO[f].title) : '');

export default function FormatPicker({ value, onChange, style }) {
  return (
    <View style={[styles.grid, style]} accessibilityRole="radiogroup">
      {FORMAT_KEYS.map((k) => {
        const f = FORMAT_INFO[k];
        const on = value === k;
        return (
          <TouchableOpacity
            key={k}
            onPress={() => onChange?.(k)}
            activeOpacity={0.85}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            style={[styles.tile, on && styles.tileOn]}
          >
            <View style={styles.head}>
              <Ionicons name={f.icon} size={17} color={on ? colors.onBrand : colors.brand} />
              <Text style={[styles.title, on && { color: colors.onBrand }]} numberOfLines={1}>{t(f.title)}</Text>
            </View>
            <Text style={[styles.sub, on && { color: 'rgba(255,255,255,0.85)' }]}>{t(f.sub)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 11, gap: 4,
  },
  tileOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 12, color: colors.muted, lineHeight: 16 },
});

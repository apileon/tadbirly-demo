import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';
import { TextField, EmptyState, Avatar } from '../components/ui';
import { t } from '../lib/i18n';

export default function SearchUsers() {
  const { session } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [searched, setSearched] = useState(false);

  async function run(text) {
    setQ(text);
    if (text.trim().length < 2) { setRows([]); setSearched(false); return; }
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, university, major, reliability, verified_student')
      .ilike('full_name', `%${text.trim()}%`)
      .neq('id', session.user.id)
      .limit(30);
    setRows(data ?? []);
    setSearched(true);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.head}>
        <TextField
          icon="search-outline"
          style={styles.searchWrap}
          value={q}
          onChangeText={run}
          placeholder={t('Search people by name…')}
          accessibilityLabel={t('Search people by name')}
          autoFocus
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(u) => u.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          searched ? (
            <EmptyState icon="person-outline" title={t('No one found')} text={t('Try another name.')} />
          ) : (
            <EmptyState icon="search-outline" text={t('Type at least 2 letters to search students.')} />
          )
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/user/${item.id}`)}>
            <Avatar uri={item.avatar_url} name={item.full_name} id={item.id} size={42} />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{item.full_name}</Text>
                {item.verified_student ? (
                  <Ionicons name="checkmark-circle" size={15} color={colors.brand} accessibilityLabel={t('Verified student')} />
                ) : null}
              </View>
              <View style={styles.metaRow}>
                {item.university || item.major ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    {item.university ?? ''}{item.major ? ` · ${item.major}` : ''} ·
                  </Text>
                ) : null}
                <Ionicons name="shield-checkmark-outline" size={12} color={colors.muted} />
                <Text style={styles.meta}>{item.reliability ?? 75}%</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { padding: 14, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  searchWrap: { marginTop: 0, width: '100%', maxWidth: 688, alignSelf: 'center' },
  list: { padding: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, padding: 14, marginBottom: 10 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { fontSize: 12.5, color: colors.muted, flexShrink: 1 },
});

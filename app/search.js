import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';

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
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={run}
          placeholder="Search people by name…"
          placeholderTextColor={colors.muted}
          autoFocus
        />
      </View>
      <FlatList
        data={rows}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {searched ? 'No one found. Try another name.' : 'Type at least 2 letters to search students.'}
          </Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/user/${item.id}`)}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{(item.full_name ?? '?')[0]}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.full_name}{item.verified_student ? ' ✔' : ''}</Text>
              <Text style={styles.meta}>{item.university ?? ''}{item.major ? ` · ${item.major}` : ''} · ⭐ {item.reliability ?? 75}%</Text>
            </View>
            <Text style={styles.view}>View →</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { padding: 14, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  search: { backgroundColor: colors.bg, borderRadius: radius.pill, paddingVertical: 11, paddingHorizontal: 16, fontSize: 14, color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, marginBottom: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 17 },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  view: { fontSize: 13, color: colors.brand, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 40, paddingHorizontal: 20, lineHeight: 21 },
});

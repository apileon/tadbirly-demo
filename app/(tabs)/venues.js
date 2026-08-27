import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, radius } from '../../lib/theme';
import { Card, Button, Tag } from '../../components/ui';

export default function Venues() {
  const { session } = useAuth();
  const [venues, setVenues] = useState([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('venues').select('*').order('verified', { ascending: false });
    setVenues(data ?? []);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function requestBooking(v) {
    const { error } = await supabase.from('venue_bookings').insert({
      venue_id: v.id, requester_id: session.user.id,
    });
    Alert.alert(error ? 'Could not send' : 'Request sent ✅', error ? error.message : `The owner of ${v.name} will review your booking request.`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <Text style={styles.h1}>🏛 Find a venue</Text>
      <Text style={styles.sub}>Rentable spaces for your event · Tashkent</Text>

      {/* Map placeholder — swap for react-native-maps once you add the API keys (see README). */}
      <View style={styles.map}>
        <Text style={styles.mapText}>🗺️ Map view</Text>
        <Text style={styles.mapHint}>Interactive pins arrive when react-native-maps is wired up.</Text>
      </View>

      <FlatList
        data={venues}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ padding: 16, paddingTop: 4 }}
        ListEmptyComponent={<Text style={styles.empty}>No venues listed yet. Owners can list a space from the web dashboard or a future "List venue" screen.</Text>}
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.name}>{item.name}</Text>
              {item.verified && <Tag label="✔ Verified" color={colors.accent} soft={colors.accentSoft} />}
            </View>
            <Text style={styles.meta}>{item.type} · {item.capacity ?? '—'} people · {item.area_m2 ?? '—'} m²</Text>
            <Text style={styles.price}>
              {item.price_per_day ? `${item.price_per_day.toLocaleString()} so'm / day` : 'Free'}
            </Text>
            <Button title="Request booking" variant="green" style={{ marginTop: 12 }} onPress={() => requestBooking(item)} />
          </Card>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink, paddingHorizontal: 18, paddingTop: 6 },
  sub: { fontSize: 13, color: colors.muted, paddingHorizontal: 18, marginTop: 4, marginBottom: 12 },
  map: { height: 150, marginHorizontal: 16, borderRadius: radius.lg, backgroundColor: '#dcefe2', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  mapText: { fontSize: 18, fontWeight: '700', color: colors.ink },
  mapHint: { fontSize: 12, color: colors.muted, marginTop: 4 },
  name: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 6 },
  price: { fontSize: 13, fontWeight: '800', color: colors.brand, marginTop: 6 },
  empty: { textAlign: 'center', color: colors.muted, marginTop: 30, fontSize: 14, paddingHorizontal: 20, lineHeight: 21 },
});

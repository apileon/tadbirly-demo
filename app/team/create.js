import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet } from 'react-native';
import { notify } from '../../lib/notify';
import { useRouter } from 'expo-router';
import { colors, radius } from '../../lib/theme';
import { Button } from '../../components/ui';
import { createTeam } from '../../lib/teams';

export default function CreateTeam() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [competition, setCompetition] = useState('');
  const [description, setDescription] = useState('');
  const [spots, setSpots] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return notify('Name your team');
    setSaving(true);
    // try/finally: if anything throws (a network blip mid-way), the button
    // must stop spinning — it used to stay stuck until a page reload.
    try {
      const { team, error } = await createTeam({ name: name.trim(), competition, description, spots });
      if (error) return notify('Could not create', error.message);
      notify('Team created 🧩', 'Now invite people from the team screen.');
      router.replace(`/team/${team.id}`);
    } catch (e) {
      notify('Could not create', e?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      <Text style={styles.h1}>Create a team</Text>
      <Field label="Team name" v={name} on={setName} placeholder="Code Ninjas" />
      <Field label="Competition" v={competition} on={setCompetition} placeholder="Inha Hackathon 2026" />
      <Field label="Spots" v={spots} on={setSpots} placeholder="4" numeric />
      <Field label="Description" v={description} on={setDescription} placeholder="What you're looking for in teammates" multiline />
      <Button title="Create team" onPress={save} loading={saving} style={{ marginTop: 18 }} />
    </ScrollView>
  );
}

function Field({ label, v, on, placeholder, multiline, numeric }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { height: 90, textAlignVertical: 'top' }]}
        value={v} onChangeText={on} placeholder={placeholder} placeholderTextColor={colors.muted}
        multiline={multiline} keyboardType={numeric ? 'number-pad' : 'default'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: colors.ink, marginBottom: 4 },
  label: { fontSize: 12.5, fontWeight: '700', color: colors.muted, marginTop: 16, marginBottom: 6 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12, fontSize: 14, color: colors.ink },
});

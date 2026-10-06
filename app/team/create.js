import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { notify } from '../../lib/notify';
import { useRouter } from 'expo-router';
import { colors, radius, type } from '../../lib/theme';
import { Button, TextField, Chip } from '../../components/ui';
import { createTeam, parseSkills } from '../../lib/teams';
import { t } from '../../lib/i18n';

export default function CreateTeam() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [competition, setCompetition] = useState('');
  const [description, setDescription] = useState('');
  const [spots, setSpots] = useState('');
  const [skills, setSkills] = useState('');
  const [saving, setSaving] = useState(false);
  const skillList = parseSkills(skills);

  async function save() {
    if (!name.trim()) return notify(t('Name your team'));
    setSaving(true);
    // try/finally: if anything throws (a network blip mid-way), the button
    // must stop spinning — it used to stay stuck until a page reload.
    try {
      const { team, error } = await createTeam({ name: name.trim(), competition, description, spots, skillsNeeded: skillList });
      if (error) return notify(t('Could not create'), error.message);
      notify(t('Team created'), t('Now invite people from the team screen.'));
      router.replace(`/team/${team.id}`);
    } catch (e) {
      notify(t('Could not create'), e?.message ?? t('Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={type.h1}>{t('Create a team')}</Text>
        <Text style={styles.sub}>{t('An organizer approves new teams before they can apply to events.')}</Text>
        <TextField label={t('Team name')} value={name} onChangeText={setName} placeholder="Code Ninjas" maxLength={80} />
        <TextField label={t('Competition')} value={competition} onChangeText={setCompetition} placeholder="Inha Hackathon 2026" />
        <TextField label={t('Spots')} value={spots} onChangeText={setSpots} placeholder="4" keyboardType="number-pad" />
        <TextField
          label={t('Skills you need')}
          icon="construct-outline"
          value={skills}
          onChangeText={setSkills}
          placeholder={t('e.g. React, UI design, public speaking')}
          hint={t('Separate with commas. Students with these skills see your team first.')}
        />
        {skillList.length > 0 && (
          <View style={styles.chips}>
            {skillList.map((s) => <Chip key={s} text={s} icon="checkmark" />)}
          </View>
        )}
        <TextField label={t('Description')} value={description} onChangeText={setDescription}
          placeholder={t("What you're looking for in teammates")} multiline inputStyle={{ minHeight: 100, textAlignVertical: 'top' }} />
        <Button title={t('Create team')} icon="people" onPress={save} loading={saving} style={{ marginTop: 22 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 620, alignSelf: 'center' },
  sub: { ...type.small, marginTop: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
});

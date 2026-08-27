import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { colors, radius, CATEGORIES } from '../lib/theme';
import { Button, Card } from '../components/ui';

export default function Coach() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const [tip, setTip] = useState(null);
  const [suggestion, setSuggestion] = useState(null);

  const analyze = useCallback(async () => {
    // Pull the user's applications to understand what they've done so far.
    const { data: apps } = await supabase
      .from('applications')
      .select('post:posts(kind, category)')
      .eq('applicant_id', session.user.id);

    const kinds = (apps ?? []).map((a) => a.post?.kind).filter(Boolean);
    const counts = kinds.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});

    // Simple heuristic coach. Swap this block for a call to your LLM endpoint
    // (see README "AI coach") to get richer, personalised advice.
    let gap = 'leadership';
    let recommendKind = 'mun';
    if (!counts.mun) { gap = 'communication & debate'; recommendKind = 'mun'; }
    else if (!counts.internship) { gap = 'professional experience'; recommendKind = 'internship'; }
    else if (!counts.event) { gap = 'teamwork & hackathons'; recommendKind = 'event'; }
    else { gap = 'breadth — try something new'; recommendKind = 'request'; }

    setTip(
      `Your profile shows strength in ${Object.keys(counts)[0] ?? 'getting started'}, but limited ${gap}. ` +
      `Adding a ${CATEGORIES[recommendKind]?.label ?? 'new'} activity would raise your growth score the most.`
    );

    // Find one concrete open post to suggest.
    const { data: match } = await supabase
      .from('posts')
      .select('*')
      .eq('kind', recommendKind)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle();
    setSuggestion(match);
  }, [session]);

  useFocusEffect(useCallback(() => { analyze(); }, [analyze]));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 18 }}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>🧭 AI Career Coach</Text>
        <Text style={styles.heroBody}>{tip ?? 'Analyzing your activity…'}</Text>
      </View>

      <Text style={styles.h2}>Suggested next step</Text>
      {suggestion ? (
        <Card onPress={() => router.push(`/post/${suggestion.id}`)}>
          <Text style={styles.name}>{suggestion.title}</Text>
          <Text style={styles.meta}>{suggestion.category ?? CATEGORIES[suggestion.kind]?.label} · {suggestion.location ?? suggestion.city}</Text>
          <Text style={styles.cta}>→ View & apply</Text>
        </Card>
      ) : (
        <Text style={styles.empty}>No matching open post right now — check the feed for new opportunities.</Text>
      )}

      <Button title="Back to profile" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: 18 },
  heroTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  heroBody: { color: 'rgba(255,255,255,0.85)', fontSize: 13.5, marginTop: 8, lineHeight: 20 },
  h2: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  name: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 4 },
  cta: { color: colors.brand, fontWeight: '700', marginTop: 10 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 21 },
});

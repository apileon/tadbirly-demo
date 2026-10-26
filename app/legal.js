import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, type, column } from '../lib/theme';
import { Button, Section as UISection } from '../components/ui';
import { useAuth } from '../lib/auth';
import { deleteAccount } from '../lib/moderation';
import { notify, confirmAsync } from '../lib/notify';
import { t } from '../lib/i18n';

// ============================================================
//  Privacy Policy · Terms of Use · Community Rules · Contact
//  Shown in the app at /legal, publicly at /privacy, and inside the
//  sign-up screen. Store listings should link to <PUBLIC_URL>/privacy.
// ============================================================

// ⚠️ DEVELOPER — CHECK THESE BEFORE SUBMITTING TO THE STORES ⚠️
// SUPPORT_EMAIL must be a real inbox someone reads daily: Apple and Google
// both check it, and users use it to request data deletion.
export const SUPPORT_EMAIL = 'support@tadbirly.uz';      // ← SUPPORT_EMAIL: replace with your monitored inbox
export const OPERATOR_NAME = 'Tadbirly';                  // ← the legal name of the person/company running the app
export const PUBLIC_URL = 'https://tadbirly.expo.app';    // ← where the web app is hosted
export const POLICY_UPDATED = '5 October 2026';

const open = (url) => Linking.openURL(url).catch(() => {});
const mail = (subject) => open(`mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`);

// Headings, labels and buttons go through t(); the long legal paragraphs
// stay in English here and are translated separately.

// A tappable link inside running text.
function A({ href, onPress, children }) {
  return (
    <Text style={s.link} accessibilityRole="link" onPress={onPress ?? (() => open(href))}>
      {children}
    </Text>
  );
}
function Mail({ subject }) {
  return <A onPress={() => mail(subject)}>{SUPPORT_EMAIL}</A>;
}

// The shared card section, with the brand-coloured headings of a document.
function Section({ title, children }) {
  return <UISection title={title} titleStyle={s.sectionTitle}>{children}</UISection>;
}
const P = ({ children }) => <Text style={s.p}>{children}</Text>;
const H = ({ children }) => <Text style={s.h3}>{children}</Text>;
const Li = ({ children }) => (
  <View style={s.li}>
    <Text style={s.bullet}>•</Text>
    <Text style={s.liText}>{children}</Text>
  </View>
);

// The whole document. Used by /legal, /privacy and the sign-up screen.
export function LegalDocument() {
  return (
    <View>
      <Text style={s.updated}>{t('Last updated: {date}', { date: POLICY_UPDATED })}</Text>

      <Section title={t('In short')}>
        <P>
          Tadbirly helps students find events, apply, build teams and connect. We collect only what is needed to
          run it, we never sell your data, there are no ads and no tracking, and you can delete your account and
          its data at any time from the app. Abusive content and abusive users are not tolerated: you can report
          or block anyone, and we act on reports within 24 hours.
        </P>
      </Section>

      {/* ------------------------------------------------------------ */}
      <Section title={t('Terms of Use')}>
        <P>
          By creating an account or using Tadbirly (the app and {PUBLIC_URL}) you agree to these Terms, the
          Community Rules and the Privacy Policy below. Tadbirly is run by {OPERATOR_NAME} ("we").
        </P>
        <H>{t('Who can use Tadbirly')}</H>
        <Li>You must be at least 13 years old. If you are under 18, you need permission from a parent or guardian to use Tadbirly.</Li>
        <Li>Give accurate information about yourself and keep your password private. You are responsible for what happens in your account.</Li>
        <Li>One person, one account. Don't pretend to be someone else or a school or organization you don't represent.</Li>
        <H>{t('Your content')}</H>
        <Li>You own what you post (events, news, comments, messages, photos). You give us permission to store and show it to the people it is meant for, only to run the service.</Li>
        <Li>Only post things you have the right to share. You are responsible for your content and for following local laws.</Li>
        <H>{t('Events')}</H>
        <Li>Events are organized by users, not by Tadbirly. Organizers are responsible for their events, their accuracy and the safety of participants. Use common sense, meet in public places and tell a parent or guardian where you are going if you are under 18.</Li>
        <H>{t('Our rights')}</H>
        <Li>We may remove any content and suspend or delete any account that breaks these Terms or the Community Rules, without notice, especially to protect other users.</Li>
        <Li>Tadbirly is provided "as is". We work hard to keep it running and safe but cannot guarantee it is always available or error-free. To the extent allowed by law, we are not liable for events organized by users or for content posted by users.</Li>
        <Li>We may update these Terms. If the change is important we will tell you in the app. Continuing to use Tadbirly means you accept the new version.</Li>
      </Section>

      {/* ------------------------------------------------------------ */}
      <Section title={t('Community Rules')}>
        <P>
          Tadbirly has <Text style={s.b}>zero tolerance for objectionable content and abusive users.</Text> Many of
          our users are school students. Do not post, send or share:
        </P>
        <Li>Harassment, bullying, threats, intimidation or hate based on who someone is.</Li>
        <Li>Sexual content, nudity or sexual messages of any kind — and never anything sexual involving or directed at a minor.</Li>
        <Li>Violence, self-harm encouragement, weapons, drugs or anything illegal.</Li>
        <Li>Spam, scams, fake events, pyramid schemes or misleading offers.</Li>
        <Li>Other people's personal information (phone, address, photos) without their consent.</Li>
        <Li>Impersonation of people, schools or organizations.</Li>
        <H>{t('Report and block')}</H>
        <P>
          Every profile, event, news post, comment, team and chat has a Report option (the flag icon). You can also block a
          person: they can no longer message you or send you friend requests, and their content is hidden from you.
          Reports are anonymous to the person reported.
        </P>
        <H>{t('What we do')}</H>
        <P>
          We review every report within 24 hours. Content that breaks these rules is removed and the user who
          posted it is warned, suspended or permanently removed. In an emergency, contact local authorities first.
          To reach us directly: <Mail subject="Tadbirly report" />.
        </P>
      </Section>

      {/* ------------------------------------------------------------ */}
      <Section title={t('Privacy Policy')}>
        <H>{t('What we collect')}</H>
        <Li><Text style={s.b}>Account:</Text> your name, email address and password (stored only in encrypted, hashed form), and when you accepted these Terms.</Li>
        <Li><Text style={s.b}>Student Passport (optional):</Text> school or university, faculty, major, academic year, city, bio, skills, languages, honors, test scores (IELTS, SAT, ACT, Milliy Sertifikat), profile photo and cover photo.</Li>
        <Li><Text style={s.b}>Contact details (optional):</Text> phone number, Telegram username, LinkedIn link.</Li>
        <Li><Text style={s.b}>Activity:</Text> events you post or apply to, check-ins, medals and awards, reliability score, streaks, friends, teams, likes and notifications.</Li>
        <Li><Text style={s.b}>Content:</Text> direct messages, event group-chat messages, news posts, comments and photos you upload.</Li>
        <Li><Text style={s.b}>Safety:</Text> reports you file or that are filed about you, and the people you block.</Li>
        <Li><Text style={s.b}>Push notifications (if you allow them):</Text> a device push token and subscription ID, device type, operating system, language and app version, processed by OneSignal and linked to your account ID.</Li>
        <Li><Text style={s.b}>Telegram (only if you connect the Tadbirly bot):</Text> your Telegram chat ID and username, so we can send your notifications there.</Li>
        <Li><Text style={s.b}>Technical logs:</Text> IP address, browser/app type and timestamps, kept briefly by our hosting providers for security and debugging.</Li>
        <P>
          We do <Text style={s.b}>not</Text> collect your precise location, your contacts or advertising identifiers,
          we show no ads, we do not track you across other apps or websites, and we never sell your data.
        </P>

        <H>{t('Why we use it')}</H>
        <Li>To run your account and show your profile, events, applications, chats and teams (needed to provide the service).</Li>
        <Li>To let organizers review applicants and award medals, and to compute rankings and reliability scores.</Li>
        <Li>To send notifications you asked for (in-app, push, Telegram).</Li>
        <Li>To keep users safe: handle reports, enforce blocks and the Community Rules, prevent abuse.</Li>
        <Li>To give AI Career Coach suggestions, only when you use that feature.</Li>

        <H>{t('Who can see your information')}</H>
        <Li>Your name, photo, Student Passport and pinned achievements are visible to other <Text style={s.b}>signed-in</Text> Tadbirly users. Nothing is visible to people who are not logged in.</Li>
        <Li>Your phone, Telegram and LinkedIn are shown only to your accepted friends, to organizers of events you applied to, and (if you organize events) to people who applied to your events.</Li>
        <Li>Direct messages are visible only to the two people in the chat; an event chat only to its organizer and accepted participants.</Li>
        <Li>Organizers see the Passport and application of everyone who applies to their events.</Li>

        <H>{t('Service providers that process data for us')}</H>
        <Li><A href="https://supabase.com/privacy">Supabase</A> — database, login, file storage and server functions (all account data).</Li>
        <Li><A href="https://onesignal.com/privacy_policy">OneSignal</A> — push notifications (device data, account ID, notification text).</Li>
        <Li><A href="https://telegram.org/privacy">Telegram</A> — notifications through the Tadbirly bot, only if you connect it.</Li>
        <Li><A href="https://expo.dev/privacy">Expo</A> — hosting of the web app, app builds and app updates (technical logs).</Li>
        <Li><A href="https://www.anthropic.com/legal/privacy">Anthropic</A> — the AI behind the AI Career Coach. Only the information needed for a suggestion (for example your applications and Passport fields) is sent, only when you use the coach. Under Anthropic's commercial terms it is not used to train their models.</Li>
        <P>
          These providers may store data on servers outside your country. They only process it on our
          instructions. We share data with authorities only when the law requires it, or to protect someone's
          safety.
        </P>

        <H>{t('How long we keep it')}</H>
        <Li>Your account data is kept while your account exists.</Li>
        <Li>Messages, posts and comments are kept until you delete them or delete your account.</Li>
        <Li>When you delete your account, your profile, photos, posts, applications, messages, comments, likes, friends, teams, notifications, reports and blocks are deleted immediately from the live system, and from backups within 30 days.</Li>
        <Li>Technical logs kept by our providers are deleted automatically, usually within 90 days.</Li>

        <H>{t('Deleting your account')}</H>
        <P>
          In the app: Profile → Privacy &amp; account → <Text style={s.b}>Delete my account</Text>. On the web: log in
          at <A href={`${PUBLIC_URL}/legal`}>{PUBLIC_URL}/legal</A> and use the same button. If you can't log in,
          email <Mail subject="Delete my Tadbirly account" /> from the address you signed up with and we will delete
          it within 30 days.
        </P>

        <H>{t('Your rights')}</H>
        <P>
          You can see and correct your data in your Student Passport, turn off push notifications at any time in
          your device settings, disconnect Telegram, and ask us for a copy of your data or to delete it by writing
          to <Mail subject="My Tadbirly data" />. We answer within 30 days.
        </P>

        <H>{t('Children and teenagers')}</H>
        <P>
          Tadbirly is for students aged 13 and over. We do not knowingly collect data from children under 13; if
          you believe a child under 13 has an account, email <Mail subject="Under-13 account" /> and we will delete
          it. Users under 18 need a parent's or guardian's permission. To protect younger users, contact details
          are hidden from strangers, profiles are visible only to signed-in users, and anyone can be reported or
          blocked. Parents and guardians may contact us to review or delete their child's data.
        </P>

        <H>{t('Security')}</H>
        <P>
          Data is encrypted in transit (HTTPS), passwords are hashed, and database access rules ensure people can
          only reach what they are allowed to see. No system is perfectly secure; if we learn of a breach that
          affects you, we will tell you.
        </P>

        <H>{t('Changes')}</H>
        <P>
          If we change this policy we will update the date above and, for important changes, tell you in the app.
        </P>
      </Section>

      {/* ------------------------------------------------------------ */}
      <Section title={t('Contact')}>
        <P>
          Questions, data requests or safety concerns: <Mail subject="Tadbirly" />{'\n'}
          Operator: {OPERATOR_NAME}{'\n'}
          This page online: <A href={`${PUBLIC_URL}/privacy`}>{PUBLIC_URL}/privacy</A>
        </P>
      </Section>
    </View>
  );
}

export default function Legal() {
  const router = useRouter();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    const ok = await confirmAsync(
      t('Delete account?'),
      t('This permanently removes your profile, photos, posts, applications and messages. This cannot be undone.'),
      t('Delete')
    );
    if (!ok) return;
    try {
      setBusy(true);
      await deleteAccount();
      notify(t('Account deleted'), t('Your account and its data have been deleted.'));
    } catch (e) {
      setBusy(false);
      notify(t('Could not delete'), `${e?.message ?? t('Try again.')}\n\n${t('If this keeps happening, email {email}.', { email: SUPPORT_EMAIL })}`);
    }
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace(session ? '/(tabs)' : '/(auth)/login');
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={s.page}>
      <Text style={s.h1}>{t('Privacy, Terms & Community Rules')}</Text>

      <LegalDocument />

      {session ? (
        <View style={s.danger}>
          <View style={s.dangerHead}>
            <Ionicons name="warning-outline" size={16} color={colors.danger} />
            <Text style={s.dangerTitle}>{t('Danger zone')}</Text>
          </View>
          <Text style={s.dangerText}>{t('Deleting your account removes all of its data permanently.')}</Text>
          <Button title={t('Delete my account')} icon="trash-outline" variant="danger" loading={busy} onPress={confirmDelete} />
        </View>
      ) : null}

      <Button title={session ? t('Back') : t('Back to Tadbirly')} icon="chevron-back" variant="ghost" style={{ marginTop: 12 }} onPress={back} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 18, paddingBottom: 40, ...column },
  h1: { ...type.h1, marginBottom: 6 },
  updated: { ...type.small, fontSize: 12, marginBottom: 12 },
  sectionTitle: { fontSize: 12.5, color: colors.brand, fontWeight: '800' },
  h3: { fontSize: 14, fontWeight: '800', color: colors.ink, marginTop: 12, marginBottom: 6 },
  p: { fontSize: 13.5, lineHeight: 21, color: colors.body, marginBottom: 6 },
  b: { fontWeight: '800', color: colors.ink },
  li: { flexDirection: 'row', gap: 8, marginBottom: 5, paddingRight: 4 },
  bullet: { fontSize: 13.5, lineHeight: 21, color: colors.muted },
  liText: { flex: 1, fontSize: 13.5, lineHeight: 21, color: colors.body },
  link: { color: colors.brand, fontWeight: '700', textDecorationLine: 'underline' },
  danger: { borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerSoft, borderRadius: radius.lg, padding: 16, marginTop: 4 },
  dangerHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  dangerTitle: { fontSize: 13, fontWeight: '800', color: colors.danger },
  dangerText: { fontSize: 12.5, color: colors.ink, marginBottom: 10, lineHeight: 18 },
});

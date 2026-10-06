import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow } from '../lib/theme';
import { t } from '../lib/i18n';
import { canDrawQr } from '../lib/native';

// What the organizer's scanner reads. The code is a random id per
// application (applications.checkin_code), useless outside this event.
export const ticketValue = (postId, code) => `tadbirly:checkin:${postId}:${code}`;

export function parseTicket(value) {
  const m = /^tadbirly:checkin:([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec(String(value ?? '').trim());
  return m ? { postId: m[1], code: m[2] } : null;
}

// Loaded only when it can be drawn (see lib/native.js).
const QRCode = canDrawQr() ? require('react-native-qrcode-svg').default : null;

// The participant's ticket: shown on the event page once accepted.
export default function Ticket({ postId, code, name, checkedIn }) {
  return (
    <View style={styles.ticket}>
      <View style={styles.head}>
        <Ionicons name="ticket-outline" size={18} color={colors.brand} />
        <Text style={styles.title}>{t('Your ticket')}</Text>
        {checkedIn ? (
          <View style={styles.in}>
            <Ionicons name="checkmark-circle" size={13} color={colors.accent} />
            <Text style={styles.inText}>{t('Checked in')}</Text>
          </View>
        ) : null}
      </View>
      {/* White square behind the code in both themes: scanners need contrast. */}
      {canDrawQr() ? (
        <View style={styles.qrBox}>
          <QRCode value={ticketValue(postId, code)} size={180} backgroundColor="#ffffff" color="#111511" />
        </View>
      ) : (
        <Text style={styles.update}>{t('Update Tadbirly to see your QR ticket.')}</Text>
      )}
      {name ? <Text style={styles.name}>{name}</Text> : null}
      <Text style={styles.hint}>{t('Show this to the organizer at the entrance.')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: { backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.line, padding: 18, alignItems: 'center', marginBottom: 12, ...shadow.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  in: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accentSoft, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 8 },
  inText: { fontSize: 11.5, fontWeight: '700', color: colors.accent },
  qrBox: { backgroundColor: '#ffffff', padding: 14, borderRadius: radius.md, marginTop: 14 },
  name: { fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: 12 },
  update: { fontSize: 13.5, color: colors.muted, marginTop: 14, textAlign: 'center' },
  hint: { fontSize: 12.5, color: colors.muted, marginTop: 4, textAlign: 'center' },
});

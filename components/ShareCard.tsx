import { forwardRef } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { lightColors, radius, spacing } from '../lib/theme';
import { t } from '../lib/i18n';

import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

export interface ShareCardColor { hex: string; label: string; sublabel?: string; }
interface Props { title: string; colors: ShareCardColor[]; }

const ShareCard = forwardRef<View, Props>(({ title, colors }, ref) => (
  <View ref={ref} collapsable={false} style={styles.card}>
    <Text style={styles.title}>{title}</Text>
    {colors.map((color, index) => <View key={`${color.label}-${index}`} style={styles.row}>
      <View style={[styles.swatch, { backgroundColor: color.hex }]} />
      <View style={styles.texts}><Text style={styles.label}>{color.label}</Text>{color.sublabel ? <Text style={styles.sublabel}>{color.sublabel}</Text> : null}</View>
    </View>)}
    <View style={styles.footer}><Text style={styles.appName}>Colorack</Text><Text style={styles.url}>https://apps.apple.com/app/id6789651166</Text><Text style={styles.url}>https://play.google.com/store/apps/details?id=com.sugawalabo.colorack</Text></View>
  </View>
));
ShareCard.displayName = 'ShareCard';

export async function shareCardAsImage(ref: React.RefObject<View | null>): Promise<void> {
  try {
    if (!await Sharing.isAvailableAsync()) return Alert.alert('Colorack', t('shareUnavailable'));
    await Sharing.shareAsync(await captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' }), { mimeType: 'image/png' });
  } catch { Alert.alert('Colorack', t('shareFailed')); }
}

export default ShareCard;

const styles = StyleSheet.create({
  card: { position: 'absolute', left: -10000, top: 0, width: 360, padding: spacing.xxl, gap: spacing.md, backgroundColor: lightColors.surface },
  title: { color: lightColors.text, fontSize: 22, fontWeight: '700', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: lightColors.surfaceAlt },
  swatch: { width: 44, height: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: lightColors.border },
  texts: { flex: 1, gap: 2 }, label: { color: lightColors.text, fontSize: 15, fontWeight: '700' }, sublabel: { color: lightColors.textMuted, fontSize: 12 },
  footer: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: lightColors.borderLight, gap: 2 }, appName: { color: lightColors.text, fontSize: 13, fontWeight: '700' }, url: { color: lightColors.textMuted, fontSize: 9 },
});

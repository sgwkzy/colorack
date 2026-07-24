import { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconArchive, IconBox, IconBriefcase, IconBuildingWarehouse, IconFlask, IconPackage } from '@tabler/icons-react-native';
import { t, useLocale } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';

export type BoxIcon = 'box' | 'archive' | 'briefcase' | 'warehouse' | 'package' | 'flask' | 'stack';
export interface BoxDraft { name: string; icon: BoxIcon; color: string; }
interface Props { visible: boolean; title: string; initial?: BoxDraft; onSave: (draft: BoxDraft) => void; onClose: () => void; }

const COLORS = [
  { value: '#4a90d9', label: { ja: '青', en: 'Blue' } }, { value: '#b85a0a', label: { ja: '橙', en: 'Orange' } },
  { value: '#6a5acd', label: { ja: '紫', en: 'Purple' } }, { value: '#2f7d55', label: { ja: '緑', en: 'Green' } },
  { value: '#8b5e3c', label: { ja: '茶', en: 'Brown' } },
];
const ICONS: { value: BoxIcon; Icon: typeof IconBox; label: { ja: string; en: string } }[] = [
  { value: 'box', Icon: IconBox, label: { ja: '箱', en: 'Box' } }, { value: 'archive', Icon: IconArchive, label: { ja: 'アーカイブ', en: 'Archive' } }, { value: 'briefcase', Icon: IconBriefcase, label: { ja: 'ブリーフケース', en: 'Briefcase' } },
  { value: 'warehouse', Icon: IconBuildingWarehouse, label: { ja: '倉庫', en: 'Warehouse' } }, { value: 'package', Icon: IconPackage, label: { ja: '荷物', en: 'Package' } }, { value: 'flask', Icon: IconFlask, label: { ja: 'フラスコ', en: 'Flask' } },
];

export default function BoxEditorModal({ visible, title, initial, onSave, onClose }: Props) {
  useModalLock(visible);
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<BoxIcon>('box');
  const [color, setColor] = useState(COLORS[0].value);
  useEffect(() => { if (visible) { setName(initial?.name ?? ''); setIcon(initial?.icon ?? 'box'); setColor(initial?.color ?? COLORS[0].value); } }, [visible, initial]);
  const save = () => { if (name.trim()) { onSave({ name: name.trim(), icon, color }); onClose(); } };

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}><View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <ClearableInput style={styles.input} value={name} onChangeText={setName} autoFocus />
      <View style={styles.row}>{ICONS.map(({ value, Icon, label }) => <TouchableOpacity key={value} style={[styles.iconChoice, icon === value && styles.selected]} onPress={() => setIcon(value)} accessibilityRole="radio" accessibilityLabel={locale === 'ja' ? label.ja : label.en} accessibilityState={{ selected: icon === value }}><Icon color={color} size={24} /></TouchableOpacity>)}</View>
      <View style={styles.row}>{COLORS.map(({ value, label }) => <TouchableOpacity key={value} style={[styles.colorChoice, { backgroundColor: value }, color === value && styles.selectedColor]} onPress={() => setColor(value)} accessibilityRole="radio" accessibilityLabel={locale === 'ja' ? label.ja : label.en} accessibilityState={{ selected: color === value }} />)}</View>
      <View style={styles.actions}><TouchableOpacity style={styles.button} onPress={onClose}><Text style={styles.cancel}>{t('cancel')}</Text></TouchableOpacity><TouchableOpacity style={[styles.button, styles.save, !name.trim() && styles.saveDisabled]} onPress={save} disabled={!name.trim()}><Text style={styles.saveText}>{t('save')}</Text></TouchableOpacity></View>
    </View></View>
  </Modal>;
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: 'rgba(0,0,0,0.35)' },
  card: { width: '100%', maxWidth: 360, padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.surface },
  title: { marginBottom: spacing.lg, color: colors.text, fontSize: 17, fontWeight: '700' },
  input: { minHeight: touch.min, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.text },
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  iconChoice: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  colorChoice: { width: touch.min, height: touch.min, borderRadius: touch.min / 2 },
  selectedColor: { borderWidth: 3, borderColor: colors.surface, outlineColor: colors.text, outlineWidth: 1 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xl },
  button: { minWidth: 72, minHeight: touch.min, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, marginLeft: spacing.md },
  save: { backgroundColor: colors.primary }, saveDisabled: { backgroundColor: colors.primaryDisabled },
  cancel: { color: colors.primaryText, fontWeight: '700' }, saveText: { color: colors.onPrimary, fontWeight: '700' },
});

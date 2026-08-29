import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { IconChevronLeft, IconPlus, IconTrash } from '@tabler/icons-react-native';
import { brandLabel } from '../lib/brands';
import { mixHexColors } from '../lib/colorMix';
import {
  MixDraft,
  MixDraftError,
  MixDraftPaint,
  normalizedPercent,
  removeDraftPaint,
  tryAddDraftPaint,
  validateMixDraft,
} from '../lib/colorMixDraft';
import { getDB } from '../lib/db';
import { getLocale, t, useLocale } from '../lib/i18n';
import { paintName, seriesLabel } from '../lib/paintLabel';
import { paintTypeLabel } from '../lib/paintType';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import ColorMatcher from './AddPaint/ColorMatcher';
import HierarchyBrowser from './AddPaint/HierarchyBrowser';

interface Props {
  initialDraft: MixDraft;
  onSave: (draft: MixDraft) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  saveLabel?: string;
}

const PAINT_TYPES = ['ラッカー塗料', '水性アクリル塗料', 'エナメル塗料', 'エマルジョン系水性塗料'];
const ERROR_TEXT: Record<MixDraftError, { ja: string; en: string }> = {
  empty: { ja: '塗料を1色以上選択してください', en: 'Select at least one paint.' },
  duplicate: { ja: '同じ塗料は重複して追加できません', en: 'The same paint cannot be added twice.' },
  max_paints: { ja: '混色に使える塗料は5色までです', en: 'A mix can contain up to five paints.' },
  paint_type_mismatch: { ja: '同じ塗料種別の色だけを組み合わせられます', en: 'Only paints of the same type can be mixed.' },
  invalid_hex: { ja: '色情報が不正な塗料は混色できません', en: 'This paint does not have valid color data.' },
  invalid_parts: { ja: '比率は1〜9999の整数で入力してください', en: 'Enter each part as a whole number from 1 to 9999.' },
};

type PickerPaint = { id: number };

export default function ColorMixEditor({ initialDraft, onSave, onDirtyChange, saveLabel }: Props) {
  useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const initialKey = JSON.stringify(initialDraft);
  const [draft, setDraft] = useState<MixDraft>(() => ({ ...initialDraft, paints: [...initialDraft.paints] }));
  const [partTexts, setPartTexts] = useState<Record<number, string>>(() => Object.fromEntries(initialDraft.paints.map((paint) => [paint.paint_id, String(paint.parts)])));
  const [paintType, setPaintType] = useState<string | null>(initialDraft.paints[0]?.paint_type ?? null);
  const [step, setStep] = useState<'edit' | 'pick'>('edit');
  const [tab, setTab] = useState<'hierarchy' | 'colorMatch'>('hierarchy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft({ ...initialDraft, paints: [...initialDraft.paints] });
    setPartTexts(Object.fromEntries(initialDraft.paints.map((paint) => [paint.paint_id, String(paint.parts)])));
    setPaintType(initialDraft.paints[0]?.paint_type ?? null);
    setStep('edit');
    setError('');
  }, [initialKey]);

  const dirty = JSON.stringify(draft) !== initialKey;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const resultHex = useMemo(() => {
    if (draft.paints.length === 0 || draft.paints.some((paint) => !paint.hex || !/^#?[0-9a-fA-F]{6}$/.test(paint.hex))) return null;
    return mixHexColors(draft.paints.map((paint) => ({ hex: paint.hex as string, ratio: Math.max(paint.parts, 0) })));
  }, [draft.paints]);

  const showDraftError = (draftError: MixDraftError) => {
    const message = ERROR_TEXT[draftError][getLocale() === 'en' ? 'en' : 'ja'];
    setError(message);
    Alert.alert(t('inputError'), message);
  };

  const addPaint = async (picked: PickerPaint) => {
    const paint = await getDB().getFirstAsync<{
      id: number; name_ja: string; name_en: string | null; brand: string; series: string;
      series_en: string | null; code: string; hex: string | null; paint_type: string | null;
    }>(
      'SELECT id, name_ja, name_en, brand, series, series_en, code, hex, paint_type FROM catalog_paints WHERE id = ?',
      [picked.id]
    );
    if (!paint) return;
    const candidate: Omit<MixDraftPaint, 'parts'> = {
      paint_id: paint.id,
      name_ja: paint.name_ja,
      name_en: paint.name_en,
      brand: paint.brand,
      series: paint.series,
      series_en: paint.series_en,
      code: paint.code,
      hex: paint.hex,
      paint_type: paint.paint_type,
    };
    const next = tryAddDraftPaint(draft.paints, candidate);
    if (next.error) { showDraftError(next.error); return; }
    setDraft((current) => ({ ...current, paints: next.paints }));
    setPartTexts((current) => ({ ...current, [paint.id]: '1' }));
    setError('');
  };

  const updateParts = (paintId: number, value: string) => {
    const digits = value.replace(/[^0-9]/g, '').slice(0, 4);
    setPartTexts((current) => ({ ...current, [paintId]: digits }));
    setDraft((current) => ({
      ...current,
      paints: current.paints.map((paint) => paint.paint_id === paintId ? { ...paint, parts: digits === '' ? 0 : Number(digits) } : paint),
    }));
  };

  const removePaint = (paintId: number) => {
    setDraft((current) => ({ ...current, paints: removeDraftPaint(current.paints, paintId) }));
    setPartTexts((current) => {
      const next = { ...current };
      delete next[paintId];
      return next;
    });
  };

  const clear = () => {
    if (!dirty) return;
    Alert.alert(t('clearMix'), getLocale() === 'en' ? 'Clear the current mix?' : '現在の配合をすべてクリアしますか？', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('clear'), style: 'destructive', onPress: () => {
          setDraft({ name: '', note: '', paints: [] });
          setPartTexts({});
          setPaintType(null);
          setStep('edit');
          setError('');
        },
      },
    ]);
  };

  const save = async () => {
    if (busy) return;
    const draftError = validateMixDraft(draft);
    if (draftError) { showDraftError(draftError); return; }
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
    } catch (saveError) {
      console.error('ColorMixEditor: failed to save', saveError);
      setError(t('saveFailed'));
      Alert.alert(t('error'), t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.resultCard}>
        <View style={[styles.resultSwatch, { backgroundColor: resultHex ?? colors.chip }]} />
        <View style={styles.resultText}>
          <Text style={styles.sectionLabel}>{t('mixResult')}</Text>
          <Text selectable style={styles.resultHex}>{resultHex?.toUpperCase() ?? (draft.paints.length ? t('cannotCalculateMix') : '—')}</Text>
          {!draft.paints.length ? <Text style={styles.resultHint}>{getLocale() === 'en' ? 'Add paints to preview the mixed color.' : '塗料を追加すると混色結果が表示されます'}</Text> : null}
        </View>
      </View>

      <ClearableInput style={styles.input} value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} placeholder={t('mixName')} />
      <ClearableInput style={[styles.input, styles.noteInput]} value={draft.note} onChangeText={(note) => setDraft((current) => ({ ...current, note }))} placeholder={t('note')} multiline textAlignVertical="top" />

      <View style={styles.selectedHeader}>
        <Text style={styles.sectionTitle}>{t('currentColor')}</Text>
        <Text style={styles.count}>{draft.paints.length}/5</Text>
      </View>
      {draft.paints.map((paint) => (
        <View key={paint.paint_id} style={styles.paintRow} accessibilityLabel={`${brandLabel(paint.brand)} ${seriesLabel(paint.series, paint.series_en)} ${paint.code} ${paintName(paint.name_ja, paint.name_en)}`}>
          <View style={[styles.paintSwatch, { backgroundColor: paint.hex ?? colors.chip }]} />
          <View style={styles.paintInfo}>
            <Text numberOfLines={1} style={styles.paintMeta}>{brandLabel(paint.brand)} · {seriesLabel(paint.series, paint.series_en)}</Text>
            <Text numberOfLines={1} style={styles.paintName}>{paint.code} · {paintName(paint.name_ja, paint.name_en)}</Text>
          </View>
          <TextInput
            accessibilityLabel={`${t('parts')} ${paint.code} ${paintName(paint.name_ja, paint.name_en)}`}
            keyboardType="number-pad"
            maxLength={4}
            style={styles.partsInput}
            value={partTexts[paint.paint_id] ?? String(paint.parts)}
            onChangeText={(value) => updateParts(paint.paint_id, value)}
          />
          <Text style={styles.percent}>{Math.round(normalizedPercent(draft.paints, paint.paint_id))}%</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${t('removeFromMix')} ${paint.code} ${paintName(paint.name_ja, paint.name_en)}`} onPress={() => removePaint(paint.paint_id)} style={styles.iconButton}>
            <IconTrash color={colors.danger} size={19} />
          </TouchableOpacity>
        </View>
      ))}

      {step === 'edit' ? (
        <>
          {!draft.paints.length ? (
            <View style={styles.typeSection}>
              <Text style={styles.sectionLabel}>{t('paintType')}</Text>
              <View style={styles.typeGrid}>
                {PAINT_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    accessibilityRole="button"
                    accessibilityState={{ selected: paintType === type }}
                    style={[styles.typeChip, paintType === type && styles.typeChipActive]}
                    onPress={() => setPaintType(type)}
                  >
                    <Text style={[styles.typeText, paintType === type && styles.typeTextActive]}>{paintTypeLabel(type)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.addButton, (!paintType || draft.paints.length >= 5) && styles.disabled]}
            disabled={!paintType || draft.paints.length >= 5}
            onPress={() => setStep('pick')}
          >
            <IconPlus color={colors.primary} size={20} />
            <Text style={styles.addText}>{t('addPaint')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.pickerSection}>
          <TouchableOpacity accessibilityRole="button" onPress={() => setStep('edit')} style={styles.backButton}>
            <IconChevronLeft color={colors.primary} size={20} />
            <Text style={styles.backText}>{t('back')}</Text>
          </TouchableOpacity>
          <View accessibilityRole="tablist" style={styles.tabs}>
            {(['hierarchy', 'colorMatch'] as const).map((key) => (
              <TouchableOpacity key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.tabActive]}>
                <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{t(key)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.picker}>
            {tab === 'hierarchy'
              ? <HierarchyBrowser paintType={paintType ?? undefined} onSelect={addPaint} onSelectView={addPaint} />
              : <ColorMatcher lockedPaintType={paintType ?? undefined} onSelect={addPaint} onSelectView={addPaint} />}
          </View>
        </View>
      )}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" disabled={!dirty} onPress={clear} style={[styles.clearButton, !dirty && styles.disabled]}>
          <Text style={styles.clearText}>{t('clearMix')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={save} style={[styles.saveButton, busy && styles.disabled]}>
          <Text style={styles.saveText}>{saveLabel ?? t('save')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl },
  resultCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  resultSwatch: { width: 76, height: 76, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  resultText: { flex: 1, gap: spacing.xs },
  resultHex: { color: colors.text, fontSize: 19, fontWeight: '700', fontVariant: ['tabular-nums'] },
  resultHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  input: { minHeight: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  selectedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sectionLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  count: { color: colors.textFaint, fontVariant: ['tabular-nums'] },
  paintRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md },
  paintSwatch: { width: 42, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  paintInfo: { flex: 1, minWidth: 0 },
  paintMeta: { color: colors.textMuted, fontSize: 11 },
  paintName: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 2 },
  partsInput: { width: 48, height: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.text, textAlign: 'center', fontVariant: ['tabular-nums'] },
  percent: { width: 38, color: colors.textMuted, textAlign: 'right', fontVariant: ['tabular-nums'] },
  iconButton: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  typeSection: { gap: spacing.md },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: { minHeight: touch.min, justifyContent: 'center', paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.chip },
  typeChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  typeText: { color: colors.text, fontSize: 13 },
  typeTextActive: { color: colors.primaryText, fontWeight: '700' },
  addButton: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md },
  addText: { color: colors.primaryText, fontWeight: '700' },
  pickerSection: { minHeight: 430, gap: spacing.md },
  backButton: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  backText: { color: colors.primaryText, fontWeight: '600' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  tab: { flex: 1, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: colors.transparent },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { color: colors.textMuted },
  tabTextActive: { color: colors.primaryText, fontWeight: '700' },
  picker: { height: 360 },
  error: { color: colors.dangerText },
  actions: { flexDirection: 'row', gap: spacing.md },
  clearButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  clearText: { color: colors.text },
  saveButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  saveText: { color: colors.onPrimary, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});

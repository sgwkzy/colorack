import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconPlus, IconTrash } from '@tabler/icons-react-native';
import { brandLabel } from '../lib/brands';
import { mixHexColors } from '../lib/colorMix';
import {
  MixDraft,
  MixDraftError,
  MixDraftPaint,
  removeDraftPaint,
  totalPercentage,
  tryAddDraftPaint,
  validateMixDraft,
} from '../lib/colorMixDraft';
import { getDB } from '../lib/db';
import { getLocale, t, useLocale } from '../lib/i18n';
import { paintName, seriesLabel } from '../lib/paintLabel';
import { paintTypeLabel } from '../lib/paintType';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';
import ClearableInput from './ClearableInput';
import ColorMixPaintPickerModal from './ColorMixPaintPickerModal';

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
  invalid_percentage: { ja: '各色の配合率は1〜100%の整数で入力してください', en: 'Enter each paint as a whole percentage from 1 to 100.' },
  invalid_percentage_total: { ja: '配合率の合計を100%にしてください', en: 'The percentages must total 100%.' },
};

type PickerPaint = { id: number };

export default function ColorMixEditor({ initialDraft, onSave, onDirtyChange, saveLabel }: Props) {
  useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const initialKey = JSON.stringify(initialDraft);
  const [draft, setDraft] = useState<MixDraft>(() => ({ ...initialDraft, paints: [...initialDraft.paints] }));
  const paintsRef = useRef<MixDraftPaint[]>([...initialDraft.paints]);
  const [percentageTexts, setPercentageTexts] = useState<Record<number, string>>(() => Object.fromEntries(initialDraft.paints.map((paint) => [paint.paint_id, String(paint.percentage)])));
  const [paintType, setPaintType] = useState<string | null>(initialDraft.paints[0]?.paint_type ?? null);
  const [paintTypeSheetVisible, setPaintTypeSheetVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const paints = [...initialDraft.paints];
    paintsRef.current = paints;
    setDraft({ ...initialDraft, paints });
    setPercentageTexts(Object.fromEntries(initialDraft.paints.map((paint) => [paint.paint_id, String(paint.percentage)])));
    setPaintType(initialDraft.paints[0]?.paint_type ?? null);
    setPaintTypeSheetVisible(false);
    setPickerVisible(false);
    setError('');
  }, [initialKey]);

  const dirty = JSON.stringify(draft) !== initialKey;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const resultHex = useMemo(() => {
    if (draft.paints.length === 0 || draft.paints.some((paint) => !paint.hex || !/^#?[0-9a-fA-F]{6}$/.test(paint.hex))) return null;
    return mixHexColors(draft.paints.map((paint) => ({ hex: paint.hex as string, ratio: Math.max(paint.percentage, 0) })));
  }, [draft.paints]);
  const percentageTotal = totalPercentage(draft.paints);
  const draftError = validateMixDraft(draft);
  const balanceScale = percentageTotal > 100 ? 100 / percentageTotal : 1;
  const footerInvalid = draft.paints.length > 0 && draftError != null;

  const showDraftError = (draftError: MixDraftError) => {
    const message = ERROR_TEXT[draftError][getLocale() === 'en' ? 'en' : 'ja'];
    setError(message);
    Alert.alert(t('inputError'), message);
  };

  const addPaint = async (picked: PickerPaint) => {
    try {
    const paint = await getDB().getFirstAsync<{
      id: number; name_ja: string; name_en: string | null; brand: string; series: string;
      series_en: string | null; code: string; hex: string | null; paint_type: string | null;
    }>(
      'SELECT id, name_ja, name_en, brand, series, series_en, code, hex, paint_type FROM catalog_paints WHERE id = ?',
      [picked.id]
    );
    if (!paint) return false;
    const candidate: Omit<MixDraftPaint, 'percentage'> = {
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
    const next = tryAddDraftPaint(paintsRef.current, candidate);
    if (next.error) { showDraftError(next.error); return false; }
    paintsRef.current = next.paints;
    setDraft((current) => ({ ...current, paints: next.paints }));
    setPercentageTexts(Object.fromEntries(next.paints.map((item) => [item.paint_id, String(item.percentage)])));
    setError('');
    return true;
    } catch (loadError) {
      console.error('ColorMixEditor: failed to load selected paint', loadError);
      const message = getLocale() === 'en' ? 'Unable to load this paint.' : '塗料を読み込めませんでした';
      setError(message);
      Alert.alert(t('error'), message);
      return false;
    }
  };

  const updatePercentage = (paintId: number, value: string) => {
    const digits = value.replace(/[^0-9]/g, '').slice(0, 3);
    const paints = paintsRef.current.map((paint) => paint.paint_id === paintId ? { ...paint, percentage: digits === '' ? 0 : Number(digits) } : paint);
    paintsRef.current = paints;
    setPercentageTexts((current) => ({ ...current, [paintId]: digits }));
    setDraft((current) => ({ ...current, paints }));
  };

  const stepPercentage = (paintId: number, delta: number) => {
    const paint = paintsRef.current.find((item) => item.paint_id === paintId);
    if (!paint) return;
    updatePercentage(paintId, String(Math.min(100, Math.max(1, paint.percentage + delta))));
  };

  const removePaint = (paintId: number) => {
    const paints = removeDraftPaint(paintsRef.current, paintId);
    paintsRef.current = paints;
    setDraft((current) => ({ ...current, paints }));
    setPercentageTexts(Object.fromEntries(paints.map((paint) => [paint.paint_id, String(paint.percentage)])));
  };

  const clear = () => {
    if (!dirty) return;
    Alert.alert(t('clearMix'), getLocale() === 'en' ? 'Clear the current mix?' : '現在の配合をすべてクリアしますか？', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('clear'), style: 'destructive', onPress: () => {
          paintsRef.current = [];
          setDraft({ name: '', note: '', paints: [] });
          setPercentageTexts({});
          setPaintType(null);
          setPaintTypeSheetVisible(false);
          setPickerVisible(false);
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

  const footerMessage = draft.paints.length === 0
    ? (getLocale() === 'en' ? 'Add a paint to begin' : '塗料を追加してください')
    : draftError === 'invalid_percentage'
      ? (getLocale() === 'en' ? 'Set every paint from 1–100%' : '各色を1〜100%に修正')
      : draftError === 'invalid_hex'
        ? (getLocale() === 'en' ? 'Check the paint color data' : '塗料の色情報を確認')
        : draftError && draftError !== 'invalid_percentage_total'
          ? ERROR_TEXT[draftError][getLocale() === 'en' ? 'en' : 'ja']
          : percentageTotal === 100
            ? (getLocale() === 'en' ? 'Ready to save' : '保存できます')
            : percentageTotal < 100
              ? (getLocale() === 'en' ? `${100 - percentageTotal}% remaining` : `残り${100 - percentageTotal}%`)
              : (getLocale() === 'en' ? `${percentageTotal - 100}% over` : `${percentageTotal - 100}%超過`);
  const paintTypeButtons: ActionSheetButton[] = [
    ...PAINT_TYPES.map((type) => ({
      text: `${paintType === type ? '✓ ' : ''}${paintTypeLabel(type)}`,
      onPress: () => setPaintType(type),
    })),
    { text: t('cancel'), style: 'cancel' },
  ];

  return (
    <>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.selectedHeader}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>{getLocale() === 'en' ? 'Paints to mix' : '配合する塗料'}</Text>
              {draft.paints.length && paintType ? <Text style={styles.sectionMeta}>{paintTypeLabel(paintType)}</Text> : null}
            </View>
            <Text style={styles.count}>
              {getLocale() === 'en' ? `${draft.paints.length} colors · max 5` : `${draft.paints.length}色・最大5色`}
            </Text>
          </View>

          {!draft.paints.length ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`${t('paintType')} ${paintType ? paintTypeLabel(paintType) : getLocale() === 'en' ? 'Not selected' : '未選択'}`}
              onPress={() => setPaintTypeSheetVisible(true)}
              style={styles.typeSelect}
            >
              <View style={styles.typeSelectText}>
                <Text style={styles.fieldLabel}>{t('paintType')}</Text>
                <Text style={[styles.typeValue, !paintType && styles.typePlaceholder]}>
                  {paintType ? paintTypeLabel(paintType) : (getLocale() === 'en' ? 'Select a paint type' : '塗料種別を選択')}
                </Text>
              </View>
              <IconChevronDown color={colors.textMuted} size={20} />
            </TouchableOpacity>
          ) : null}

          {draft.paints.map((paint) => {
            const percentageInvalid = !Number.isInteger(paint.percentage) || paint.percentage < 1 || paint.percentage > 100;
            return <View key={paint.paint_id} style={styles.paintCard}>
              <View style={styles.paintIdentity}>
                <View style={[styles.paintSwatch, { backgroundColor: paint.hex ?? colors.chip }]} />
                <View style={styles.paintInfo}>
                  <Text numberOfLines={1} style={styles.paintMeta}>{brandLabel(paint.brand)} · {seriesLabel(paint.series, paint.series_en)}</Text>
                  <Text numberOfLines={1} style={styles.paintName}>{paint.code} · {paintName(paint.name_ja, paint.name_en)}</Text>
                </View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${t('removeFromMix')} ${paint.code} ${paintName(paint.name_ja, paint.name_en)}`} onPress={() => removePaint(paint.paint_id)} style={styles.iconButton}>
                  <IconTrash color={colors.danger} size={19} />
                </TouchableOpacity>
              </View>
              <View style={styles.percentageControls}>
                <Text style={styles.percentageLabel}>{getLocale() === 'en' ? 'Percentage' : '配合率'}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`${paint.code} ${getLocale() === 'en' ? 'decrease by 5 percent' : '5%減らす'}`}
                  accessibilityState={{ disabled: paint.percentage <= 1 }}
                  disabled={paint.percentage <= 1}
                  onPress={() => stepPercentage(paint.paint_id, -5)}
                  style={[styles.stepButton, paint.percentage <= 1 && styles.disabled]}
                >
                  <Text style={styles.stepText}>−5</Text>
                </TouchableOpacity>
                <View style={[styles.percentageInputWrap, percentageInvalid && styles.percentageInputInvalid]}>
                  <TextInput
                    accessibilityLabel={`${getLocale() === 'en' ? 'Percentage' : '配合率'} ${paint.code} ${paintName(paint.name_ja, paint.name_en)}`}
                    accessibilityHint={percentageInvalid
                      ? (getLocale() === 'en'
                        ? 'Enter a whole percentage from 1 to 100.'
                        : '1〜100%の整数で入力してください')
                      : undefined}
                    keyboardType="number-pad"
                    maxLength={3}
                    selectTextOnFocus
                    style={styles.percentageInput}
                    value={percentageTexts[paint.paint_id] ?? String(paint.percentage)}
                    onChangeText={(value) => updatePercentage(paint.paint_id, value)}
                  />
                  <Text style={styles.percentSign}>%</Text>
                </View>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`${paint.code} ${getLocale() === 'en' ? 'increase by 5 percent' : '5%増やす'}`}
                  accessibilityState={{ disabled: paint.percentage >= 100 }}
                  disabled={paint.percentage >= 100}
                  onPress={() => stepPercentage(paint.paint_id, 5)}
                  style={[styles.stepButton, paint.percentage >= 100 && styles.disabled]}
                >
                  <Text style={styles.stepText}>＋5</Text>
                </TouchableOpacity>
              </View>
            </View>;
          })}

          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.addButton, (!paintType || draft.paints.length >= 5) && styles.disabled]}
            disabled={!paintType || draft.paints.length >= 5}
            onPress={() => setPickerVisible(true)}
          >
            <IconPlus color={colors.primary} size={20} />
            <Text style={styles.addText}>{t('addPaint')}</Text>
          </TouchableOpacity>

          <View style={styles.saveDetails}>
            <Text style={styles.sectionTitle}>{getLocale() === 'en' ? 'Save details' : '保存情報'}</Text>
            <Text style={styles.optionalLabel}>{getLocale() === 'en' ? 'Optional' : '任意'}</Text>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('mixName')}</Text>
            <ClearableInput
              accessibilityLabel={t('mixName')}
              style={styles.input}
              value={draft.name}
              onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
              placeholder={getLocale() === 'en' ? 'e.g. Warm skin tone' : '例：暖色の肌色'}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{t('note')}</Text>
            <ClearableInput
              accessibilityLabel={t('note')}
              style={[styles.input, styles.noteInput]}
              value={draft.note}
              onChangeText={(note) => setDraft((current) => ({ ...current, note }))}
              placeholder={getLocale() === 'en' ? 'Add notes about use or finish' : '用途や仕上がりなどを記録'}
              multiline
              textAlignVertical="top"
            />
          </View>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <TouchableOpacity accessibilityRole="button" disabled={!dirty} onPress={clear} style={[styles.clearButton, !dirty && styles.disabled]}>
            <Text style={styles.clearText}>{t('clearMix')}</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerMain}>
            <View
              accessible
              accessibilityLabel={`${t('mixResult')} ${resultHex?.toUpperCase() ?? t('cannotCalculateMix')} ${getLocale() === 'en' ? `Total ${percentageTotal}%` : `合計 ${percentageTotal}%`} ${footerMessage}`}
              style={styles.footerStatus}
            >
              <View style={[styles.footerSwatch, { backgroundColor: resultHex ?? colors.chip }]} />
              <View style={styles.footerStatusText}>
                <View style={styles.footerHeadline}>
                  <Text selectable numberOfLines={1} style={styles.footerHex}>{resultHex?.toUpperCase() ?? '—'}</Text>
                  <Text numberOfLines={1} style={[styles.footerTotal, !draft.paints.length && styles.footerNeutral, footerInvalid && styles.footerInvalid]}>
                    {percentageTotal}%
                  </Text>
                </View>
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.footerHint, !draft.paints.length && styles.footerNeutral, footerInvalid && styles.footerInvalid]}
                  numberOfLines={1}
                >
                  {footerMessage}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || draftError != null }}
              disabled={busy || draftError != null}
              onPress={save}
              style={[styles.saveButton, (busy || draftError != null) && styles.disabled]}
            >
              <Text numberOfLines={1} style={styles.saveText}>{saveLabel ?? t('save')}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.footerMixBar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {draft.paints.map((paint) => (
              <View
                key={paint.paint_id}
                style={[
                  styles.mixBarSegment,
                  {
                    width: `${Math.min(100, Math.max(0, paint.percentage * balanceScale))}%`,
                    backgroundColor: paint.hex ?? colors.chip,
                  },
                ]}
              />
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
      <ColorMixPaintPickerModal
        visible={pickerVisible}
        paintType={paintType ?? ''}
        onSelect={addPaint}
        onClose={() => setPickerVisible(false)}
      />
      <ActionSheet
        visible={paintTypeSheetVisible}
        title={t('paintType')}
        buttons={paintTypeButtons}
        onClose={() => setPaintTypeSheetVisible(false)}
      />
    </>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xl },
  input: { minHeight: touch.min, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, color: colors.text },
  noteInput: { minHeight: 72, alignItems: 'flex-start' },
  selectedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  sectionHeading: { flex: 1, minWidth: 0, gap: 2 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sectionMeta: { color: colors.textMuted, fontSize: 12 },
  count: { color: colors.textFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  mixBarSegment: { height: '100%' },
  paintCard: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md },
  paintIdentity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  paintSwatch: { width: 42, height: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  paintInfo: { flex: 1, minWidth: 0 },
  paintMeta: { color: colors.textMuted, fontSize: 11 },
  paintName: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 2 },
  iconButton: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  percentageControls: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  percentageLabel: { flex: 1, color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  stepButton: { width: 54, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  stepText: { color: colors.primaryText, fontWeight: '700', fontVariant: ['tabular-nums'] },
  percentageInputWrap: { width: 76, minHeight: touch.min, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  percentageInputInvalid: { borderColor: colors.danger },
  percentageInput: { flex: 1, height: touch.min, paddingLeft: spacing.sm, paddingRight: 0, color: colors.text, textAlign: 'right', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  percentSign: { paddingHorizontal: spacing.sm, color: colors.textMuted, fontWeight: '700' },
  typeSelect: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  typeSelectText: { flex: 1, gap: 2 },
  typeValue: { color: colors.text, fontSize: 15, fontWeight: '600' },
  typePlaceholder: { color: colors.textMuted, fontWeight: '400' },
  addButton: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md },
  addText: { color: colors.primaryText, fontWeight: '700' },
  saveDetails: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.sm },
  optionalLabel: { color: colors.textFaint, fontSize: 12 },
  fieldGroup: { gap: spacing.sm },
  fieldLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  error: { color: colors.dangerText },
  clearButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  clearText: { color: colors.text },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surfaceAlt },
  footerMain: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  footerStatus: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footerSwatch: { width: 40, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  footerStatusText: { flex: 1, minWidth: 0 },
  footerHeadline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.xs },
  footerHex: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  footerTotal: { color: colors.success, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  footerHint: { color: colors.success, fontSize: 11, marginTop: 1 },
  footerNeutral: { color: colors.textMuted },
  footerInvalid: { color: colors.dangerText },
  footerMixBar: { height: 12, flexDirection: 'row', overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.chip },
  saveButton: { minWidth: 104, minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary },
  saveText: { color: colors.onPrimary, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});

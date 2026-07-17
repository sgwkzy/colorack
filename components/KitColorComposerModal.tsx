// components/KitColorComposerModal.tsx
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { IconChevronDown, IconChevronLeft, IconChevronUp, IconTrash, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addKitColor } from '../lib/db';
import { mixHexColors } from '../lib/colorMix';
import { t } from '../lib/i18n';
import { paintName } from '../lib/paintLabel';
import { paintTypeLabel } from '../lib/paintType';
import { useModalLock } from '../lib/modalLock';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ClearableInput from './ClearableInput';
import HierarchyBrowser from './AddPaint/HierarchyBrowser';
import ColorMatcher from './AddPaint/ColorMatcher';
import SwipeDownHeader from './SwipeDownHeader';

interface SelectedPaint {
  paintId: number;
  name_ja: string;
  name_en: string | null;
  hex: string;
  ratio: number; // 0-100 (%) while composing; normalized to 0-1 at save time
}

interface Props {
  visible: boolean;
  kitId: number;
  onClose: () => void;
  onAdded: () => void;
}

const MAX_PAINTS = 5;
const TABS = ['hierarchy', 'colorMatch'] as const;
const PAINT_TYPES = ['ラッカー塗料', '水性アクリル塗料', 'エナメル塗料', 'エマルジョン系水性塗料'];

export default function KitColorComposerModal({ visible, kitId, onClose, onAdded }: Props) {
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [step, setStep] = useState<'setup' | 'pick'>('setup');
  const [name, setName] = useState('');
  const [paintType, setPaintType] = useState<string | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]>('hierarchy');
  const [selectedPaints, setSelectedPaints] = useState<SelectedPaint[]>([]);
  const [accordionOpen, setAccordionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canSave = selectedPaints.length > 0;

  useEffect(() => {
    if (visible) {
      setStep('setup');
      setName('');
      setPaintType(null);
      setTab('hierarchy');
      setSelectedPaints([]);
      setAccordionOpen(false);
    }
  }, [visible]);

  const previewHex = useMemo(
    () => mixHexColors(selectedPaints.map((p) => ({ hex: p.hex, ratio: p.ratio }))),
    [selectedPaints]
  );

  const addPaintToMix = (paint: { id: number; name_ja: string; name_en: string | null; hex: string }) => {
    setSelectedPaints((current) => {
      if (current.length >= MAX_PAINTS) return current;
      const next = [...current, { paintId: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex, ratio: 0 }];
      const equalShare = 100 / next.length;
      return next.map((p) => ({ ...p, ratio: equalShare }));
    });
  };

  const removePaintFromMix = (index: number) => {
    setSelectedPaints((current) => {
      const next = current.filter((_, i) => i !== index);
      if (next.length === 0) return next;
      const equalShare = 100 / next.length;
      return next.map((p) => ({ ...p, ratio: equalShare }));
    });
  };

  const setRatio = (index: number, value: string) => {
    const parsed = Number(value.replace(/[^0-9.]/g, ''));
    setSelectedPaints((current) => current.map((p, i) => (i === index ? { ...p, ratio: Number.isFinite(parsed) ? parsed : 0 } : p)));
  };

  const goToPicker = () => {
    if (!paintType) return;
    setStep('pick');
  };

  const backToSetup = () => {
    setSelectedPaints([]);
    setAccordionOpen(false);
    setStep('setup');
  };

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    const total = selectedPaints.reduce((sum, p) => sum + p.ratio, 0);
    const normalized = total > 0
      ? selectedPaints.map((p) => ({ paintId: p.paintId, ratio: p.ratio / total }))
      : selectedPaints.map((p) => ({ paintId: p.paintId, ratio: 1 / selectedPaints.length }));
    try {
      await addKitColor(kitId, name.trim() || null, null, normalized);
      onAdded();
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={onClose}>
            <View style={styles.header}>
              {step === 'pick' ? (
                <TouchableOpacity onPress={backToSetup} hitSlop={8} style={styles.backBtn}>
                  <IconChevronLeft color={colors.primary} size={22} />
                  <Text style={styles.backText}>{t('back')}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.title}>{t('addColor')}</Text>
              )}
              <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityLabel={t('close')}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {step === 'setup' ? (
            <View style={styles.setupContent}>
              <ClearableInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder={t('colorNameLabel')}
              />
              <Text style={styles.sectionLabel}>{t('paintType')}</Text>
              <View style={styles.typeGrid}>
                {PAINT_TYPES.map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.typeChip, paintType === type && styles.typeChipActive]}
                    onPress={() => setPaintType(type)}
                  >
                    <Text style={[styles.typeChipText, paintType === type && styles.typeChipTextActive]}>
                      {paintTypeLabel(type)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.nextBtn, !paintType && styles.nextBtnDisabled]}
                onPress={goToPicker}
                disabled={!paintType}
              >
                <Text style={styles.nextBtnText}>{t('next')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <KeyboardAvoidingView
              style={styles.pickContent}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <View style={styles.tabBar}>
                {TABS.map((tabKey) => (
                  <TouchableOpacity
                    key={tabKey}
                    style={[styles.tabBtn, tab === tabKey && styles.tabBtnActive]}
                    onPress={() => setTab(tabKey)}
                  >
                    <Text style={[styles.tabText, tab === tabKey && styles.tabTextActive]}>{t(tabKey)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.pickerArea}>
                {tab === 'hierarchy' ? (
                  <HierarchyBrowser
                    paintType={paintType ?? undefined}
                    onSelect={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
                    onSelectView={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
                  />
                ) : (
                  <ColorMatcher
                    lockedPaintType={paintType ?? undefined}
                    onSelect={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
                    onSelectView={(paint) => addPaintToMix({ id: paint.id, name_ja: paint.name_ja, name_en: paint.name_en, hex: paint.hex })}
                  />
                )}
              </View>

              <View style={styles.accordion}>
                <TouchableOpacity style={styles.accordionHeader} onPress={() => setAccordionOpen((o) => !o)}>
                  <View style={[styles.previewSwatch, { backgroundColor: previewHex ?? colors.chip }]} />
                  <Text style={styles.accordionTitle}>{t('currentColor')}</Text>
                  {accordionOpen
                    ? <IconChevronDown size={18} color={colors.textMuted} />
                    : <IconChevronUp size={18} color={colors.textMuted} />}
                </TouchableOpacity>
                {accordionOpen && (
                  <View style={styles.paintList}>
                    {selectedPaints.map((p, index) => (
                      <View key={index} style={styles.paintRow}>
                        <View style={[styles.miniSwatch, { backgroundColor: p.hex }]} />
                        <Text numberOfLines={1} style={styles.paintName}>{paintName(p.name_ja, p.name_en)}</Text>
                        <TextInput
                          style={styles.ratioInput}
                          keyboardType="numeric"
                          value={String(Math.round(p.ratio))}
                          onChangeText={(v) => setRatio(index, v)}
                        />
                        <Text style={styles.percentSign}>%</Text>
                        <TouchableOpacity onPress={() => removePaintFromMix(index)} hitSlop={8}>
                          <IconTrash color={colors.danger} size={18} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <TouchableOpacity style={[styles.saveBtn, (!canSave || busy) && styles.saveBtnDisabled]} onPress={save} disabled={!canSave || busy}>
                <Text style={styles.saveBtnText}>{t('save')}</Text>
              </TouchableOpacity>
            </KeyboardAvoidingView>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  title: { fontSize: 18, fontWeight: 'bold', color: colors.text },
  backBtn: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontSize: 15, color: colors.primary, marginLeft: 2 },
  setupContent: { flex: 1, padding: spacing.xl, gap: spacing.lg },
  nameInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 10, color: colors.text },
  sectionLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  typeChip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.chip },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 14, color: colors.text },
  typeChipTextActive: { color: colors.onPrimary, fontWeight: '700' },
  nextBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.md, marginTop: 'auto' },
  nextBtnDisabled: { backgroundColor: colors.primaryDisabled },
  nextBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
  pickContent: { flex: 1 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  tabBtn: { flex: 1, padding: spacing.md, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
  tabText: { fontSize: 13, color: colors.textPlaceholder },
  tabTextActive: { color: colors.primary, fontWeight: 'bold' },
  pickerArea: { flex: 1 },
  accordion: { borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.surfaceAlt },
  accordionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  previewSwatch: { width: 28, height: 28, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  accordionTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  paintList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  paintRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  miniSwatch: { width: 22, height: 22, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  paintName: { flex: 1, fontSize: 13, color: colors.text },
  ratioInput: { width: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 4, color: colors.text, textAlign: 'right' },
  percentSign: { fontSize: 13, color: colors.textMuted },
  saveBtn: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, margin: spacing.xl, borderRadius: radius.md },
  saveBtnDisabled: { backgroundColor: colors.primaryDisabled },
  saveBtnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
});

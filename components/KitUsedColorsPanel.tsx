import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, type ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconGripVertical, IconPlus } from '@tabler/icons-react-native';
import type { AnimatedRef } from 'react-native-reanimated';
import Sortable, { type SortableGridRenderItem } from 'react-native-sortables';
import type { KitColorSummary } from '../lib/db';
import { draftFromSummary, moveMixRecipe, normalizeDraftPaints, sameColorOrder } from '../lib/colorMixDraft';
import { t, useLocale } from '../lib/i18n';
import { lightColors, spacing, useTheme } from '../lib/theme';
import {
  addUsedColor,
  loadUsedColors,
  removeUsedColor,
  reorderUsedColors,
  updateUsedColor,
  type UsedColorLoadResult,
  type UsedColorRepository,
} from '../lib/usedColorOperations';
import KitColorComposerModal from './KitColorComposerModal';
import KitColorRow from './KitColorRow';
import ColorMixDetailModal from './ColorMixDetailModal';
import ColorMixEditorModal from './ColorMixEditorModal';

export type { UsedColorRepository } from '../lib/usedColorOperations';

interface KitUsedColorsPanelProps {
  active: boolean;
  repository: UsedColorRepository;
  ownedMap: Map<number, number>;
  scrollableRef: AnimatedRef<ScrollView>;
  requestCloseRef: MutableRefObject<() => void>;
  onOverlayChange(open: boolean): void;
}

export default function KitUsedColorsPanel({
  active,
  repository,
  ownedMap,
  scrollableRef,
  requestCloseRef,
  onOverlayChange,
}: KitUsedColorsPanelProps) {
  useLocale();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const loadVersionRef = useRef(0);
  const [kitColors, setKitColors] = useState<KitColorSummary[]>([]);
  const [selectedColor, setSelectedColor] = useState<KitColorSummary | null>(null);
  const [colorDetailOpen, setColorDetailOpen] = useState(false);
  const [editingColor, setEditingColor] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);

  const runAndApply = useCallback(async (
    operation: () => Promise<UsedColorLoadResult>,
    showLoading = false,
  ): Promise<boolean> => {
    const loadVersion = ++loadVersionRef.current;
    if (showLoading) setLoadState('loading');
    const result = await operation();
    if (loadVersion !== loadVersionRef.current) return false;
    if (!result.ok) {
      console.error('KitUsedColorsPanel: failed to load used colors', result.error);
      setLoadState('error');
      return false;
    }
    setKitColors(result.colors);
    setLoadState('ready');
    return true;
  }, []);

  const load = useCallback(
    (showLoading = false) => runAndApply(() => loadUsedColors(repository), showLoading),
    [repository, runAndApply],
  );

  useEffect(() => {
    if (!active) {
      loadVersionRef.current += 1;
      setKitColors([]);
      setLoadState('loading');
      setSelectedColor(null);
      setColorDetailOpen(false);
      setEditingColor(false);
      setPickerOpen(false);
      return;
    }
    void load(true);
  }, [active, load]);

  const childOverlayOpen = pickerOpen || editingColor;
  useEffect(() => {
    onOverlayChange(childOverlayOpen);
    return () => onOverlayChange(false);
  }, [childOverlayOpen, onOverlayChange]);

  const saveNewColor = useCallback(async (
    name: string | null,
    note: string | null,
    paints: { paintId: number; ratio: number }[],
  ) => {
    await runAndApply(() => addUsedColor(repository, name, note, paints));
  }, [repository, runAndApply]);

  const removeColor = async (kitColorId: number) => {
    try {
      await runAndApply(() => removeUsedColor(repository, kitColorId, () => {
        setKitColors((current) => current.filter((color) => color.id !== kitColorId));
        setColorDetailOpen(false);
        setSelectedColor(null);
      }));
    } catch (error) {
      console.error('KitUsedColorsPanel: failed to remove used color', error);
      Alert.alert(t('error'), t('saveFailed'));
    }
  };

  const confirmRemoveColor = (color: KitColorSummary) => {
    Alert.alert(color.name || t('mixResult'), t('deleteMixConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => removeColor(color.id) },
    ]);
  };

  const saveColor = async (draft: ReturnType<typeof draftFromSummary>) => {
    if (!selectedColor) return;
    await runAndApply(() => updateUsedColor(
      repository,
      selectedColor.id,
      draft.name.trim() || null,
      draft.note.trim() || null,
      normalizeDraftPaints(draft.paints),
    ));
    setEditingColor(false);
  };

  const saveColorOrder = useCallback(async (next: KitColorSummary[]) => {
    const previous = kitColors;
    if (orderSaving || sameColorOrder(previous, next)) return;
    setKitColors(next);
    setOrderSaving(true);
    try {
      const result = await reorderUsedColors(repository, previous, next);
      if (!result.ok) {
        console.error('KitUsedColorsPanel: failed to reorder used colors', result.error);
        setKitColors(result.colors);
        Alert.alert(t('error'), t('saveFailed'));
      }
    } finally {
      setOrderSaving(false);
    }
  }, [kitColors, orderSaving, repository]);

  const moveColor = useCallback((kitColorId: number, direction: -1 | 1) => {
    const next = moveMixRecipe(kitColors, kitColorId, direction);
    if (next !== kitColors) void saveColorOrder(next);
  }, [kitColors, saveColorOrder]);

  const renderKitColor = useCallback<SortableGridRenderItem<KitColorSummary>>(({ item, index }) => {
    const colorLabel = item.name?.trim() || item.paints[0]?.code || t('mixResult');
    return (
      <KitColorRow
        color={item}
        ownedMap={ownedMap}
        disabled={orderSaving}
        onPress={() => { setSelectedColor(item); setColorDetailOpen(true); }}
        dragHandle={(
          <Sortable.Handle style={styles.dragHandle}>
            <View
              pointerEvents="none"
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={`${colorLabel} ${t('sort')}`}
              accessibilityState={{ disabled: orderSaving }}
              accessibilityValue={{ min: 1, max: kitColors.length, now: index + 1, text: `${index + 1}/${kitColors.length}` }}
              accessibilityActions={[
                { name: 'decrement', label: t('moveUp') },
                { name: 'increment', label: t('moveDown') },
              ]}
              onAccessibilityAction={({ nativeEvent }) => {
                if (orderSaving) return;
                if (nativeEvent.actionName === 'decrement') moveColor(item.id, -1);
                if (nativeEvent.actionName === 'increment') moveColor(item.id, 1);
              }}
              style={[styles.dragHandleContent, orderSaving && styles.dragHandleDisabled]}
            >
              <IconGripVertical color={colors.textMuted} size={22} />
            </View>
          </Sortable.Handle>
        )}
      />
    );
  }, [colors.textMuted, kitColors.length, moveColor, orderSaving, ownedMap, styles]);

  if (!active) return null;
  return (
    <>
      <View style={styles.paintsSection}>
        <View style={styles.paintsHeader}>
          <Text style={styles.sectionTitle}>{t('kitUsedColors')}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('addUsedColor')}
            onPress={() => setPickerOpen(true)}
            style={styles.addColorButton}
          >
            <IconPlus color={colors.primary} size={18} />
            <Text style={styles.addLink}>{t('addUsedColor')}</Text>
          </TouchableOpacity>
        </View>
        {loadState === 'loading' ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : loadState === 'error' ? (
          <View style={styles.center}>
            <Text accessibilityRole="alert" style={styles.empty}>{t('loadFailed')}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => { void load(true); }} style={styles.retryButton}>
              <Text style={styles.retryText}>{t('retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : kitColors.length === 0 ? (
          <Text style={styles.empty}>{t('emptyKitColors')}</Text>
        ) : (
          <Sortable.Grid
            columns={1}
            customHandle
            data={kitColors}
            keyExtractor={(color) => String(color.id)}
            renderItem={renderKitColor}
            onDragEnd={({ data }) => { void saveColorOrder(data); }}
            rowGap={spacing.md}
            scrollableRef={scrollableRef}
            sortEnabled={!orderSaving}
            dragActivationDelay={180}
            dragActivationFailOffset={8}
            reorderTriggerOrigin="touch"
            overDrag="vertical"
            activeItemScale={1.015}
            inactiveItemOpacity={0.92}
            autoScrollActivationOffset={80}
            autoScrollMaxVelocity={500}
          />
        )}
      </View>

      <KitColorComposerModal
        visible={pickerOpen}
        requestCloseRef={requestCloseRef}
        onClose={() => setPickerOpen(false)}
        onSaveColor={saveNewColor}
      />
      <ColorMixDetailModal
        visible={colorDetailOpen}
        color={selectedColor}
        title={t('colorInfo')}
        editLabel={t('editColorInfo')}
        editable
        ownedMap={ownedMap}
        onEdit={() => { setColorDetailOpen(false); setEditingColor(true); }}
        onDelete={() => selectedColor && confirmRemoveColor(selectedColor)}
        onClose={() => setColorDetailOpen(false)}
      />
      <ColorMixEditorModal
        visible={editingColor}
        embedded
        requestCloseRef={requestCloseRef}
        title={t('editColorInfo')}
        initialDraft={draftFromSummary(selectedColor)}
        onSave={saveColor}
        onClose={() => setEditingColor(false)}
      />
    </>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  paintsSection: { gap: spacing.md },
  paintsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  dragHandle: { width: 48, minHeight: 72, alignSelf: 'stretch' },
  dragHandleContent: { flex: 1, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.borderLight },
  dragHandleDisabled: { opacity: 0.35 },
  addColorButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  addLink: { color: colors.primaryText, fontWeight: '700', fontSize: 14 },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  retryButton: { minHeight: 48, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: 8 },
  retryText: { color: colors.primaryText, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.textPlaceholder },
});

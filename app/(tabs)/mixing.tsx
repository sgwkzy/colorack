import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { IconFlask, IconGripVertical } from '@tabler/icons-react-native';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable, { type SortableGridRenderItem } from 'react-native-sortables';
import { SafeAreaView } from 'react-native-safe-area-context';
import ColorMixCard from '../../components/ColorMixCard';
import ColorMixDetailModal from '../../components/ColorMixDetailModal';
import ColorMixEditor from '../../components/ColorMixEditor';
import ColorMixEditorModal from '../../components/ColorMixEditorModal';
import EmptyState from '../../components/EmptyState';
import { useScreenView } from '../../lib/analytics';
import { addMixRecipe, getDB, getMixRecipes, removeMixRecipe, reorderMixRecipes, updateMixRecipe } from '../../lib/db';
import { ColorMixSummary, draftFromSummary, MixDraft, moveMixRecipe, normalizeDraftPaints } from '../../lib/colorMixDraft';
import { t, useLocale } from '../../lib/i18n';
import { lightColors, spacing, touch, useTheme } from '../../lib/theme';

const EMPTY_DRAFT: MixDraft = { name: '', note: '', paints: [] };

export default function MixingScreen() {
  useLocale();
  useScreenView('MixingSimulator');
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const savedScrollRef = useAnimatedRef<Animated.ScrollView>();
  const [segment, setSegment] = useState<'simulator' | 'saved'>('simulator');
  const [recipes, setRecipes] = useState<ColorMixSummary[]>([]);
  const [ownedMap, setOwnedMap] = useState<Map<number, number>>(new Map());
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ColorMixSummary | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [simulatorKey, setSimulatorKey] = useState(0);
  const [orderSaving, setOrderSaving] = useState(false);

  const loadRecipes = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRecipes, ownedRows] = await Promise.all([
        getMixRecipes(),
        getDB().getAllAsync<{ paint_id: number; n: number }>(
          "SELECT paint_id, COUNT(*) AS n FROM inventory WHERE status IN ('owned', 'in_use') GROUP BY paint_id"
        ),
      ]);
      setRecipes(nextRecipes);
      setOwnedMap(new Map(ownedRows.map((row) => [row.paint_id, row.n])));
      setSelected((current) => current ? nextRecipes.find((recipe) => recipe.id === current.id) ?? null : null);
      setLoadError(false);
    } catch (error) {
      console.error('MixingScreen: failed to load recipes', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadRecipes(); }, [loadRecipes]));

  const saveNew = async (draft: MixDraft) => {
    await addMixRecipe(draft.name.trim() || null, draft.note.trim() || null, normalizeDraftPaints(draft.paints));
    await loadRecipes();
    setSimulatorKey((key) => key + 1);
  };

  const saveEdit = async (draft: MixDraft) => {
    if (!selected) return;
    await updateMixRecipe(selected.id, draft.name.trim() || null, draft.note.trim() || null, normalizeDraftPaints(draft.paints));
    await loadRecipes();
    setEditing(false);
  };

  const confirmDelete = () => {
    if (!selected) return;
    Alert.alert(t('delete'), t('deleteMixConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await removeMixRecipe(selected.id);
            setDetailVisible(false);
            setSelected(null);
            await loadRecipes();
          } catch (error) {
            console.error('MixingScreen: failed to delete recipe', error);
            Alert.alert(t('error'), t('saveFailed'));
          }
        },
      },
    ]);
  };

  const saveRecipeOrder = useCallback(async (next: ColorMixSummary[]) => {
    const previous = recipes;
    if (orderSaving || next === previous || next.every((recipe, index) => recipe.id === previous[index]?.id)) return;
    setRecipes(next);
    setOrderSaving(true);
    try {
      await reorderMixRecipes(next.map((recipe) => recipe.id));
    } catch (error) {
      console.error('MixingScreen: failed to reorder recipes', error);
      setRecipes(previous);
      Alert.alert(t('error'), t('saveFailed'));
    } finally {
      setOrderSaving(false);
    }
  }, [orderSaving, recipes]);

  const moveRecipe = useCallback((recipeId: number, direction: -1 | 1) => {
    const next = moveMixRecipe(recipes, recipeId, direction);
    if (next !== recipes) void saveRecipeOrder(next);
  }, [recipes, saveRecipeOrder]);

  const renderSavedRecipe = useCallback<SortableGridRenderItem<ColorMixSummary>>(({ item, index }) => {
    const handleLabel = `${item.name?.trim() || t('mixResult')} ${t('sort')}`;
    return (
      <ColorMixCard
        color={item}
        ownedMap={ownedMap}
        onPress={() => { setSelected(item); setDetailVisible(true); }}
        dragHandle={(
          <Sortable.Handle style={styles.dragHandle}>
            <View
              pointerEvents="none"
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={handleLabel}
              accessibilityState={{ disabled: orderSaving }}
              accessibilityValue={{ min: 1, max: recipes.length, now: index + 1, text: `${index + 1}/${recipes.length}` }}
              accessibilityActions={[
                { name: 'decrement', label: t('moveUp') },
                { name: 'increment', label: t('moveDown') },
              ]}
              onAccessibilityAction={({ nativeEvent }) => {
                if (orderSaving) return;
                if (nativeEvent.actionName === 'decrement') moveRecipe(item.id, -1);
                if (nativeEvent.actionName === 'increment') moveRecipe(item.id, 1);
              }}
              style={[styles.dragHandleContent, orderSaving && styles.dragHandleDisabled]}
            >
              <IconGripVertical color={colors.textMuted} size={22} />
            </View>
          </Sortable.Handle>
        )}
      />
    );
  }, [colors.textMuted, moveRecipe, orderSaving, ownedMap, recipes.length, styles]);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View accessibilityRole="tablist" style={styles.segments}>
        {(['simulator', 'saved'] as const).map((key) => {
          const active = segment === key;
          return (
            <TouchableOpacity
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setSegment(key)}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {t(key === 'simulator' ? 'simulator' : 'savedMixes')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.content, segment !== 'simulator' && styles.hidden]}>
        <ColorMixEditor key={simulatorKey} initialDraft={EMPTY_DRAFT} onSave={saveNew} />
      </View>

      {segment === 'saved' ? (
        loading ? (
          <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        ) : loadError ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{t('cloudBackupError')}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={loadRecipes} style={styles.retryButton}>
              <Text style={styles.retryText}>{t('retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : recipes.length === 0 ? (
          <EmptyState icon={IconFlask} title={t('emptySavedMixes')} />
        ) : (
          <Animated.ScrollView ref={savedScrollRef} style={styles.savedScroll} contentContainerStyle={styles.savedList}>
            <Sortable.Grid
              columns={1}
              customHandle
              data={recipes}
              keyExtractor={(recipe) => String(recipe.id)}
              renderItem={renderSavedRecipe}
              onDragEnd={({ data }) => { void saveRecipeOrder(data); }}
              rowGap={spacing.lg}
              scrollableRef={savedScrollRef}
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
          </Animated.ScrollView>
        )
      ) : null}

      <ColorMixDetailModal
        visible={detailVisible}
        color={selected}
        editable
        ownedMap={ownedMap}
        onEdit={() => { setDetailVisible(false); setEditing(true); }}
        onDelete={confirmDelete}
        onClose={() => setDetailVisible(false)}
      />
      <ColorMixEditorModal
        visible={editing}
        title={t('editMix')}
        initialDraft={draftFromSummary(selected)}
        onSave={saveEdit}
        onClose={() => setEditing(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  segments: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  segment: { flex: 1, minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: colors.transparent },
  segmentActive: { borderBottomColor: colors.primary },
  segmentText: { color: colors.textMuted, fontSize: 15 },
  segmentTextActive: { color: colors.primaryText, fontWeight: '700' },
  content: { flex: 1 },
  hidden: { display: 'none' },
  savedScroll: { flex: 1 },
  savedList: { padding: spacing.xl, paddingBottom: spacing.xxl },
  dragHandle: { width: touch.min, minHeight: 72, alignSelf: 'stretch' },
  dragHandleContent: { flex: 1, alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.borderLight },
  dragHandleDisabled: { opacity: 0.35 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xxl },
  errorText: { color: colors.textMuted },
  retryButton: { minHeight: touch.min, paddingHorizontal: spacing.xl, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.primary },
  retryText: { color: colors.onPrimary, fontWeight: '700' },
});

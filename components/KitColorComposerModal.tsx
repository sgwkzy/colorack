import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronLeft, IconChevronRight, IconFlask, IconPalette, IconPlus, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { addKitColor, addKitColorFromSummary, getDB, getMixRecipes } from '../lib/db';
import { ColorMixSummary, draftFromSummary, normalizeDraftPaints } from '../lib/colorMixDraft';
import { t, useLocale } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { paintName } from '../lib/paintLabel';
import { lightColors, radius, spacing, touch, useTheme } from '../lib/theme';
import ColorMixCard from './ColorMixCard';
import ColorMixEditorModal from './ColorMixEditorModal';
import ColorMixPaintPickerModal from './ColorMixPaintPickerModal';
import SwipeDownHeader from './SwipeDownHeader';

type Route = 'source' | 'paint' | 'saved' | 'newMix';

interface Props {
  visible: boolean;
  kitId: number;
  onClose: () => void;
  onAdded: () => void | Promise<void>;
}

interface SourceOptionProps {
  icon: ReactNode;
  title: string;
  help: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  chevronColor: string;
}

function SourceOption({ icon, title, help, onPress, styles, chevronColor }: SourceOptionProps) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`${title}。${help}`}
      onPress={onPress}
      style={styles.sourceButton}
    >
      <View style={styles.sourceIcon}>{icon}</View>
      <View style={styles.sourceText}>
        <Text style={styles.sourceTitle}>{title}</Text>
        <Text style={styles.sourceHelp}>{help}</Text>
      </View>
      <IconChevronRight color={chevronColor} size={20} />
    </TouchableOpacity>
  );
}

export default function KitColorComposerModal({ visible, kitId, onClose, onAdded }: Props) {
  useLocale();
  useModalLock(visible);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const initialDraft = useMemo(() => draftFromSummary(), [visible]);
  const [route, setRoute] = useState<Route>('source');
  const [recipes, setRecipes] = useState<ColorMixSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const loadRecipes = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setRecipes(await getMixRecipes());
    } catch (error) {
      console.error('KitColorComposerModal: failed to load saved mixes', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setRoute('source');
      setRecipes([]);
      setLoading(false);
      setLoadError(false);
      setSavingId(null);
      return;
    }
    if (route === 'saved') void loadRecipes();
  }, [visible, route, loadRecipes]);

  const back = () => {
    if (route === 'source') onClose();
    else setRoute('source');
  };

  const finishAdd = () => {
    onClose();
    void Promise.resolve().then(onAdded).catch((error) => {
      console.error('KitColorComposerModal: failed to refresh kit colors', error);
    });
  };

  const addPaint = async ({ id }: { id: number }): Promise<boolean> => {
    if (savingId != null) return false;
    setSavingId(id);
    try {
      const paint = await getDB().getFirstAsync<{ id: number; name_ja: string; name_en: string | null }>(
        'SELECT id, name_ja, name_en FROM catalog_paints WHERE id = ?',
        [id],
      );
      if (!paint) throw new Error('paint_not_found');
      await addKitColor(kitId, paintName(paint.name_ja, paint.name_en), null, [{ paintId: paint.id, ratio: 1 }]);
      finishAdd();
      return true;
    } catch (error) {
      console.error('KitColorComposerModal: failed to add paint', error);
      Alert.alert(t('error'), t('saveFailed'));
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const addSavedMix = async (recipe: ColorMixSummary) => {
    if (savingId != null) return;
    setSavingId(recipe.id);
    try {
      await addKitColorFromSummary(kitId, recipe);
      finishAdd();
    } catch (error) {
      console.error('KitColorComposerModal: failed to copy saved mix', error);
      Alert.alert(t('error'), t('saveFailed'));
    } finally {
      setSavingId(null);
    }
  };

  const displayName = (recipe: ColorMixSummary) => recipe.name?.trim()
    || (recipe.paints[0] ? paintName(recipe.paints[0].name_ja, recipe.paints[0].name_en) : t('mixResult'));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={back}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <SwipeDownHeader onClose={back}>
            <View style={styles.header}>
              {route === 'saved' ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('back')} onPress={back} style={styles.headerButton}>
                  <IconChevronLeft color={colors.primary} size={24} />
                </TouchableOpacity>
              ) : <View style={styles.headerButton} />}
              <Text numberOfLines={1} style={styles.headerTitle}>{t(route === 'saved' ? 'pickMixForKit' : 'chooseColorSource')}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} onPress={onClose} style={styles.headerButton}>
                <IconX color={colors.text} size={24} />
              </TouchableOpacity>
            </View>
          </SwipeDownHeader>

          {route === 'saved' ? (
            loading ? (
              <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
            ) : loadError ? (
              <View style={styles.center}>
                <Text accessibilityRole="alert" style={styles.message}>{t('loadFailed')}</Text>
                <TouchableOpacity accessibilityRole="button" onPress={loadRecipes} style={styles.retryButton}>
                  <Text style={styles.retryText}>{t('retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={recipes}
                keyExtractor={(recipe) => String(recipe.id)}
                contentContainerStyle={[styles.listContent, recipes.length === 0 && styles.emptyList]}
                ItemSeparatorComponent={() => <View style={styles.separator} />}
                ListEmptyComponent={<Text style={styles.message}>{t('savedMixPickerEmpty')}</Text>}
                renderItem={({ item }) => (
                  <View style={savingId != null && styles.disabled}>
                    <ColorMixCard
                      color={item}
                      disabled={savingId != null}
                      accessibilityLabel={`${displayName(item)}。${t('addMixToKit')}`}
                      onPress={() => addSavedMix(item)}
                      dragHandle={
                        savingId === item.id ? (
                          <View style={styles.cardAction}><ActivityIndicator color={colors.primary} /></View>
                        ) : (
                          <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={`${displayName(item)}。${t('addMixToKit')}`}
                            accessibilityState={{ disabled: savingId != null }}
                            disabled={savingId != null}
                            onPress={() => addSavedMix(item)}
                            style={styles.cardAction}
                          >
                            <IconPlus color={colors.primary} size={22} />
                          </TouchableOpacity>
                        )
                      }
                    />
                  </View>
                )}
              />
            )
          ) : (
            <View style={styles.sourceList}>
              <SourceOption
                icon={<IconPalette color={colors.primary} size={24} />}
                title={t('choosePaint')}
                help={t('choosePaintHelp')}
                onPress={() => setRoute('paint')}
                styles={styles}
                chevronColor={colors.textMuted}
              />
              <SourceOption
                icon={<IconFlask color={colors.primary} size={24} />}
                title={t('chooseSavedMix')}
                help={t('chooseSavedMixHelp')}
                onPress={() => setRoute('saved')}
                styles={styles}
                chevronColor={colors.textMuted}
              />
              <SourceOption
                icon={<IconPlus color={colors.primary} size={24} />}
                title={t('createKitMix')}
                help={t('createKitMixHelp')}
                onPress={() => setRoute('newMix')}
                styles={styles}
                chevronColor={colors.textMuted}
              />
            </View>
          )}

          <ColorMixPaintPickerModal
            visible={visible && route === 'paint'}
            title={t('pickPaintForKit')}
            onSelect={addPaint}
            onClose={() => setRoute('source')}
          />
          <ColorMixEditorModal
            visible={visible && route === 'newMix'}
            title={t('createKitMix')}
            saveLabel={t('saveToKit')}
            initialDraft={initialDraft}
            onSave={async (draft) => {
              await addKitColor(
                kitId,
                draft.name.trim() || null,
                draft.note.trim() || null,
                normalizeDraftPaints(draft.paints),
              );
              finishAdd();
            }}
            onClose={() => setRoute('source')}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerButton: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  sourceList: { padding: spacing.xl, gap: spacing.md },
  sourceButton: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderLight, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  sourceIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primarySoft },
  sourceText: { flex: 1, minWidth: 0, gap: 2 },
  sourceTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sourceHelp: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  listContent: { padding: spacing.xl },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  separator: { height: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  message: { color: colors.textMuted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryButton: { minWidth: 120, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md },
  retryText: { color: colors.primaryText, fontWeight: '700' },
  cardAction: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.55 },
});

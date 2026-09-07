import { type MutableRefObject, useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconChevronLeft, IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MixDraft } from '../lib/colorMixDraft';
import { useAndroidBack } from '../lib/androidBack';
import { t } from '../lib/i18n';
import { useModalLock } from '../lib/modalLock';
import { lightColors, spacing, touch, useTheme } from '../lib/theme';
import ColorMixEditor from './ColorMixEditor';
import SwipeDownHeader from './SwipeDownHeader';

interface Props {
  visible: boolean;
  title: string;
  initialDraft: MixDraft;
  saveLabel?: string;
  embedded?: boolean;
  requestCloseRef?: MutableRefObject<() => void>;
  onBack?: () => void;
  onSave: (draft: MixDraft) => Promise<void>;
  onClose: () => void;
}

export default function ColorMixEditorModal({ visible, title, initialDraft, saveLabel, embedded = false, requestCloseRef, onBack, onSave, onClose }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!visible) setDirty(false); }, [visible]);

  const leave = (action: () => void) => {
    if (!dirty) { action(); return; }
    Alert.alert(t('discardChangesConfirm'), '', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('discard'), style: 'destructive', onPress: action },
    ]);
  };
  const close = () => leave(onClose);
  const back = () => leave(onBack ?? onClose);
  useModalLock(visible && !embedded);
  useAndroidBack(visible && embedded, back);
  useEffect(() => {
    if (visible && embedded && requestCloseRef) requestCloseRef.current = back;
  }, [visible, embedded, requestCloseRef, back]);

  const save = async (draft: MixDraft) => {
    await onSave(draft);
    setDirty(false);
    onClose();
  };

  const screen = (
    <SafeAreaView
      accessibilityViewIsModal={embedded}
      style={[styles.container, embedded && styles.embedded, embedded && { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      edges={embedded ? [] : ['top', 'bottom']}
    >
      <SwipeDownHeader onClose={close}>
        <View style={styles.header}>
          {onBack ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('back')} onPress={back} style={styles.headerButton}>
              <IconChevronLeft color={colors.primary} size={24} />
            </TouchableOpacity>
          ) : <View style={styles.headerButton} />}
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('close')} onPress={close} style={styles.headerButton}>
            <IconX color={colors.text} size={24} />
          </TouchableOpacity>
        </View>
      </SwipeDownHeader>
      {visible ? <ColorMixEditor initialDraft={initialDraft} saveLabel={saveLabel} onSave={save} onDirtyChange={setDirty} /> : null}
    </SafeAreaView>
  );

  if (embedded) return visible ? screen : null;
  return <Modal visible={visible} animationType="slide" onRequestClose={close}><SafeAreaProvider>{screen}</SafeAreaProvider></Modal>;
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  embedded: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerButton: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
});

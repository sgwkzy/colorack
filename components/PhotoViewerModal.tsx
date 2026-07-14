// components/PhotoViewerModal.tsx
// 写真を全画面表示するだけのシンプルなビューア。タップ/×で閉じる。
import { useMemo } from 'react';
import { Image, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { lightColors, spacing, useTheme } from '../lib/theme';

interface Props {
  visible: boolean;
  uri: string | null;
  onClose: () => void;
}

export default function PhotoViewerModal({ visible, uri, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top']}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <IconX color="#fff" size={28} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.imageWrap} activeOpacity={1} onPress={onClose}>
            {uri ? <Image source={{ uri }} style={styles.image} resizeMode="contain" /> : null}
          </TouchableOpacity>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)' },
  closeBtn: { position: 'absolute', top: spacing.lg, right: spacing.lg, zIndex: 1, padding: spacing.sm },
  imageWrap: { flex: 1 },
  image: { flex: 1, width: '100%', height: '100%' },
});

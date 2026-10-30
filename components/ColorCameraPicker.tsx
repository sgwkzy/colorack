import { useRef, useState, useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { pickImageColor } from '../lib/imageColor';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { hex_to_rgb } from '../lib/color';
import { t } from '../lib/i18n';
import { useTheme, lightColors, radius, spacing } from '../lib/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (hex: string) => void;
}

const CENTER_CROP_RATIO = 0.16;

export default function ColorCameraPicker({ visible, onClose, onPick }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  const capture = async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (!photo) return;
      const hex = await pickCenterColor(photo.uri, photo.width, photo.height);
      if (!hex_to_rgb(hex)) throw new Error('invalid color');
      onPick(hex);
      onClose();
    } catch {
      Alert.alert(t('error'), t('colorCaptureError'));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          {!permission ? (
            <View style={styles.center} />
          ) : !permission.granted ? (
            <View style={styles.center}>
              <Text style={styles.msg}>{t('cameraPermissionMessage')}</Text>
              <TouchableOpacity onPress={requestPermission} accessibilityRole="button" accessibilityLabel={t('allowCamera')}><Text style={styles.link}>{t('allowCamera')}</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={styles.container}>
              <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="picture" />
              <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('close')}>
                <IconX color={colors.onPrimary} size={26} />
              </TouchableOpacity>
              <View pointerEvents="none" style={styles.aim}>
                <View style={styles.frame} />
              </View>
              <View style={styles.bottom}>
                <TouchableOpacity
                  style={[styles.shutter, capturing && styles.shutterOff]}
                  onPress={capture}
                  disabled={capturing}
                  accessibilityLabel={t('pickColorWithCamera')}
                >
                  <View style={styles.shutterInner} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

async function pickCenterColor(uri: string, width: number, height: number): Promise<string> {
  const size = Math.max(8, Math.floor(Math.min(width, height) * CENTER_CROP_RATIO));
  return pickImageColor(uri, {
    originX: Math.floor((width - size) / 2),
    originY: Math.floor((height - size) / 2),
    width: size,
    height: size,
  });
}
const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.surface },
  msg: { fontSize: 15, marginBottom: spacing.xl, textAlign: 'center', color: colors.text },
  link: { color: colors.primaryText, fontSize: 15 },
  close: { position: 'absolute', top: spacing.sm, right: spacing.lg, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  aim: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 96, height: 96, borderWidth: 2, borderColor: colors.onPrimary, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.08)' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: spacing.xl, alignItems: 'center' },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: colors.onPrimary, alignItems: 'center', justifyContent: 'center' },
  shutterOff: { opacity: 0.5 },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.onPrimary },
});

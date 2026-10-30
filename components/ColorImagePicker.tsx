import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Modal, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { IconX } from '@tabler/icons-react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { pickImageColor } from '../lib/imageColor';
import { constrainImagePosition, imageColorRegion } from '../lib/imageColorRegion';
import { t } from '../lib/i18n';
import { useTheme, spacing, radius, touch } from '../lib/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (hex: string) => void;
}

const FRAME = 96;
type Position = { scale: number; x: number; y: number };

function touches(event: GestureResponderEvent) {
  const points = event.nativeEvent.touches;
  const a = points[0];
  const b = points[1] ?? a;
  return {
    count: points.length,
    x: (a.pageX + b.pageX) / 2,
    y: (a.pageY + b.pageY) / 2,
    distance: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY),
  };
}

export default function ColorImagePicker({ visible, onClose, onPick }: Props) {
  const { colors } = useTheme();
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [position, setPosition] = useState<Position>({ scale: 1, x: 0, y: 0 });
  const positionRef = useRef(position);
  const [hex, setHex] = useState<string | null>(null);
  const [sampling, setSampling] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const request = useRef(0);
  const active = useRef(false);
  const selecting = useRef(false);
  const gesture = useRef<{ start: ReturnType<typeof touches>; position: Position } | null>(null);
  const minimumScale = image ? FRAME / Math.min(image.width, image.height) : 1;
  const fitScale = image && viewport.width && viewport.height
    ? Math.max(minimumScale, Math.min(viewport.width / image.width, viewport.height / image.height)) : 1;

  const updatePosition = (next: Position) => {
    positionRef.current = next;
    setPosition(next);
  };

  const sample = async (next: Position) => {
    if (!image || !active.current) return;
    const id = ++request.current;
    setHex(null);
    setSampling(true);
    try {
      const picked = await pickImageColor(image.uri,
        imageColorRegion(image.width, image.height, next.scale, next.x, next.y, FRAME));
      if (id === request.current && active.current) setHex(picked);
    } catch {
      if (id === request.current && active.current) Alert.alert(t('error'), t('imageColorError'));
    } finally {
      if (id === request.current && active.current) setSampling(false);
    }
  };

  const chooseImage = async () => {
    if (selecting.current) return;
    selecting.current = true;
    const id = ++request.current;
    setChoosing(true);
    setHex(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (!active.current || id !== request.current) return;
      if (!result.canceled && result.assets[0]) setImage(result.assets[0]);
      else if (image) void sample(positionRef.current);
      else onClose();
    } catch {
      if (active.current && id === request.current) Alert.alert(t('error'), t('imageColorError'));
    } finally {
      selecting.current = false;
      if (active.current) setChoosing(false);
    }
  };

  useEffect(() => {
    active.current = visible;
    if (visible) {
      setImage(null);
      setHex(null);
      setSampling(false);
      setChoosing(false);
    }
    return () => { active.current = false; ++request.current; };
  }, [visible]);

  useEffect(() => {
    if (!visible || !image || !viewport.width || !viewport.height) return;
    const next = { scale: fitScale, x: 0, y: 0 };
    updatePosition(next);
    void sample(next);
  }, [visible, image, viewport.width, viewport.height]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !!image,
    onMoveShouldSetPanResponder: () => !!image,
    onPanResponderGrant: (event) => {
      ++request.current;
      setHex(null);
      setSampling(false);
      gesture.current = { start: touches(event), position: positionRef.current };
    },
    onPanResponderMove: (event) => {
      if (!image || !event.nativeEvent.touches.length) return;
      const current = touches(event);
      if (!gesture.current || current.count !== gesture.current.start.count) {
        gesture.current = { start: current, position: positionRef.current };
        return;
      }
      const { start, position: initial } = gesture.current;
      const ratio = current.count > 1 && start.distance > 0 ? current.distance / start.distance : 1;
      const scale = Math.max(minimumScale, Math.min(fitScale * 8, initial.scale * ratio));
      const zoom = scale / initial.scale;
      const offset = constrainImagePosition(image.width, image.height, scale,
        initial.x * zoom + current.x - start.x, initial.y * zoom + current.y - start.y, FRAME);
      updatePosition({ scale, ...offset });
    },
    onPanResponderRelease: () => { gesture.current = null; void sample(positionRef.current); },
    onPanResponderTerminate: () => { gesture.current = null; void sample(positionRef.current); },
    onPanResponderTerminationRequest: () => false,
  }), [image, minimumScale, fitScale]);

  const close = () => { active.current = false; ++request.current; onClose(); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} onShow={chooseImage}>
      <SafeAreaProvider>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.surface }]} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>{t('pickColorWithImage')}</Text>
            <TouchableOpacity onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel={t('close')}>
              <IconX color={colors.text} size={26} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.instructions, { color: colors.textSecondary }]}>{t('imageColorInstructions')}</Text>
          <View style={styles.viewport} {...responder.panHandlers}
            accessible accessibilityRole="adjustable" accessibilityLabel={t('imageColorInstructions')}
            accessibilityState={{ disabled: !image || choosing }} accessibilityValue={{ text: hex ?? t('imageColorSampling') }}
            accessibilityActions={[
              { name: 'increment', label: t('imageColorZoomIn') },
              { name: 'decrement', label: t('imageColorZoomOut') },
              { name: 'moveLeft', label: t('imageColorMoveLeft') },
              { name: 'moveRight', label: t('imageColorMoveRight') },
              { name: 'moveUp', label: t('imageColorMoveUp') },
              { name: 'moveDown', label: t('imageColorMoveDown') },
            ]}
            onAccessibilityAction={({ nativeEvent: { actionName } }) => {
              if (!image || choosing) return;
              const current = positionRef.current;
              let { scale, x, y } = current;
              if (actionName === 'increment') scale = Math.min(fitScale * 8, scale * 1.25);
              else if (actionName === 'decrement') scale = Math.max(minimumScale, scale / 1.25);
              else if (actionName === 'moveLeft') x -= FRAME / 4;
              else if (actionName === 'moveRight') x += FRAME / 4;
              else if (actionName === 'moveUp') y -= FRAME / 4;
              else if (actionName === 'moveDown') y += FRAME / 4;
              else return;
              const offset = constrainImagePosition(image.width, image.height, scale, x * scale / current.scale, y * scale / current.scale, FRAME);
              const next = { scale, ...offset };
              updatePosition(next);
              void sample(next);
            }}
            onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}>
            {image && <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <Image source={{ uri: image.uri }} resizeMode="stretch" style={{
              position: 'absolute', width: image.width * position.scale, height: image.height * position.scale,
              left: (viewport.width - image.width * position.scale) / 2 + position.x,
              top: (viewport.height - image.height * position.scale) / 2 + position.y,
              }} />
            </View>}
            {image && <View pointerEvents="none" style={styles.aim}><View style={styles.frame} /></View>}
          </View>
          <View style={styles.footer}>
            <View style={styles.preview} accessibilityLiveRegion="polite">
              <View style={[styles.swatch, { backgroundColor: hex ?? colors.chip, borderColor: colors.border }]} />
              <Text style={{ color: colors.text }}>{hex ?? (sampling ? t('imageColorSampling') : '—')}</Text>
            </View>
            <TouchableOpacity onPress={chooseImage} disabled={choosing} accessibilityRole="button" accessibilityState={{ disabled: choosing }}
              style={[styles.button, { borderColor: colors.border, opacity: choosing ? 0.5 : 1 }]}>
              <Text style={{ color: colors.primaryText }}>{t('pickColorWithImage')}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={!hex || choosing} onPress={() => { if (hex) { onPick(hex); close(); } }}
              accessibilityRole="button" accessibilityState={{ disabled: !hex || choosing }} style={[styles.button, { backgroundColor: hex && !choosing ? colors.primary : colors.primaryDisabled }]}>
              <Text style={{ color: colors.onPrimary }}>{t('searchWithColor')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg },
  title: { flex: 1, fontSize: 18, fontWeight: '600' },
  close: { width: touch.min, height: touch.min, alignItems: 'center', justifyContent: 'center' },
  instructions: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, fontSize: 13 },
  viewport: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  aim: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  frame: { width: FRAME, height: FRAME, borderWidth: 2, borderColor: '#fff', borderRadius: radius.md },
  footer: { padding: spacing.lg, gap: spacing.sm },
  preview: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  swatch: { width: touch.min, height: touch.min, borderWidth: 1, borderRadius: radius.md },
  button: { minHeight: touch.min, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
});

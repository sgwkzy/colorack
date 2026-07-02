import { useRef, useState, useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
// @ts-ignore pako has no bundled types in this Expo project.
import { inflate } from 'pako';
import { IconX } from '@tabler/icons-react-native';
import { hex_to_rgb } from '../lib/color';
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
      Alert.alert('エラー', '色の取得に失敗しました');
    } finally {
      setCapturing(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {!permission ? (
        <View style={styles.center} />
      ) : !permission.granted ? (
        <View style={styles.center}>
          <Text style={styles.msg}>カメラで色を取得します</Text>
          <Text style={styles.link} onPress={requestPermission}>カメラを許可</Text>
        </View>
      ) : (
        <View style={styles.container}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="picture" />
          <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={8}>
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
              accessibilityLabel="カメラで色を取得"
            >
              <View style={styles.shutterInner} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Modal>
  );
}

async function pickCenterColor(uri: string, width: number, height: number): Promise<string> {
  const size = Math.max(8, Math.floor(Math.min(width, height) * CENTER_CROP_RATIO));
  const crop = {
    originX: Math.floor((width - size) / 2),
    originY: Math.floor((height - size) / 2),
    width: size,
    height: size,
  };
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop }, { resize: { width: 1, height: 1 } }],
    { base64: true, compress: 1, format: ImageManipulator.SaveFormat.PNG }
  );
  if (!result.base64) throw new Error('missing base64');
  const { r, g, b } = readPngPixel(result.base64);
  return rgbToHex(r, g, b);
}

function readPngPixel(base64: string): { r: number; g: number; b: number } {
  const bytes = decodeBase64(base64);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error('invalid png');

  let offset = 8;
  let colorType = 6;
  const idatParts: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = readUInt32(bytes, offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const dataStart = offset + 8;
    if (type === 'IHDR') colorType = bytes[dataStart + 9];
    if (type === 'IDAT') idatParts.push(bytes.slice(dataStart, dataStart + length));
    offset = dataStart + length + 4;
    if (type === 'IEND') break;
  }

  const data = inflate(concat(idatParts)) as Uint8Array;
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  if (!channels) throw new Error('unsupported png');
  if (data[0] > 4) throw new Error('unsupported filter');
  const pixel = Array.from(data.slice(1, 1 + channels)) as number[];
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

function decodeBase64(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = chars.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.surface },
  msg: { fontSize: 15, marginBottom: spacing.xl, textAlign: 'center', color: colors.text },
  link: { color: colors.primary, fontSize: 15 },
  close: { position: 'absolute', top: 48, right: 20, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  aim: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: 96, height: 96, borderWidth: 2, borderColor: colors.onPrimary, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.08)' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 42, alignItems: 'center' },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: colors.onPrimary, alignItems: 'center', justifyContent: 'center' },
  shutterOff: { opacity: 0.5 },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.onPrimary },
});

// 写真アプリと同じ操作を提供する、Expo Go対応の画像ビューアー。
import { Alert, Image, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { IconDownload, IconX } from '@tabler/icons-react-native';
import ImageViewing from 'react-native-image-viewing';
import { useLocale } from '../lib/i18n';
import { saveKitPhotoToLibrary } from '../lib/kitPhoto';
import { spacing } from '../lib/theme';

interface Props {
  visible: boolean;
  uri: string | null;
  uris?: string[];
  onClose: () => void;
}

export default function PhotoViewerModal({ visible, uri, uris, onClose }: Props) {
  const photoUris = uris?.length ? uris : uri ? [uri] : [];
  // imageIndex は開いた瞬間だけ渡す。スワイプ後に親から渡し直すと、
  // ライブラリがビューアー全体を作り直してフェードしてしまう。
  const initialImageIndex = uri ? Math.max(0, photoUris.indexOf(uri)) : 0;
  const locale = useLocale();
  const labels = locale === 'ja'
    ? { close: '閉じる', download: 'ダウンロード', saved: '写真ライブラリに保存しました', failed: '写真を保存できませんでした。写真ライブラリへのアクセスを許可してください。' }
    : { close: 'Close', download: 'Download', saved: 'Saved to your photo library', failed: 'Unable to save the photo. Allow photo library access and try again.' };

  const savePhoto = async (index: number) => {
    const selectedUri = photoUris[index];
    if (!selectedUri) return;
    try {
      const saved = await saveKitPhotoToLibrary(selectedUri);
      Alert.alert(labels.download, saved ? labels.saved : labels.failed);
    } catch (error) {
      console.error('saveKitPhotoToLibrary failed', error);
      Alert.alert(labels.download, labels.failed);
    }
  };

  const Header = ({ imageIndex: currentIndex }: { imageIndex: number }) => (
    <SafeAreaView style={styles.header}>
      <View style={styles.headerSpacer} />
      <View style={styles.titlePill}>
        <Text style={styles.title}>キット写真</Text>
        <Text style={styles.subtitle}>{currentIndex + 1} / {photoUris.length}</Text>
      </View>
      <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={labels.close}>
        <IconX color="#fff" size={26} />
      </TouchableOpacity>
    </SafeAreaView>
  );
  const Footer = ({ imageIndex: currentIndex }: { imageIndex: number }) => (
    <SafeAreaView style={styles.footer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnailRow}>
        {photoUris.map((photoUri, index) => (
          <View key={photoUri} style={[styles.thumbnail, index === currentIndex && styles.thumbnailActive]}>
            <Image source={{ uri: photoUri }} style={styles.thumbnailImage} resizeMode="cover" />
          </View>
        ))}
      </ScrollView>
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.downloadButton} onPress={() => savePhoto(currentIndex)} accessibilityRole="button" accessibilityLabel={labels.download}>
          <IconDownload color="#fff" size={24} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <ImageViewing
      images={photoUris.map((photoUri) => ({ uri: photoUri }))}
      imageIndex={initialImageIndex}
      visible={visible && photoUris.length > 0}
      onRequestClose={onClose}
      swipeToCloseEnabled
      doubleTapToZoomEnabled
      HeaderComponent={Header}
      FooterComponent={Footer}
      backgroundColor="#000"
    />
  );
}

const styles = StyleSheet.create({
  header: { height: 116, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.md, paddingBottom: spacing.md, paddingHorizontal: spacing.md, backgroundColor: '#000', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#292929' },
  closeButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 48, height: 48 },
  titlePill: { minWidth: 132, borderRadius: 24, paddingVertical: spacing.xs, paddingHorizontal: spacing.xl, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  title: { color: '#fff', fontSize: 16, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: '600' },
  footer: { height: 160, paddingTop: spacing.sm, paddingBottom: spacing.md, backgroundColor: '#000', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#292929' },
  thumbnailRow: { flexGrow: 1, justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  thumbnail: { width: 44, height: 44, borderRadius: 4, overflow: 'hidden', opacity: 0.55 },
  thumbnailActive: { opacity: 1, borderWidth: 2, borderColor: '#fff' },
  thumbnailImage: { width: '100%', height: '100%' },
  actionRow: { alignItems: 'center' },
  downloadButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
});

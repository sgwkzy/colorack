// components/KitPhotoGrid.tsx
// 複数枚(最大10枚)の写真グリッド。1枚目はサムネイル扱いのため枠線で強調する。
// 並び替えは左右矢印ボタンで一つずつ移動する方式(キットボックスの並び替えと同じ仕組み)。
import { useMemo, useState } from 'react';
import { Image, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { IconChevronLeft, IconChevronRight, IconPlus, IconX } from '@tabler/icons-react-native';
import { pickKitPhotoFromCamera, pickKitPhotosFromLibrary } from '../lib/kitPhoto';
import { t } from '../lib/i18n';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';
import PhotoViewerModal from './PhotoViewerModal';

export interface KitPhotoGridItem {
  key: string | number;
  uri: string;
}

interface Props {
  photos: KitPhotoGridItem[];
  onAdd: (uri: string) => void | Promise<void>;
  onRemove: (key: string | number) => void;
  onMove: (key: string | number, direction: -1 | 1) => void;
  // falseの間は削除・並び替えボタンを隠す(閲覧のみ)。タップでの拡大表示と追加は常に可能。
  editable: boolean;
}

const MAX_PHOTOS = 10;

export default function KitPhotoGrid({ photos, onAdd, onRemove, onMove, editable }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'camera' | 'library' | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const canAddMore = photos.length < MAX_PHOTOS;

  const runAction = async (action: 'camera' | 'library') => {
    if (action === 'camera') {
      const uri = await pickKitPhotoFromCamera();
      if (uri) await onAdd(uri);
      return;
    }
    // ギャラリーは残り枠数までまとめて選択できる。DB書き込みを伴うonAddは
    // sort_orderの採番が競合しないよう1件ずつ順番に待つ。
    const remaining = MAX_PHOTOS - photos.length;
    const uris = await pickKitPhotosFromLibrary(remaining);
    for (const uri of uris) {
      await onAdd(uri);
    }
  };

  // iOSでは、ActionSheetのModalが完全に閉じ切る前にカメラ/ギャラリーを起動すると
  // 出てこないことがある(権限確認が即返る2回目以降で顕在化しやすい)。
  // そのためiOSではModalのonDismiss(閉じ終わった通知)まで起動を遅らせる。
  // Androidはこの制約がないため即時実行でよい。
  const requestAction = (action: 'camera' | 'library') => {
    if (Platform.OS === 'ios') setPendingAction(action);
    else runAction(action);
  };

  const handleSheetDismiss = () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    runAction(action);
  };

  const buttons: ActionSheetButton[] = [
    { text: t('takePhoto'), onPress: () => requestAction('camera') },
    { text: t('chooseFromLibrary'), onPress: () => requestAction('library') },
    { text: t('cancel'), style: 'cancel' },
  ];

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.grid}>
        {photos.map((photo, index) => (
          <View key={photo.key} style={[styles.tile, index === 0 && styles.thumbnailTile]}>
            <TouchableOpacity activeOpacity={0.8} disabled={editable} onPress={() => setViewerUri(photo.uri)}>
              <Image source={{ uri: photo.uri }} style={styles.image} resizeMode="cover" />
            </TouchableOpacity>
            {editable ? (
              <TouchableOpacity
                style={styles.removeBtn}
                onPress={() => onRemove(photo.key)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('removePhoto')}
              >
                <IconX color="#fff" size={14} />
              </TouchableOpacity>
            ) : null}
            {editable && index > 0 ? (
              <TouchableOpacity
                style={styles.moveLeftBtn}
                onPress={() => onMove(photo.key, -1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('moveLeft')}
              >
                <IconChevronLeft color="#fff" size={14} />
              </TouchableOpacity>
            ) : null}
            {editable && index < photos.length - 1 ? (
              <TouchableOpacity
                style={styles.moveRightBtn}
                onPress={() => onMove(photo.key, 1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('moveRight')}
              >
                <IconChevronRight color="#fff" size={14} />
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {canAddMore ? (
          <TouchableOpacity
            style={styles.tile}
            onPress={() => setPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('kitPhoto')}
          >
            <View style={styles.placeholder}><IconPlus color={colors.textFaint} size={28} /></View>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      <ActionSheet
        visible={pickerOpen}
        title={t('kitPhoto')}
        buttons={buttons}
        onClose={() => setPickerOpen(false)}
        onDismiss={handleSheetDismiss}
      />
      <PhotoViewerModal visible={viewerUri != null} uri={viewerUri} onClose={() => setViewerUri(null)} />
    </View>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  grid: { flexDirection: 'row', gap: spacing.sm },
  tile: { width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight },
  thumbnailTile: { borderWidth: 2, borderColor: colors.primary },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  removeBtn: { position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  moveLeftBtn: { position: 'absolute', bottom: 2, left: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  moveRightBtn: { position: 'absolute', bottom: 2, right: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
});

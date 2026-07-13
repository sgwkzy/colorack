// components/KitPhotoGrid.tsx
// 複数枚(最大10枚)の写真グリッド。1枚目はサムネイル扱いのため枠線で強調する。
// 並び替えUIは持たない(削除して撮り直す運用を想定)。
import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { IconPlus, IconX } from '@tabler/icons-react-native';
import { pickKitPhotoFromCamera, pickKitPhotoFromLibrary } from '../lib/kitPhoto';
import { t } from '../lib/i18n';
import { lightColors, radius, spacing, useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';

export interface KitPhotoGridItem {
  key: string | number;
  uri: string;
}

interface Props {
  photos: KitPhotoGridItem[];
  onAdd: (uri: string) => void;
  onRemove: (key: string | number) => void;
}

const MAX_PHOTOS = 10;

export default function KitPhotoGrid({ photos, onAdd, onRemove }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const canAddMore = photos.length < MAX_PHOTOS;

  // ActionSheetのModalが閉じるアニメーション中にネイティブのカメラ/ギャラリーpickerを
  // 起動すると、iOSでは初回(権限ダイアログが表示され自然に間が空く)は動くが、
  // 2回目以降(権限確認が即返るため間が空かない)はpickerが開かないことがある。
  // ponytail: 300msの固定待ちで確実にModalの閉じアニメーションをやり過ごす。
  // 根本的にはActionSheetにonDismiss相当のコールバックを持たせて置き換える。
  const waitForSheetClose = () => new Promise((resolve) => setTimeout(resolve, 300));

  const takePhoto = async () => {
    await waitForSheetClose();
    const uri = await pickKitPhotoFromCamera();
    if (uri) onAdd(uri);
  };
  const chooseFromLibrary = async () => {
    await waitForSheetClose();
    const uri = await pickKitPhotoFromLibrary();
    if (uri) onAdd(uri);
  };

  const buttons: ActionSheetButton[] = [
    { text: t('takePhoto'), onPress: takePhoto },
    { text: t('chooseFromLibrary'), onPress: chooseFromLibrary },
    { text: t('cancel'), style: 'cancel' },
  ];

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.grid}>
        {photos.map((photo, index) => (
          <View key={photo.key} style={[styles.tile, index === 0 && styles.thumbnailTile]}>
            <Image source={{ uri: photo.uri }} style={styles.image} resizeMode="cover" />
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => onRemove(photo.key)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('removePhoto')}
            >
              <IconX color="#fff" size={14} />
            </TouchableOpacity>
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
      <ActionSheet visible={pickerOpen} title={t('kitPhoto')} buttons={buttons} onClose={() => setPickerOpen(false)} />
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
});

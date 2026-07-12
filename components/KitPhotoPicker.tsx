import { useMemo, useState } from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { IconCamera } from '@tabler/icons-react-native';
import { pickKitPhotoFromCamera, pickKitPhotoFromLibrary } from '../lib/kitPhoto';
import { t } from '../lib/i18n';
import { lightColors, radius, useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';

interface Props {
  photoUri: string | null;
  onChange: (uri: string | null) => void;
}

export default function KitPhotoPicker({ photoUri, onChange }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);

  const takePhoto = async () => {
    const uri = await pickKitPhotoFromCamera();
    if (uri) onChange(uri);
  };
  const chooseFromLibrary = async () => {
    const uri = await pickKitPhotoFromLibrary();
    if (uri) onChange(uri);
  };

  const buttons: ActionSheetButton[] = [
    { text: t('takePhoto'), onPress: takePhoto },
    { text: t('chooseFromLibrary'), onPress: chooseFromLibrary },
    ...(photoUri ? [{ text: t('removePhoto'), style: 'destructive' as const, onPress: () => onChange(null) }] : []),
    { text: t('cancel'), style: 'cancel' },
  ];

  return (
    <>
      <TouchableOpacity style={styles.box} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={t('kitPhoto')}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.placeholder}><IconCamera color={colors.textFaint} size={32} /></View>
        )}
      </TouchableOpacity>
      <ActionSheet visible={open} title={t('kitPhoto')} buttons={buttons} onClose={() => setOpen(false)} />
    </>
  );
}

const makeStyles = (colors: typeof lightColors) => StyleSheet.create({
  box: { width: 96, height: 96, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.borderLight },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

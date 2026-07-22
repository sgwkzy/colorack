import { useEffect, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { IconChevronDown } from '@tabler/icons-react-native';
import { router } from 'expo-router';
import { useActiveKitBox, setActiveKitBox, useKitBoxesVersion } from '../lib/activeKitBox';
import { getDB } from '../lib/db';
import { useLocale } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';

interface Box { id: number; name: string; }

export default function KitBoxTitlePicker() {
  const { colors } = useTheme();
  const locale = useLocale();
  const activeBox = useActiveKitBox();
  const boxesVersion = useKitBoxesVersion();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { getDB().getAllAsync<Box>('SELECT id, name FROM kit_boxes ORDER BY sort_order, id').then(setBoxes); }, [open, boxesVersion]);
  const allLabel = locale === 'ja' ? 'すべてのボックス' : 'All Boxes';
  const label = activeBox === 'all' ? allLabel : boxes.find((box) => box.id === activeBox)?.name ?? '';
  const choose = (boxId: number | 'all') => {
    setActiveKitBox(boxId);
    router.navigate({ pathname: '/kits', params: { boxId: String(boxId), boxName: boxId === 'all' ? allLabel : boxes.find((box) => box.id === boxId)?.name ?? '' } });
  };
  const buttons: ActionSheetButton[] = [
    { text: `${activeBox === 'all' ? '✓ ' : ''}${allLabel}`, onPress: () => choose('all') },
    ...boxes.map((box) => ({ text: `${activeBox === box.id ? '✓ ' : ''}${box.name}`, onPress: () => choose(box.id) })),
    { text: locale === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
  ];
  return <><TouchableOpacity onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }} accessibilityRole="button" accessibilityLabel={label}>
    <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>{label}</Text><IconChevronDown color={colors.textMuted} size={18} />
  </TouchableOpacity><ActionSheet visible={open} buttons={buttons} onClose={() => setOpen(false)} /></>;
}

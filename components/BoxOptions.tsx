import { useEffect, useState } from 'react';
import { Alert, TouchableOpacity } from 'react-native';
import { IconDotsVertical } from '@tabler/icons-react-native';
import { router } from 'expo-router';
import { useActiveBox, notifyBoxesChanged, setActiveBox, useBoxesVersion } from '../lib/activeBox';
import { getDB, getDefaultBoxId, setSetting } from '../lib/db';
import { t, useLocale } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import ActionSheet, { ActionSheetButton } from './ActionSheet';
import BoxEditorModal, { BoxDraft, BoxIcon } from './BoxEditorModal';
import BoxOrderModal from './BoxOrderModal';

interface Box { id: number; name: string; icon: BoxIcon | null; icon_color: string | null; }

export default function BoxOptions() {
  const { colors } = useTheme();
  const locale = useLocale();
  const activeBox = useActiveBox();
  const boxesVersion = useBoxesVersion();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [defaultBoxId, setDefaultBoxId] = useState<number | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const box = activeBox === 'all' ? null : boxes.find((item) => item.id === activeBox) ?? null;
  const editLabel = locale === 'ja' ? 'ボックスを編集' : 'Edit Box';

  useEffect(() => {
    Promise.all([
      getDB().getAllAsync<Box>('SELECT id, name, icon, icon_color FROM boxes ORDER BY sort_order, id'),
      getDefaultBoxId(),
    ]).then(([items, defaultId]) => { setBoxes(items); setDefaultBoxId(defaultId); });
  }, [activeBox, boxesVersion]);

  if (!box) return null;

  const save = async ({ name, icon, color }: BoxDraft) => {
    await getDB().runAsync('UPDATE boxes SET name = ?, icon = ?, icon_color = ? WHERE id = ?', [name, icon, color, box.id]);
    notifyBoxesChanged();
  };

  const remove = async () => {
    const remaining = boxes.filter((item) => item.id !== box.id);
    if (remaining.length === 0) return;
    const nextDefault = remaining[0];
    const db = getDB();
    const defaultBoxId = await getDefaultBoxId();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM inventory WHERE box_id = ?', [box.id]);
      await db.runAsync('DELETE FROM boxes WHERE id = ?', [box.id]);
      if (defaultBoxId === box.id) {
        await db.runAsync(
          'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          ['default_box_id', String(nextDefault.id)]
        );
      }
    });
    notifyBoxesChanged();
    setActiveBox(nextDefault.id);
    router.navigate({ pathname: '/owned', params: { boxId: String(nextDefault.id), boxName: nextDefault.name } });
  };

  const confirmDelete = () => Alert.alert(box.name, t('deleteBoxConfirm'), [
    { text: t('cancel'), style: 'cancel' },
    { text: t('delete'), style: 'destructive', onPress: remove },
  ]);

  const saveOrder = async (ids: number[]) => {
    await getDB().withTransactionAsync(async () => {
      for (const [index, id] of ids.entries()) await getDB().runAsync('UPDATE boxes SET sort_order = ? WHERE id = ?', [index, id]);
    });
    setBoxes((current) => ids.map((id) => current.find((item) => item.id === id)!).filter(Boolean));
    notifyBoxesChanged();
  };

  const makeDefault = async () => {
    await setSetting('default_box_id', String(box.id));
    setDefaultBoxId(box.id);
  };

  const buttons: ActionSheetButton[] = [
    { text: locale === 'ja' ? 'このボックスをデフォルトにする' : 'Make this the default box', onPress: makeDefault, disabled: defaultBoxId === box.id },
    { text: locale === 'ja' ? 'ボックスを並び替え' : 'Reorder Boxes', onPress: () => setOrdering(true) },
    { text: editLabel, onPress: () => setEditing(true) },
    ...(boxes.length > 1 ? [{ text: t('delete'), style: 'destructive' as const, onPress: confirmDelete }] : []),
    { text: t('cancel'), style: 'cancel' },
  ];

  return <>
    <TouchableOpacity onPress={() => setOptionsOpen(true)} accessibilityRole="button" accessibilityLabel="Box options" hitSlop={12} style={{ marginRight: 16 }}>
      <IconDotsVertical color={colors.text} size={24} />
    </TouchableOpacity>
    <ActionSheet visible={optionsOpen} title={box.name} buttons={buttons} onClose={() => setOptionsOpen(false)} />
    <BoxEditorModal visible={editing} title={editLabel} initial={{ name: box.name, icon: box.icon ?? 'box', color: box.icon_color ?? colors.primary }} onSave={save} onClose={() => setEditing(false)} />
    <BoxOrderModal visible={ordering} boxes={boxes} onSave={saveOrder} onClose={() => setOrdering(false)} />
  </>;
}

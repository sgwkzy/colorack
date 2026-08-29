import { useMemo } from 'react';
import { addKitColor } from '../lib/db';
import { draftFromSummary, normalizeDraftPaints } from '../lib/colorMixDraft';
import { t } from '../lib/i18n';
import ColorMixEditorModal from './ColorMixEditorModal';

interface Props {
  visible: boolean;
  kitId: number;
  onClose: () => void;
  onAdded: () => void;
}

export default function KitColorComposerModal({ visible, kitId, onClose, onAdded }: Props) {
  const initialDraft = useMemo(() => draftFromSummary(), [visible]);
  return (
    <ColorMixEditorModal
      visible={visible}
      title={t('addColor')}
      initialDraft={initialDraft}
      onClose={onClose}
      onSave={async (draft) => {
        await addKitColor(
          kitId,
          draft.name.trim() || null,
          draft.note.trim() || null,
          normalizeDraftPaints(draft.paints),
        );
        onAdded();
      }}
    />
  );
}

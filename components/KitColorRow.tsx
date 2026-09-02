import type { ReactNode } from 'react';
import type { KitColorSummary } from '../lib/db';
import ColorMixCard from './ColorMixCard';

interface Props {
  color: KitColorSummary;
  ownedMap: Map<number, number>;
  onPress: () => void;
  dragHandle?: ReactNode;
  disabled?: boolean;
}

export default function KitColorRow({ color, ownedMap, onPress, dragHandle, disabled }: Props) {
  return <ColorMixCard color={color} ownedMap={ownedMap} onPress={onPress} dragHandle={dragHandle} disabled={disabled} />;
}

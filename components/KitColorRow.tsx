import type { KitColorSummary } from '../lib/db';
import ColorMixCard from './ColorMixCard';

interface Props {
  color: KitColorSummary;
  ownedMap: Map<number, number>;
  onPress: () => void;
}

export default function KitColorRow({ color, ownedMap, onPress }: Props) {
  return <ColorMixCard color={color} ownedMap={ownedMap} onPress={onPress} />;
}

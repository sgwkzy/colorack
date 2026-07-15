// components/SwipeDownHeader.tsx
// モーダルのヘッダー(タイトル部分)を下スワイプで閉じられるようにするラッパー。
import { View } from 'react-native';
import { PanGestureHandler, State, PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';

interface Props {
  onClose: () => void;
  children: React.ReactNode;
  // falseの間はジェスチャー自体を無効化する。全画面モーダル(写真ビューア等)を
  // このヘッダーの上に重ねて表示している間、下スワイプがすり抜けて親を
  // 閉じてしまうのを防ぐために使う。省略時はtrue(常に有効)。
  enabled?: boolean;
}

export default function SwipeDownHeader({ onClose, children, enabled = true }: Props) {
  const onStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    const { state, translationY, velocityY } = e.nativeEvent;
    if (state === State.END && translationY > 40 && velocityY > 0) onClose();
  };
  return (
    <PanGestureHandler enabled={enabled} activeOffsetY={20} failOffsetX={[-15, 15]} onHandlerStateChange={onStateChange}>
      <View>{children}</View>
    </PanGestureHandler>
  );
}

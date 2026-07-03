// components/SwipeDownHeader.tsx
// モーダルのヘッダー(タイトル部分)を下スワイプで閉じられるようにするラッパー。
import { View } from 'react-native';
import { PanGestureHandler, State, PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';

interface Props {
  onClose: () => void;
  children: React.ReactNode;
}

export default function SwipeDownHeader({ onClose, children }: Props) {
  const onStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    const { state, translationY, velocityY } = e.nativeEvent;
    if (state === State.END && translationY > 40 && velocityY > 0) onClose();
  };
  return (
    <PanGestureHandler activeOffsetY={20} failOffsetX={[-15, 15]} onHandlerStateChange={onStateChange}>
      <View>{children}</View>
    </PanGestureHandler>
  );
}

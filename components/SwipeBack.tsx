// components/SwipeBack.tsx
// 左→右の横スワイプで onBack を呼ぶ画面ラッパー。縦スクロールとは競合しないよう
// 横方向に一定量動いたときだけ作動する。
import { View } from 'react-native';
import { PanGestureHandler, State, PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';

interface Props {
  enabled: boolean;
  onBack: () => void;
  children: React.ReactNode;
}

export default function SwipeBack({ enabled, onBack, children }: Props) {
  const onStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    const { state, translationX, velocityX } = e.nativeEvent;
    if (state === State.END && translationX > 60 && velocityX > 0) onBack();
  };
  return (
    <PanGestureHandler
      enabled={enabled}
      activeOffsetX={20}
      failOffsetY={[-15, 15]}
      onHandlerStateChange={onStateChange}
    >
      <View style={{ flex: 1 }}>{children}</View>
    </PanGestureHandler>
  );
}

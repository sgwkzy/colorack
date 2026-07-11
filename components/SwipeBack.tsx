// components/SwipeBack.tsx
// 左→右の横スワイプで onBack を呼ぶ画面ラッパー。縦スクロールとは競合しないよう
// 横方向に一定量動いたときだけ作動する。
import { PanResponder, View } from 'react-native';
import { useMemo } from 'react';

interface Props {
  enabled: boolean;
  onBack: () => void;
  children: React.ReactNode;
}

export default function SwipeBack({ enabled, onBack, children }: Props) {
  const pan = useMemo(() => PanResponder.create({
    // 左端は親レイアウトのドロワーを最優先にする。
    onMoveShouldSetPanResponder: (event, gesture) => {
      const startX = event.nativeEvent.pageX - gesture.dx;
      return enabled && startX > 32 && gesture.dx > 20 && Math.abs(gesture.dx) > Math.abs(gesture.dy);
    },
    onPanResponderRelease: (_event, gesture) => { if (gesture.dx > 60 && gesture.vx > 0) onBack(); },
  }), [enabled, onBack]);
  return (
    <View style={{ flex: 1 }} {...pan.panHandlers}>{children}</View>
  );
}

// components/SwipeDownScrollView.tsx
// モーダル本文用のScrollView。スクロールが最上部にある時だけ、下方向スワイプで
// モーダルを閉じられる(SwipeDownHeaderと同じ閾値)。それ以外は通常のスクロールとして動作する。
import { forwardRef, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, ScrollViewProps } from 'react-native';
import { PanGestureHandler, State, PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';

interface Props extends ScrollViewProps {
  onClose: () => void;
}

const SwipeDownScrollView = forwardRef<ScrollView, Props>(function SwipeDownScrollView(
  { onClose, onScroll, ...rest },
  forwardedRef
) {
  const scrollY = useRef(0);
  const scrollViewRef = useRef<ScrollView>(null);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
    onScroll?.(e);
  };

  const onHandlerStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    const { state, translationY, velocityY } = e.nativeEvent;
    if (state === State.END && scrollY.current <= 0 && translationY > 40 && velocityY > 0) onClose();
  };

  return (
    <PanGestureHandler
      simultaneousHandlers={scrollViewRef}
      activeOffsetY={20}
      failOffsetX={[-15, 15]}
      onHandlerStateChange={onHandlerStateChange}
    >
      <ScrollView
        ref={(node) => {
          scrollViewRef.current = node;
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        {...rest}
      />
    </PanGestureHandler>
  );
});

export default SwipeDownScrollView;

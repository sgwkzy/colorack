// components/SwipeDownScrollView.tsx
// モーダル本文用のScrollView。通常のスクロールはそのまま、最上部からさらに下へ
// 引っ張って(バウンスのオーバースクロール)指を離すとモーダルを閉じる。
// PanGestureHandlerでラップする方式はScrollView自身のジェスチャーと競合して
// スクロールと閉じる操作の両方が壊れるため、バウンス量(負のcontentOffset)で判定する。
// ponytail: バウンスの無いAndroidでは本文からは閉じられない(ヘッダーの
// SwipeDownHeaderは全OSで有効)。必要になればonScrollでオーバースクロール量を自前計算する。
import { useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, NativeTouchEvent, ScrollView, ScrollViewProps } from 'react-native';

interface Props extends ScrollViewProps {
  onClose: () => void;
  closeEnabled?: boolean;
}

// 指を離した時点でこれより深く引っ張っていたら閉じる。ラバーバンドにより
// 実際の指の移動量はこの約2倍(≒200px)の「長い」スワイプになる。
const CLOSE_OFFSET = -100;

// FlatListなどScrollView以外のスクロールコンポーネントにも同じ「引っ張って閉じる」を
// 付けるためのprops。スプレッドで渡す: {...swipeDownCloseProps(onClose)}
export function swipeDownCloseProps(onClose: () => void): Pick<ScrollViewProps, 'onScrollEndDrag'> {
  return {
    onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (e.nativeEvent.contentOffset.y < CLOSE_OFFSET) onClose();
    },
  };
}

export default function SwipeDownScrollView({ onClose, closeEnabled = true, onScroll, onScrollEndDrag, onTouchEnd, onTouchStart, ...rest }: Props) {
  const startY = useRef<number | null>(null);
  const startOffsetY = useRef(0);
  const offsetY = useRef(0);
  const closedInGesture = useRef(false);
  const close = () => {
    if (!closeEnabled || closedInGesture.current) return;
    closedInGesture.current = true;
    onClose();
  };
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetY.current = e.nativeEvent.contentOffset.y;
    onScroll?.(e);
  };
  const handleScrollEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (closeEnabled && e.nativeEvent.contentOffset.y < CLOSE_OFFSET) close();
    onScrollEndDrag?.(e);
  };
  const handleTouchStart = (e: NativeSyntheticEvent<NativeTouchEvent>) => {
    startY.current = e.nativeEvent.pageY;
    startOffsetY.current = offsetY.current;
    closedInGesture.current = false;
    onTouchStart?.(e);
  };
  const handleTouchEnd = (e: NativeSyntheticEvent<NativeTouchEvent>) => {
    if (closeEnabled && startY.current !== null && startOffsetY.current <= 0 && e.nativeEvent.pageY - startY.current > 90 && offsetY.current <= 0) close();
    startY.current = null;
    onTouchEnd?.(e);
  };
  return <ScrollView onScroll={handleScroll} scrollEventThrottle={16} onScrollEndDrag={handleScrollEndDrag} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} {...rest} />;
}

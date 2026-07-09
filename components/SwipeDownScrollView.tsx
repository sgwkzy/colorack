// components/SwipeDownScrollView.tsx
// モーダル本文用のScrollView。通常のスクロールはそのまま、最上部からさらに下へ
// 引っ張って(バウンスのオーバースクロール)指を離すとモーダルを閉じる。
// PanGestureHandlerでラップする方式はScrollView自身のジェスチャーと競合して
// スクロールと閉じる操作の両方が壊れるため、バウンス量(負のcontentOffset)で判定する。
// ponytail: バウンスの無いAndroidでは本文からは閉じられない(ヘッダーの
// SwipeDownHeaderは全OSで有効)。必要になればonScrollでオーバースクロール量を自前計算する。
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, ScrollViewProps } from 'react-native';

interface Props extends ScrollViewProps {
  onClose: () => void;
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

export default function SwipeDownScrollView({ onClose, onScrollEndDrag, ...rest }: Props) {
  const closeProps = swipeDownCloseProps(onClose);
  const handleScrollEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    closeProps.onScrollEndDrag?.(e);
    onScrollEndDrag?.(e);
  };
  return <ScrollView onScrollEndDrag={handleScrollEndDrag} {...rest} />;
}

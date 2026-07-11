import { View } from 'react-native';
import { GestureHandlerRootView, PanGestureHandler, State, PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';

interface Props {
  enabled: boolean;
  onBack: () => void;
  children: React.ReactNode;
}

export default function SwipeBack({ enabled, onBack, children }: Props) {
  const onStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    const { state, translationX, velocityX } = event.nativeEvent;
    if (state === State.END && translationX > 60 && velocityX > 0) onBack();
  };
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PanGestureHandler
        enabled={enabled}
        activeOffsetX={20}
        failOffsetY={[-15, 15]}
        hitSlop={{ left: -32 }}
        onHandlerStateChange={onStateChange}
      >
        <View style={{ flex: 1 }}>{children}</View>
      </PanGestureHandler>
    </GestureHandlerRootView>
  );
}

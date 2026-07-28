// Androidのハードウェア/ジェスチャーの戻る操作を横取りするためのフック。
//
// このアプリの画面内階層(カタログのブランド→シリーズ→塗料など)はルートではなく
// ローカルstateで持っており、戻る手段はiOS的な端スワイプ(SwipeBack)だけだった。
// iOSにはハードウェアの戻るが無いため問題にならないが、Androidでは戻るボタンが
// 階層を1つ戻らずに画面ごと離脱してしまう。SwipeBack を置く場所には必ずこれも
// 併せて呼び、同じハンドラを渡すこと。
import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

/**
 * enabled のとき、Androidの戻る操作を onBack で消費する(既定の遷移は起こさない)。
 * iOSでは何もしない(BackHandler自体が発火しない)。
 */
export function useAndroidBack(enabled: boolean, onBack: () => void): void {
  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true; // 消費したので既定の戻る動作は行わせない
    });
    return () => sub.remove();
  }, [enabled, onBack]);
}

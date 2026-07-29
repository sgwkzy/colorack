import Constants from 'expo-constants';
import { Platform, StyleSheet, View } from 'react-native';
import { useEntitlements } from '../lib/subscription';

const productionAdUnitId = Platform.select({
  ios: Constants.expoConfig?.extra?.adMobBannerAdUnitIdIos,
  android: Constants.expoConfig?.extra?.adMobBannerAdUnitIdAndroid,
});

// 現行の anchored バナーの実測高さ(約60pt)に合わせる。レイアウトの跳ねを抑える意図。
const AD_MAX_HEIGHT = 60;

// ponytail: Expo Go has no native AdMob module; skip the import there, load it when running in a dev/production build.
const isExpoGo = Constants.appOwnership === 'expo' || Platform.OS === 'web';
const Ads = isExpoGo ? null : (require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads'));

export default function AdBanner() {
  const { hasBackup } = useEntitlements();
  if (hasBackup || isExpoGo || !Ads) {
    return null;
  }

  const adUnitId = __DEV__ ? Ads.TestIds.BANNER : productionAdUnitId;

  if (!adUnitId) {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* ANCHORED_ADAPTIVE_BANNER は画面の上端/下端に固定する前提の広告で、iOSでは
          GADCurrentOrientationAnchoredAdaptiveBannerAdSize になる。この広告はリスト内に
          インライン配置しているため用途違いであり、実機で画面下部の全幅がタッチを
          受け付けなくなる不具合が出た。スクロールするコンテンツ内に置く場合は
          INLINE_ADAPTIVE_BANNER が正しい。maxHeight は必須(未指定だと端末の画面高さが
          上限になる)。 */}
      <Ads.BannerAd
        unitId={adUnitId}
        size={Ads.BannerAdSize.INLINE_ADAPTIVE_BANNER}
        maxHeight={AD_MAX_HEIGHT}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
});

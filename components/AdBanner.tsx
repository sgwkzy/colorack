import Constants from 'expo-constants';
import { Platform, StyleSheet, View } from 'react-native';

const productionAdUnitId = Platform.select({
  ios: Constants.expoConfig?.extra?.adMobBannerAdUnitIdIos,
  android: Constants.expoConfig?.extra?.adMobBannerAdUnitIdAndroid,
});

// ponytail: Expo Go has no native AdMob module; skip the import there, load it when running in a dev/production build.
const isExpoGo = Constants.appOwnership === 'expo';
const Ads = isExpoGo ? null : (require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads'));

export default function AdBanner() {
  if (isExpoGo || !Ads) {
    return null;
  }

  const adUnitId = __DEV__ ? Ads.TestIds.BANNER : productionAdUnitId;

  if (!adUnitId) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Ads.BannerAd
        unitId={adUnitId}
        size={Ads.BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 12,
  },
});

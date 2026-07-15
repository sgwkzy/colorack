import Constants from 'expo-constants';

export default Constants.appOwnership === 'expo'
  ? null
  : (require('react-native-google-mobile-ads').default as typeof import('react-native-google-mobile-ads').default);

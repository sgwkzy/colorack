// Androidのリリース署名設定を app/build.gradle へ注入する config plugin。
//
// 経緯: これまで android/ は expo prebuild の生成物を手編集して署名設定を足していた。
// そのため prebuild を再実行できず(実行すると署名設定が消える)、app.config.js の
// プラグイン設定が Android ビルドに一切反映されない状態が続いていた。
// 実例として expo-camera の recordAudioAndroid: false が効かず、不要な RECORD_AUDIO
// 権限が残っていた。versionCode/versionName も app.json と別に手編集が必要だった。
//
// このプラグインで署名設定を注入するようにすれば prebuild --clean を安全に再実行でき、
// app.config.js の設定もバージョンも自動で反映される。
//
// 鍵そのもの(android/keystore.properties と .jks)は git 管理外のまま。
// ファイルが無い環境ではリリース署名を設定せず、デバッグ署名のままにする
// (CI や別マシンで prebuild だけ流したいときにビルド定義が壊れないようにするため)。
const { withAppBuildGradle } = require('@expo/config-plugins');

const LOADER = `
def releaseKeystoreProperties = new Properties()
def releaseKeystorePropertiesFile = rootProject.file('keystore.properties')
if (releaseKeystorePropertiesFile.exists()) {
    releaseKeystoreProperties.load(new FileInputStream(releaseKeystorePropertiesFile))
}
`;

const RELEASE_SIGNING_CONFIG = `
        release {
            if (releaseKeystorePropertiesFile.exists()) {
                storeFile file(releaseKeystoreProperties['storeFile'])
                storePassword releaseKeystoreProperties['storePassword']
                keyAlias releaseKeystoreProperties['keyAlias']
                keyPassword releaseKeystoreProperties['keyPassword']
            }
        }`;

function injectSigning(contents) {
  let next = contents;

  // 1) keystore.properties の読み込みを android {} の直前に置く
  if (!next.includes('releaseKeystorePropertiesFile')) {
    const anchor = '\nandroid {';
    if (!next.includes(anchor)) throw new Error('withAndroidReleaseSigning: "android {" が見つからない');
    next = next.replace(anchor, `${LOADER}\nandroid {`);
  }

  // 2) signingConfigs に release を足す(既にあれば触らない)。
  //    判定は signingConfigs ブロックの中だけを見る。ファイル全体を対象にすると
  //    buildTypes 側の release ブロックを拾って「既にある」と誤判定し、
  //    存在しない signingConfigs.release を参照する壊れた build.gradle ができる。
  const signingAnchor = 'signingConfigs {';
  const signingIndex = next.indexOf(signingAnchor);
  if (signingIndex === -1) throw new Error('withAndroidReleaseSigning: "signingConfigs {" が見つからない');
  const buildTypesAfterSigning = next.indexOf('buildTypes {', signingIndex);
  const signingBlock = next.slice(signingIndex, buildTypesAfterSigning === -1 ? undefined : buildTypesAfterSigning);
  if (!/\brelease\s*\{/.test(signingBlock)) {
    next = next.slice(0, signingIndex) + signingAnchor + RELEASE_SIGNING_CONFIG
      + next.slice(signingIndex + signingAnchor.length);
  }

  // 3) buildTypes.release に signingConfig を指定する。
  //    prebuild の既定は debug 署名で、release ブロックの中では
  //    「本番では自前のkeystoreを用意すること」というコメント2行を挟んでから
  //    signingConfig signingConfigs.debug が来る。コメントの有無に依存しないよう、
  //    buildTypes 以降で最初に現れる debug 署名指定を release のものとして置き換える。
  const buildTypesIndex = next.indexOf('buildTypes {');
  if (buildTypesIndex === -1) throw new Error('withAndroidReleaseSigning: "buildTypes {" が見つからない');
  const releaseIndex = next.indexOf('release {', buildTypesIndex);
  if (releaseIndex === -1) throw new Error('withAndroidReleaseSigning: buildTypes.release が見つからない');
  const debugSigning = 'signingConfig signingConfigs.debug';
  const target = next.indexOf(debugSigning, releaseIndex);
  if (target !== -1) {
    next = next.slice(0, target) + 'signingConfig signingConfigs.release' + next.slice(target + debugSigning.length);
  }
  if (!/release\s*\{[\s\S]*?signingConfig signingConfigs\.release/.test(next)) {
    throw new Error('withAndroidReleaseSigning: buildTypes.release に signingConfig を設定できなかった');
  }

  return next;
}

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidReleaseSigning: build.gradle が groovy ではない');
    }
    cfg.modResults.contents = injectSigning(cfg.modResults.contents);
    return cfg;
  });
};
